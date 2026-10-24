import { HttpError, hashSecret } from "./tenant.server";

/**
 * Server-only desk session validation, shared by the registration and
 * attendance public desk APIs. Lives in a `.server.ts` module so it never
 * enters the client bundle.
 */
export async function loadDeskSession(sessionId: string, secret: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: session } = await supabaseAdmin
    .from("registration_sessions")
    .select(
      "id, space_id, event_id, desk_id, token_id, status, secret_hash, started_at, space:spaces(name, status), event:events(name, status, venue), desk:registration_desks(name, code, location, status)",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.secret_hash !== hashSecret(secret)) {
    throw new HttpError("This registration session is not valid.", 401);
  }
  if (session.status !== "ACTIVE") throw new HttpError("This registration session has ended.", 401);
  if (session.space?.status !== "ACTIVE") throw new HttpError("This workspace is not active.", 403);
  if (session.desk?.status !== "ACTIVE") throw new HttpError("This desk is no longer active.", 403);

  const { data: token } = await supabaseAdmin
    .from("desk_tokens")
    .select("status, expires_at")
    .eq("id", session.token_id)
    .maybeSingle();
  if (!token || token.status !== "ACTIVE" || new Date(token.expires_at) < new Date()) {
    await supabaseAdmin
      .from("registration_sessions")
      .update({ status: "ENDED", ended_at: new Date().toISOString() })
      .eq("id", session.id);
    throw new HttpError("The desk token has expired or was revoked.", 401);
  }

  return { session, supabaseAdmin };
}
