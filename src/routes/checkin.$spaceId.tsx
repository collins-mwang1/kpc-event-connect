import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCheckinSpace, selfCheckIn } from "@/lib/attendance.functions";
import { AmbientBackground } from "@/components/ambient-background";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";

export const Route = createFileRoute("/checkin/$spaceId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Check in — Leepek" },
      { name: "description", content: "Clock yourself in with your member code or phone number." },
      { property: "og:title", content: "Check in — Leepek" },
      { property: "og:description", content: "Clock yourself in with your member code or phone." },
    ],
  }),
  component: CheckinPage,
});

function CheckinPage() {
  const { spaceId } = Route.useParams();
  const spaceFn = useServerFn(getCheckinSpace);
  const checkinFn = useServerFn(selfCheckIn);

  const space = useQuery({
    queryKey: ["checkin-space", spaceId],
    queryFn: () => spaceFn({ data: { spaceId } }),
    retry: false,
  });

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    name: string;
    registrationNumber: string;
    alreadyCheckedIn: boolean;
    checkedInAt: string | null;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const result = await checkinFn({ data: { spaceId, code: code.trim() } });
      setDone({
        name: result.name,
        registrationNumber: result.registrationNumber,
        alreadyCheckedIn: result.alreadyCheckedIn,
        checkedInAt: result.checkedInAt,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed. Please try again.");
    }
    setBusy(false);
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6">
      <AmbientBackground />
      <div className="relative z-10 w-full max-w-md">
        {space.isError ? (
          <Card>
            <CardContent className="py-10 text-center">
              <h1 className="text-lg font-semibold">Check-in unavailable</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {space.error instanceof Error ? space.error.message : "This link is not valid."}
              </p>
            </CardContent>
          </Card>
        ) : done ? (
          <Card className="animate-pop">
            <CardContent className="py-12 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success text-success-foreground">
                {done.alreadyCheckedIn ? (
                  <Clock className="size-6" />
                ) : (
                  <CheckCircle2 className="size-6" />
                )}
              </div>
              <p className="mt-6 text-sm text-muted-foreground">
                {done.alreadyCheckedIn ? "You are already checked in today" : "You are checked in"}
              </p>
              <p className="mt-1 text-lg font-semibold">{done.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{done.registrationNumber}</p>
              <Button
                className="mt-8 h-12 w-full text-base"
                variant="outline"
                onClick={() => {
                  setDone(null);
                  setCode("");
                }}
              >
                Done
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="mb-6 text-center text-sm text-muted-foreground">
              {space.isLoading ? "Loading…" : space.data?.name}
            </p>
            <Card className="animate-rise">
              <CardContent className="py-8">
                <h1 className="text-center text-xl font-semibold">Clock in</h1>
                <p className="mt-1 text-center text-sm text-muted-foreground">
                  Enter your member code or phone number.
                </p>
                <form onSubmit={submit} className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="checkin-code" className="sr-only">
                      Member code or phone number
                    </Label>
                    <Input
                      id="checkin-code"
                      className="h-12 text-center text-lg"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="KPC-000001 or 07xx xxx xxx"
                      autoComplete="off"
                    />
                  </div>
                  <Button type="submit" className="h-12 w-full text-base" disabled={busy || !code.trim()}>
                    {busy ? "Checking in…" : "Clock in"}
                    {!busy && <ArrowRight className="size-4" />}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
