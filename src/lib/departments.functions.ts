import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { HttpError, requireMembership, writeAudit } from "./tenant.server";

/**
 * Departments group registered people (Youth, Women, Men, Choir, ...).
 * Membership is either assigned manually or derived from a registration field
 * whose value equals the department name (source_field_key).
 */

const spaceIdSchema = z.object({ spaceId: z.string().uuid() });

const likeEscape = (value: string) => value.replace(/[%_\\]/g, "\\$&");

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type DepartmentSummary = {
  id: string;
  name: string;
  description: string | null;
  sourceFieldKey: string | null;
  displayOrder: number;
  members: number;
};

export type DepartmentMember = {
  id: string;
  registration_number: string;
  full_name: string;
  phone: string | null;
  registered_at: string;
};

export const listDepartments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => spaceIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);

    const { data: depts } = await context.supabase
      .from("departments")
      .select("id, name, description, source_field_key, display_order")
      .eq("space_id", data.spaceId)
      .order("display_order")
      .order("name");

    const { data: manual } = await context.supabase
      .from("department_members")
      .select("department_id")
      .eq("space_id", data.spaceId);
    const manualCounts = new Map<string, number>();
    for (const row of manual ?? []) {
      manualCounts.set(row.department_id, (manualCounts.get(row.department_id) ?? 0) + 1);
    }

    const list = depts ?? [];
    const derivedCounts = new Map<string, number>();
    await Promise.all(
      list
        .filter((d) => d.source_field_key)
        .map(async (d) => {
          const { count } = await context.supabase
            .from("registration_field_values")
            .select("id", { count: "exact", head: true })
            .eq("space_id", data.spaceId)
            .eq("field_key", d.source_field_key!)
            .ilike("value", likeEscape(d.name));
          derivedCounts.set(d.id, count ?? 0);
        }),
    );

    return list.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      sourceFieldKey: d.source_field_key,
      displayOrder: d.display_order,
      members: derivedCounts.get(d.id) ?? manualCounts.get(d.id) ?? 0,
    })) satisfies DepartmentSummary[];
  });

const departmentInput = z.object({
  name: z.string().trim().min(1, "Give the department a name").max(60),
  description: z.string().trim().max(280).optional(),
  sourceFieldKey: z.string().trim().max(60).optional(),
});

export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => spaceIdSchema.extend(departmentInput.shape).parse(input))
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);
    const admin = await adminDb();

    const { data: row, error } = await admin
      .from("departments")
      .insert({
        space_id: data.spaceId,
        name: data.name,
        description: data.description || null,
        source_field_key: data.sourceFieldKey || null,
      })
      .select("id")
      .single();
    if (error || !row) {
      if ((error as { code?: string } | null)?.code === "23505") {
        throw new HttpError("A department with this name already exists.", 409);
      }
      throw new HttpError("Could not create this department.", 500);
    }

    await writeAudit(admin, {
      space_id: data.spaceId,
      actor_id: context.userId,
      action: "DEPARTMENT_CREATED",
      entity_type: "department",
      entity_id: row.id,
      description: `Department "${data.name}" created`,
    });
    return { id: row.id };
  });

export const updateDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    spaceIdSchema.extend({ id: z.string().uuid() }).extend(departmentInput.shape).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);
    const admin = await adminDb();

    const { error } = await admin
      .from("departments")
      .update({
        name: data.name,
        description: data.description || null,
        source_field_key: data.sourceFieldKey || null,
      })
      .eq("id", data.id)
      .eq("space_id", data.spaceId);
    if (error) {
      if ((error as { code?: string } | null)?.code === "23505") {
        throw new HttpError("A department with this name already exists.", 409);
      }
      throw new HttpError("Could not update this department.", 500);
    }

    await writeAudit(admin, {
      space_id: data.spaceId,
      actor_id: context.userId,
      action: "DEPARTMENT_UPDATED",
      entity_type: "department",
      entity_id: data.id,
      description: `Department "${data.name}" updated`,
    });
    return { id: data.id };
  });

export const deleteDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    spaceIdSchema.extend({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);
    const admin = await adminDb();

    const { error } = await admin
      .from("departments")
      .delete()
      .eq("id", data.id)
      .eq("space_id", data.spaceId);
    if (error) throw new HttpError("Could not delete this department.", 500);

    await writeAudit(admin, {
      space_id: data.spaceId,
      actor_id: context.userId,
      action: "DEPARTMENT_DELETED",
      entity_type: "department",
      entity_id: data.id,
      description: `Department deleted`,
    });
    return { ok: true };
  });

export const listDepartmentMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    spaceIdSchema
      .extend({
        departmentId: z.string().uuid(),
        search: z.string().trim().max(80).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(100).default(25),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);

    const { data: dept } = await context.supabase
      .from("departments")
      .select("id, name, description, source_field_key")
      .eq("id", data.departmentId)
      .eq("space_id", data.spaceId)
      .maybeSingle();
    if (!dept) throw new HttpError("Department not found.", 404);

    let members: DepartmentMember[];
    if (dept.source_field_key) {
      // Membership derived live from a registration field value matching the name.
      const { data: rows } = await context.supabase
        .from("registration_field_values")
        .select(
          "registration:registrations(id, registration_number, full_name, phone, registered_at)",
        )
        .eq("space_id", data.spaceId)
        .eq("field_key", dept.source_field_key)
        .ilike("value", likeEscape(dept.name))
        .limit(2000);
      members = (rows ?? [])
        .map((r) => r.registration)
        .filter((r): r is DepartmentMember => Boolean(r));
    } else {
      const { data: rows } = await context.supabase
        .from("department_members")
        .select(
          "registration:registrations(id, registration_number, full_name, phone, registered_at)",
        )
        .eq("department_id", data.departmentId);
      members = (rows ?? [])
        .map((r) => r.registration)
        .filter((r): r is DepartmentMember => Boolean(r));
    }

    // De-duplicate and filter.
    const seen = new Set<string>();
    members = members.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    const q = (data.search ?? "").trim().toLowerCase();
    if (q) {
      members = members.filter(
        (m) =>
          m.full_name.toLowerCase().includes(q) ||
          (m.phone ?? "").toLowerCase().includes(q) ||
          m.registration_number.toLowerCase().includes(q),
      );
    }
    members.sort((a, b) => a.full_name.localeCompare(b.full_name));

    const from = (data.page - 1) * data.pageSize;
    return {
      department: { id: dept.id, name: dept.name, sourceFieldKey: dept.source_field_key },
      members: members.slice(from, from + data.pageSize),
      total: members.length,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

/** Find registered people to assign to a department. */
export const searchPeopleForAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    spaceIdSchema
      .extend({
        departmentId: z.string().uuid().optional(),
        query: z.string().trim().min(2).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);
    const q = likeEscape(data.query);

    const { data: matches } = await context.supabase
      .from("registrations")
      .select("id, registration_number, full_name, phone")
      .eq("space_id", data.spaceId)
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,registration_number.ilike.%${q}%`)
      .order("full_name")
      .limit(8);

    const memberIds = new Set<string>();
    if (data.departmentId) {
      const { data: rows } = await context.supabase
        .from("department_members")
        .select("registration_id")
        .eq("department_id", data.departmentId);
      for (const row of rows ?? []) memberIds.add(row.registration_id);
    }

    return (matches ?? []).map((m) => ({ ...m, isMember: memberIds.has(m.id) }));
  });

export const addDepartmentMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    spaceIdSchema
      .extend({ departmentId: z.string().uuid(), registrationId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);
    const admin = await adminDb();

    const { data: dept } = await admin
      .from("departments")
      .select("id, name")
      .eq("id", data.departmentId)
      .eq("space_id", data.spaceId)
      .maybeSingle();
    if (!dept) throw new HttpError("Department not found.", 404);

    const { data: person } = await admin
      .from("registrations")
      .select("id, full_name")
      .eq("id", data.registrationId)
      .eq("space_id", data.spaceId)
      .maybeSingle();
    if (!person) throw new HttpError("That person is not registered in this workspace.", 404);

    const { error } = await admin
      .from("department_members")
      .insert({
        space_id: data.spaceId,
        department_id: data.departmentId,
        registration_id: data.registrationId,
      });
    if (error && (error as { code?: string }).code !== "23505") {
      throw new HttpError("Could not add this person to the department.", 500);
    }

    await writeAudit(admin, {
      space_id: data.spaceId,
      actor_id: context.userId,
      action: "DEPARTMENT_MEMBER_ADDED",
      entity_type: "department_member",
      entity_id: data.departmentId,
      description: `${person.full_name} added to ${dept.name}`,
    });
    return { ok: true };
  });

export const removeDepartmentMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    spaceIdSchema
      .extend({ departmentId: z.string().uuid(), registrationId: z.string().uuid() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireMembership(context.supabase, context.userId, data.spaceId);
    const admin = await adminDb();

    const { error } = await admin
      .from("department_members")
      .delete()
      .eq("department_id", data.departmentId)
      .eq("registration_id", data.registrationId);
    if (error) throw new HttpError("Could not remove this person from the department.", 500);

    await writeAudit(admin, {
      space_id: data.spaceId,
      actor_id: context.userId,
      action: "DEPARTMENT_MEMBER_REMOVED",
      entity_type: "department_member",
      entity_id: data.departmentId,
      description: `Member removed from department`,
    });
    return { ok: true };
  });
