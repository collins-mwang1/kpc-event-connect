import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { HttpError, requireMembership, writeAudit } from "./tenant.server";
import { loadSession } from "./registration.functions";

/**
 * Attendance (clock-in) layer.
 *
 * Desk endpoints are public but authorised with a desk session id + secret pair,
 * exactly like the registration desk API. Admin endpoints verify space membership
 * server-side. Self check-in is public but matches an exact member code or phone.
 */

const sessionCredentials = z.object({
  sessionId: z.string().uuid(),
  secret: z.string().min(16),
});

const spaceIdSchema = z.object({ spaceId: z.string().uuid() });

const todayUtc = () => new Date().toISOString().slice(0, 10);
const likeEscape = (value: string) => value.replace(/[%_\\]/g, "\\$&");

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ============= Public desk API (session-credentialed) =============

export const deskSearchPeople = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    sessionCredentials.extend({ query: z.string().trim().min(2).max(80) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { session, supabaseAdmin } = await loadSession(data.sessionId, data.secret);
    const q = likeEscape(data.query);

    const { data: matches } = await supabaseAdmin
      .from("registrations")
      .select("id, registration_number, full_name, phone")
      .eq("space_id", session.space_id)
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,registration_number.ilike.%${q}%`)
      .order("full_name")
      .limit(8);

    const ids = (matches ?? []).map((m) => m.id);
    const checkedIn = new Set<string>();
    if (ids.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from("attendance_checkins")
        .select("registration_id")
        .eq("event_id", session.event_id)
        .eq("checkin_date", todayUtc())
        .in("registration_id", ids);
      for (const row of rows ?? []) checkedIn.add(row.registration_id);
    }

    return {
      results: (matches ?? []).map((m) => ({ ...m, checkedInToday: checkedIn.has(m.id) })),
    };
  });

export const deskClockIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    sessionCredentials
      .extend({
        registrationId: z.string().uuid(),
        method: z.enum(["DESK_SEARCH", "DESK_CODE"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { session, supabaseAdmin } = await loadSession(data.sessionId, data.secret);

    const { data: person } = await supabaseAdmin
      .from("registrations")
      .select("id, registration_number, full_name")
      .eq("id", data.registrationId)
      .eq("space_id", session.space_id)
      .maybeSingle();
    if (!person) throw new HttpError("That person is not registered in this workspace.", 404);

    const { data: existing } = await supabaseAdmin
      .from("attendance_checkins")
      .select("id, checked_in_at")
      .eq("registration_id", person.id)
      .eq("event_id", session.event_id)
      .eq("checkin_date", todayUtc())
      .maybeSingle();
    if (existing) {
      return { alreadyCheckedIn: true as const, checkedInAt: existing.checked_in_at, person };
    }

    const { data: checkin, error } = await supabaseAdmin
      .from("attendance_checkins")
      .insert({
        space_id: session.space_id,
        event_id: session.event_id,
        registration_id: person.id,
        desk_id: session.desk_id,
        method: data.method,
      })
      .select("id, checked_in_at")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return { alreadyCheckedIn: true as const, checkedInAt: null, person };
      }
      throw new HttpError("Clock-in could not be saved. Please try again.", 500);
    }

    await writeAudit(supabaseAdmin, {
      space_id: session.space_id,
      actor_id: null,
      action: "ATTENDANCE_CLOCKIN",
      entity_type: "attendance_checkin",
      entity_id: checkin?.id ?? null,
      description: `${person.full_name} clocked in at desk ${session.desk?.code ?? ""}`,
    });

    return { alreadyCheckedIn: false as const, checkedInAt: checkin?.checked_in_at ?? null, person };
  });

// ============= Admin: dashboard analytics =============

export type LocNode = {
  name: string;
  total: number;
  attended: number;
  children: LocNode[];
};

export type AttendanceDashboard = {
  totals: { registered: number; checkedInToday: number; pct: number; avg30: number };
  trend: { date: string; count: number }[];
  departments: {
    id: string;
    name: string;
    members: number;
    checkedInToday: number;
    pctToday: number;
    avgPct30: number;
  }[];
  demographics: { key: string; label: string; counts: { label: string; count: number }[] } | null;
  locations: LocNode[];
  recent: { fullName: string; registrationNumber: string; at: string; method: string }[];
  methodCounts: { desk: number; code: number; self: number };
};

export const getAttendanceDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => spaceIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);
    const admin = await adminDb();
    const spaceId = data.spaceId;
    const today = todayUtc();

    const since = new Date(Date.now() - 29 * 24 * 3600 * 1000);
    since.setUTCHours(0, 0, 0, 0);
    const sinceDate = since.toISOString().slice(0, 10);

    const [regResult, todayResult, trendResult, deptResult, manualResult, fieldResult] =
      await Promise.all([
        admin
          .from("registrations")
          .select("id, location", { count: "exact" })
          .eq("space_id", spaceId)
          .order("registered_at", { ascending: false })
          .limit(20000),
        admin
          .from("attendance_checkins")
          .select("registration_id, method, checked_in_at", { count: "exact" })
          .eq("space_id", spaceId)
          .eq("checkin_date", today)
          .order("checked_in_at", { ascending: false }),
        admin
          .from("attendance_checkins")
          .select("checkin_date, registration_id")
          .eq("space_id", spaceId)
          .gte("checkin_date", sinceDate)
          .limit(50000),
        admin
          .from("departments")
          .select("id, name, source_field_key, display_order")
          .eq("space_id", spaceId)
          .order("display_order")
          .order("name"),
        admin
          .from("department_members")
          .select("department_id, registration_id")
          .eq("space_id", spaceId),
        admin
          .from("registration_template_fields")
          .select("field_key, label")
          .eq("space_id", spaceId),
      ]);

    const regRows = regResult.data ?? [];
    const registered = regResult.count ?? regRows.length;
    const todayRows = todayResult.data ?? [];
    const trendRows = trendResult.data ?? [];
    const depts = deptResult.data ?? [];

    // ---- department membership: manual + derived from a source field ----
    const membership = new Map<string, Set<string>>();
    for (const dept of depts) membership.set(dept.id, new Set());
    for (const row of manualResult.data ?? []) {
      membership.get(row.department_id)?.add(row.registration_id);
    }
    const sourceKeys = [
      ...new Set(depts.map((d) => d.source_field_key).filter((k): k is string => Boolean(k))),
    ];
    if (sourceKeys.length > 0) {
      const { data: derivedValues } = await admin
        .from("registration_field_values")
        .select("field_key, value, registration_id")
        .eq("space_id", spaceId)
        .in("field_key", sourceKeys)
        .limit(20000);
      for (const dept of depts) {
        if (!dept.source_field_key) continue;
        const set = membership.get(dept.id)!;
        const target = dept.name.trim().toLowerCase();
        for (const row of derivedValues ?? []) {
          if (row.field_key !== dept.source_field_key) continue;
          if ((row.value ?? "").trim().toLowerCase() === target) set.add(row.registration_id);
        }
      }
    }

    // ---- today's attendance ----
    const todaySet = new Set(todayRows.map((r) => r.registration_id));
    const methodCounts = { desk: 0, code: 0, self: 0 };
    for (const row of todayRows) {
      if (row.method === "DESK_SEARCH") methodCounts.desk += 1;
      else if (row.method === "DESK_CODE") methodCounts.code += 1;
      else if (row.method === "SELF") methodCounts.self += 1;
    }

    // ---- 30-day trend ----
    const days: string[] = [];
    for (let i = 0; i < 30; i++) {
      days.push(new Date(since.getTime() + i * 24 * 3600 * 1000).toISOString().slice(0, 10));
    }
    const perDay = new Map<string, number>(days.map((d) => [d, 0]));
    for (const row of trendRows) {
      const bucket = perDay.get(row.checkin_date);
      if (bucket !== undefined) perDay.set(row.checkin_date, bucket + 1);
    }
    const attendedEver = new Set(trendRows.map((r) => r.registration_id));

    const dailyPct = (count: number) =>
      registered > 0 ? Math.min(100, (count / registered) * 100) : 0;
    const avg30 =
      days.length > 0
        ? days.reduce((sum, d) => sum + dailyPct(perDay.get(d) ?? 0), 0) / days.length
        : 0;

    // ---- per-department stats ----
    const deptDayCounts = new Map<string, Map<string, number>>();
    for (const dept of depts) {
      const map = new Map<string, number>(days.map((d) => [d, 0]));
      deptDayCounts.set(dept.id, map);
    }
    for (const row of trendRows) {
      for (const dept of depts) {
        if (membership.get(dept.id)?.has(row.registration_id)) {
          const map = deptDayCounts.get(dept.id)!;
          const bucket = map.get(row.checkin_date);
          if (bucket !== undefined) map.set(row.checkin_date, bucket + 1);
        }
      }
    }

    const departmentStats = depts.map((dept) => {
      const members = membership.get(dept.id)?.size ?? 0;
      let checkedInToday = 0;
      for (const regId of membership.get(dept.id) ?? []) {
        if (todaySet.has(regId)) checkedInToday += 1;
      }
      const dayMap = deptDayCounts.get(dept.id)!;
      const avgPct30 =
        members > 0 && days.length > 0
          ? days.reduce((sum, d) => sum + Math.min(100, ((dayMap.get(d) ?? 0) / members) * 100), 0) /
            days.length
          : 0;
      return {
        id: dept.id,
        name: dept.name,
        members,
        checkedInToday,
        pctToday: members > 0 ? (checkedInToday / members) * 100 : 0,
        avgPct30,
      };
    });

    // ---- demographics: auto-detect a gender-like field ----
    const genderField = (fieldResult.data ?? []).find(
      (f) => /gender|sex/i.test(f.field_key) || /gender|sex/i.test(f.label),
    );
    let demographics: AttendanceDashboard["demographics"] = null;
    if (genderField) {
      const { data: values } = await admin
        .from("registration_field_values")
        .select("registration_id, value")
        .eq("space_id", spaceId)
        .eq("field_key", genderField.field_key)
        .limit(20000);
      const valueByReg = new Map<string, string>();
      for (const row of values ?? []) {
        if (row.value) valueByReg.set(row.registration_id, row.value);
      }
      const counts = new Map<string, number>();
      for (const regId of todaySet) {
        const value = valueByReg.get(regId);
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      demographics = {
        key: genderField.field_key,
        label: genderField.label,
        counts: [...counts.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count),
      };
    }

    // ---- location roll-up tree (broadest part first: country > region > town) ----
    type Node = { name: string; total: number; attended: number; children: Map<string, Node> };
    const root: Node = { name: "All locations", total: 0, attended: 0, children: new Map() };
    for (const reg of regRows) {
      const parts = (reg.location ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const path = parts.length > 0 ? [...parts].reverse() : ["Not specified"];
      let level = root.children;
      for (let depth = 0; depth < Math.min(path.length, 3); depth++) {
        const part = path[depth]!;
        const key = part.toLowerCase();
        let node = level.get(key);
        if (!node) {
          node = { name: part, total: 0, attended: 0, children: new Map() };
          level.set(key, node);
        }
        node.total += 1;
        if (attendedEver.has(reg.id)) node.attended += 1;
        level = node.children;
      }
    }
    const toArray = (node: Node, depth: number): LocNode[] =>
      [...node.children.values()]
        .sort((a, b) => b.total - a.total)
        .map((child) => ({
          name: child.name,
          total: child.total,
          attended: child.attended,
          children: depth < 2 ? toArray(child, depth + 1) : [],
        }));
    const locations = toArray(root, 0);

    // ---- recent check-ins ----
    const todayIds = [...todaySet].slice(0, 200);
    const nameByReg = new Map<string, { full_name: string; registration_number: string }>();
    if (todayIds.length > 0) {
      const { data: people } = await admin
        .from("registrations")
        .select("id, full_name, registration_number")
        .in("id", todayIds);
      for (const p of people ?? []) {
        nameByReg.set(p.id, { full_name: p.full_name, registration_number: p.registration_number });
      }
    }
    const recent = todayRows.slice(0, 8).map((row) => {
      const person = nameByReg.get(row.registration_id);
      return {
        fullName: person?.full_name ?? "Someone",
        registrationNumber: person?.registration_number ?? "",
        at: row.checked_in_at,
        method: row.method as string,
      };
    });

    return {
      totals: {
        registered,
        checkedInToday: todayResult.count ?? todayRows.length,
        pct: dailyPct(todayResult.count ?? 0),
        avg30,
      },
      trend: days.map((date) => ({ date, count: perDay.get(date) ?? 0 })),
      departments: departmentStats,
      demographics,
      locations,
      recent,
      methodCounts,
    };
  });

// ============= Public self check-in =============

export const getCheckinSpace = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ spaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const admin = await adminDb();
    const { data: space } = await admin
      .from("spaces")
      .select("name, status")
      .eq("id", data.spaceId)
      .maybeSingle();
    if (!space || space.status !== "ACTIVE") {
      throw new HttpError("This check-in page is not available.", 404);
    }
    return { name: space.name };
  });

export const selfCheckIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ spaceId: z.string().uuid(), code: z.string().trim().min(4).max(40) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await adminDb();
    const { data: space } = await admin
      .from("spaces")
      .select("id, name, status")
      .eq("id", data.spaceId)
      .maybeSingle();
    if (!space || space.status !== "ACTIVE") {
      throw new HttpError("This check-in page is not available.", 404);
    }

    const code = data.code.replace(/\s+/g, "");
    const digits = code.replace(/\D/g, "");
    const filters = [`registration_number.ilike.${likeEscape(code)}`];
    if (digits.length >= 7) filters.push(`phone.ilike.%${digits}%`);

    const { data: matches } = await admin
      .from("registrations")
      .select("id, registration_number, full_name")
      .eq("space_id", space.id)
      .or(filters.join(","))
      .limit(2);
    if (!matches || matches.length === 0) {
      throw new HttpError("We could not find that member code or phone number.", 404);
    }
    if (matches.length > 1) {
      throw new HttpError("That number matches several people — enter your member code instead.", 400);
    }
    const person = matches[0]!;

    const { data: existing } = await admin
      .from("attendance_checkins")
      .select("id, checked_in_at")
      .eq("registration_id", person.id)
      .is("event_id", null)
      .eq("checkin_date", todayUtc())
      .maybeSingle();
    if (existing) {
      return {
        alreadyCheckedIn: true as const,
        checkedInAt: existing.checked_in_at,
        name: person.full_name,
        registrationNumber: person.registration_number,
        spaceName: space.name,
      };
    }

    const { data: checkin, error } = await admin
      .from("attendance_checkins")
      .insert({ space_id: space.id, registration_id: person.id, method: "SELF" })
      .select("id, checked_in_at")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return {
          alreadyCheckedIn: true as const,
          checkedInAt: null,
          name: person.full_name,
          registrationNumber: person.registration_number,
          spaceName: space.name,
        };
      }
      throw new HttpError("Check-in could not be saved. Please try again.", 500);
    }

    await writeAudit(admin, {
      space_id: space.id,
      actor_id: null,
      action: "ATTENDANCE_SELF_CHECKIN",
      entity_type: "attendance_checkin",
      entity_id: checkin?.id ?? null,
      description: `${person.full_name} self checked in`,
    });

    return {
      alreadyCheckedIn: false as const,
      checkedInAt: checkin?.checked_in_at ?? null,
      name: person.full_name,
      registrationNumber: person.registration_number,
      spaceName: space.name,
    };
  });
