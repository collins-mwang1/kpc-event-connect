<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules

- Desk session validation lives in `src/lib/desk-session.server.ts` (`loadDeskSession`); never import plain helper functions from one `*.functions.ts` module into another — that pulls server-only code (`node:crypto`) into the client bundle and breaks pages at runtime.
- Writes to `departments`, `department_members` and `attendance_checkins` go only through authenticated server functions after `requireMembership`; no Data API write policies on these tables (deny-by-default, like the credential tables).
- `attendance_checkins` uniqueness: one row per person per UTC day per context (`registration_id, coalesce(event_id, uuid0), checkin_date`).
- Single-org UX: `/spaces` auto-redirects into the user's first space; the space sidebar has no switcher. Keep `/create` and the data model multi-space.

