import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAttendanceDashboard, type LocNode } from "@/lib/attendance.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CheckCircle2, Copy, Fingerprint, Link2, MapPin, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/s/$spaceId/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Leepek" },
      {
        name: "description",
        content: "Clock-ins, department attendance and where your people come from.",
      },
      { property: "og:title", content: "Attendance — Leepek" },
      { property: "og:description", content: "Attendance rates by department, day and location." },
    ],
  }),
  component: AttendancePage,
});

const METHOD_LABEL: Record<string, string> = {
  DESK_SEARCH: "Desk",
  DESK_CODE: "Member code",
  SELF: "Self check-in",
};

function LocationTree({ nodes, depth = 0 }: { nodes: LocNode[]; depth?: number }) {
  if (nodes.length === 0) return null;
  return (
    <ul className={depth === 0 ? "space-y-1" : "mt-1 space-y-1 border-l pl-4"}>
      {nodes.map((node) => (
        <li key={node.name}>
          <details open={depth === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded px-1 py-1 text-sm hover:bg-muted/60">
              <span className="flex min-w-0 items-center gap-2">
                {depth === 0 && <MapPin className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{node.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                {node.total} people{node.attended > 0 ? ` · ${node.attended} attended` : ""}
              </span>
            </summary>
            <LocationTree nodes={node.children} depth={depth + 1} />
          </details>
        </li>
      ))}
    </ul>
  );
}

function AttendancePage() {
  const { spaceId } = Route.useParams();
  const dashboardFn = useServerFn(getAttendanceDashboard);
  const [copied, setCopied] = useState(false);

  const dashboard = useQuery({
    queryKey: ["attendance-dashboard", spaceId],
    queryFn: () => dashboardFn({ data: { spaceId } }),
    refetchInterval: 60_000,
  });

  const data = dashboard.data;
  const maxTrend = Math.max(1, ...(data?.trend ?? []).map((t) => t.count));
  const checkinLink =
    typeof window !== "undefined" ? `${window.location.origin}/checkin/${spaceId}` : "";

  async function copyLink() {
    await navigator.clipboard.writeText(checkinLink);
    setCopied(true);
    toast.success("Self check-in link copied.");
    setTimeout(() => setCopied(false), 2000);
  }

  const cards = [
    { label: "Registered people", value: data?.totals.registered, icon: Users },
    { label: "Clocked in today", value: data?.totals.checkedInToday, icon: CheckCircle2 },
    { label: "Today's attendance", value: data ? `${data.totals.pct.toFixed(0)}%` : undefined, icon: Fingerprint },
    { label: "30-day average", value: data ? `${data.totals.avg30.toFixed(0)}%` : undefined, icon: Fingerprint },
  ];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl">Attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who clocked in, which departments show up, and where people come from.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={copyLink}>
          {copied ? <CheckCircle2 className="size-4" /> : <Link2 className="size-4" />}
          Copy self check-in link
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, index) => (
          <Card key={card.label} className={`animate-rise stagger-${index}`}>
            <CardContent className="py-5">
              <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <card.icon className="size-3.5" />
                {card.label}
              </p>
              {dashboard.isLoading || card.value === undefined ? (
                <Skeleton className="mt-2 h-7 w-16" />
              ) : (
                <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="py-6">
            <h2 className="text-sm font-semibold">Clock-ins — last 30 days</h2>
            <div className="mt-6 flex h-40 items-end gap-1">
              {(data?.trend ?? []).map((point) => (
                <div key={point.date} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t bg-chart-1 transition-all duration-300"
                    style={{ height: `${Math.max(2, (point.count / maxTrend) * 100)}%` }}
                    title={`${point.date}: ${point.count}`}
                  />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {data ? `${data.totals.checkedInToday} people have clocked in today` : "Loading…"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6">
            <h2 className="text-sm font-semibold">How people clock in (today)</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">At a desk</span>
                <span className="font-medium tabular-nums">{data?.methodCounts.desk ?? 0}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Member code</span>
                <span className="font-medium tabular-nums">{data?.methodCounts.code ?? 0}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted-foreground">Self check-in</span>
                <span className="font-medium tabular-nums">{data?.methodCounts.self ?? 0}</span>
              </li>
            </ul>
            <h3 className="mt-6 text-sm font-semibold">Recent check-ins</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {(data?.recent ?? []).map((entry, index) => (
                <li key={`${entry.registrationNumber}-${index}`} className="flex items-center justify-between gap-3">
                  <span className="truncate">{entry.fullName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
              {data?.recent.length === 0 && (
                <li className="text-sm text-muted-foreground">No check-ins yet today.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-6">
          <h2 className="text-sm font-semibold">Departments</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Attendance per department — today and the 30-day average.
          </p>
          {dashboard.isLoading ? (
            <Skeleton className="mt-6 h-24 w-full" />
          ) : (data?.departments.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No departments yet — create them under Departments.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {(data?.departments ?? []).map((dept) => (
                <div key={dept.id} className="flex items-center gap-4">
                  <div className="w-40 min-w-0 shrink-0">
                    <p className="truncate text-sm font-medium">{dept.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {dept.members} member{dept.members === 1 ? "" : "s"} · {dept.checkedInToday} today
                    </p>
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-2 transition-all duration-500"
                      style={{ width: `${Math.min(100, dept.avgPct30)}%` }}
                    />
                  </div>
                  <div className="w-28 shrink-0 text-right text-sm tabular-nums">
                    <span className="font-semibold">{dept.avgPct30.toFixed(0)}%</span>
                    <span className="text-xs text-muted-foreground"> / {dept.pctToday.toFixed(0)}% today</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="py-6">
            <h2 className="text-sm font-semibold">
              {data?.demographics ? `${data.demographics.label} — today's check-ins` : "Demographics"}
            </h2>
            {data?.demographics ? (
              <ul className="mt-4 space-y-3">
                {data.demographics.counts.map((entry) => {
                  const total = data.demographics!.counts.reduce((sum, c) => sum + c.count, 0);
                  const pct = total > 0 ? (entry.count / total) * 100 : 0;
                  return (
                    <li key={entry.label}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{entry.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {entry.count} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-chart-3 transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
                {data.demographics.counts.length === 0 && (
                  <li className="text-sm text-muted-foreground">No check-ins to break down yet.</li>
                )}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Add a field such as “Gender” to your registration form to see this breakdown.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6">
            <h2 className="text-sm font-semibold">Where people come from</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Grouped from the location on each registration — country, region, town.
            </p>
            {dashboard.isLoading ? (
              <Skeleton className="mt-6 h-24 w-full" />
            ) : (data?.locations.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No location data yet.
              </p>
            ) : (
              <div className="mt-4 max-h-96 overflow-y-auto">
                <LocationTree nodes={data?.locations ?? []} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
