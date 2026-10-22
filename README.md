# Drop

Drop is a mobile-first way to send a friend a photo, meme, GIF, or personal note as a private drop. Sending is instant by default; a human relay is an optional journey.

## Run locally

```bash
npm ci
./run.sh
```

Open `http://localhost:4004`. Run `./run.sh` again to restart Drop, or `./run.sh stop` to stop it. Without Supabase credentials, the app runs with local demo data. Real account-to-account media delivery needs the Supabase migrations and private storage setup in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

The composer shows account readiness and recipient selection before the note, photo, or GIF controls. Recipient lookup and invite detours preserve the existing local draft.

Mailbox empty states now respond to the selected filter and offer a matching next step; clearing a search keeps the selected filter and returns focus to the search field.

Drop uses port 4004 for the main app, 5004 for its isolated local Supabase smoke test, and 6004 for browser QA. The smoke test only accepts a loopback Supabase URL from `.env.local`; it does not reset the local database.

Keep local credentials in the ignored `.env.local` file at the project root. Local Supabase Auth redirects are configured for ports 4004, 5004, and 6004, with the legacy 3000 callback retained. Restart the local Supabase stack after changing `supabase/config.toml`.

Run checks with `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build -- --webpack`. For authenticated local Supabase verification, start the documented local Supabase stack, then run `npm run test:local-supabase`.

Relay handoffs request current device location only after an explicit opt-in. Optional GPS is used for the local proximity check and, after a successful handoff, saved in this browser; neighborhood labels can be entered manually. New server-issued carrier invites keep the bearer capability in the URL fragment, outside the initial HTTP request. Previously issued query-token invites remain compatible and are cleaned from the address bar after opening. Legacy `?d=` QR links still contain the previous carrier's coordinates and send them to Drop when opened; create a fresh secure carrier invite for future handoffs.

Sender route views refresh immediately, every 15 seconds while visible, and when the tab returns; the refresh control reports new handoffs and keeps the saved route visible when remote reads fail. Apply `20261022000000_restrict_relay_handoff_column_select.sql` with the other Supabase migrations so authenticated participants can read route details without access to handoff tokens or retry keys.

Signed-in Home and Mailbox listen for private recipient-scoped Realtime Broadcasts, then reload drop rows through the existing RLS query; broadcasts contain only the drop ID. A visible-tab 60-second refresh recovers missed signals. Apply `20261022100000_drop_inbox_broadcast.sql` with the other migrations before expecting hosted arrival cues.

Senders also get private reaction-change signals containing only the drop ID. Home, Mailbox, and an open sent-drop page reload the reaction through participant RLS, with a visible-tab recovery refresh. Apply `20261022110000_drop_reaction_broadcast.sql` after the inbox broadcast migration before expecting hosted reaction updates.

## Relay retry recovery

Carrier invite accepts keep the exact attempt details in the current browser tab for up to 24 hours. If the response is interrupted, refresh the same invite in that tab and choose “Retry same handoff”; Drop clears the record after the carrier pass is saved.
