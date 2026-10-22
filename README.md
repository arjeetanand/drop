# Drop

Drop is a mobile-first way to send a friend a photo, meme, GIF, or personal note as a private drop. Sending is instant by default; a human relay is an optional journey.

## Run locally

```bash
npm ci
./run.sh
```

Open `http://localhost:4004`. Run `./run.sh` again to restart Drop, or `./run.sh stop` to stop it. Without Supabase credentials, the app runs with local demo data. Real account-to-account media delivery needs the Supabase migrations and private storage setup in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

Drop uses port 4004 for the main app, 5004 for its isolated local Supabase smoke test, and 6004 for browser QA. The smoke test only accepts a loopback Supabase URL from `.env.local`; it does not reset the local database.

Run checks with `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build -- --webpack`. For authenticated local Supabase verification, start the documented local Supabase stack, then run `npm run test:local-supabase`.
