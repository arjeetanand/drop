# Drop

Drop is a mobile-first way to send a friend a photo, meme, GIF, or personal note as a private drop. Sending is instant by default; a human relay is an optional journey.

## Run locally

```bash
npm ci
./run.sh
```

Open `http://localhost:4004`. Run `./run.sh` again to restart Drop, or `./run.sh stop` to stop it. Without Supabase credentials, the app runs with local demo data. Real account-to-account media delivery needs the Supabase migrations and private storage setup in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

Drop uses port 4004 for the main app, 5004 for its isolated local Supabase smoke test, and 6004 for browser QA. The smoke test only accepts a loopback Supabase URL from `.env.local`; it does not reset the local database.

Keep local credentials in the ignored `.env.local` file at the project root. Local Supabase Auth redirects are configured for ports 4004, 5004, and 6004, with the legacy 3000 callback retained. Restart the local Supabase stack after changing `supabase/config.toml`.

Run checks with `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build -- --webpack`. For authenticated local Supabase verification, start the documented local Supabase stack, then run `npm run test:local-supabase`.

Relay handoffs request current device location only after an explicit opt-in. Optional GPS is used for the local proximity check and, after a successful handoff, saved in this browser; neighborhood labels can be entered manually. Legacy QR links still include the previous carrier's coordinates in the URL, which is sent to Drop when that link is opened.

Sender route views refresh immediately, every 15 seconds while visible, and when the tab returns; the refresh control reports new handoffs and keeps the saved route visible when remote reads fail. Apply `20261022000000_restrict_relay_handoff_column_select.sql` with the other Supabase migrations so authenticated participants can read route details without access to handoff tokens or retry keys.
