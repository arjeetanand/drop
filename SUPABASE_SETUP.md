# Supabase setup for Drop

Drop needs Supabase Auth, the existing `profiles` and `letters` schema, and the new private `drop-media` bucket for real account-to-account sends.

1. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project to `.env.local`, plus `SUPABASE_SERVICE_ROLE_KEY` as a server-only secret in local and deployed environments. Never expose the service-role key with a `NEXT_PUBLIC_` name.
2. Apply every migration in `supabase/migrations/` in filename order. The validated-media migration restricts browser uploads to private staging paths; a Node route validates image bytes and writes final media using the service-role key. Apply it together with the matching app deployment so the older direct-upload client is not left active.
3. Enable Google OAuth in Supabase Auth if you want the existing Google sign-in button to work, and allow `http://localhost:3000/auth/callback` as a redirect URL during local development.
4. Sign in, save a unique username on Your profile, then send to a registered `@username`.

The app accepts decodable JPG, PNG, WebP, and GIF uploads up to 8 MB, 40 million decoded pixels, and 120 GIF frames. The browser uploads into an unreadable staging path; the server checks and re-encodes the actual image, applies orientation, and strips source metadata before writing the final object. The database binds new media paths to their exact sender and drop ID, and verifies the stored MIME type and size. Attachments stay in the private `drop-media` bucket; the app stores a storage path and requests a one-minute signed URL only after Supabase returns an authorized letter row. Storage policies allow only the sender or addressed recipient to read a linked attachment and allow deletion only when no drop references the object. The recipient alone can add or change a reaction.

## Local policy smoke test

With local PostgreSQL tools available, run the policy test against a disposable database from the repository root:

```bash
createdb drop-policy-smoke
psql -X -v ON_ERROR_STOP=1 -d drop-policy-smoke -f tests/db/sent_drop_integrity.sql
dropdb drop-policy-smoke
```

The script applies the relevant migrations, checks draft edits, sent-row immutability, linked-media deletion, failed-upload cleanup, and sender/recipient read access, then rolls back its changes. It tests PostgreSQL RLS behavior locally; it does not replace a two-account check against the configured Supabase project.

## Relay capability smoke test

Run the relay-token regression test against a separate disposable database:

```bash
createdb drop-relay-handoff-smoke
psql -X -v ON_ERROR_STOP=1 -d drop-relay-handoff-smoke -f tests/db/relay_handoff_tokens.sql
dropdb drop-relay-handoff-smoke
```

The transaction checks sender-only relay starts, short-lived passes, one-time handoff acceptance and exact retry recovery, pass rotation, optional coordinates, participant-only route visibility, and private token-table access. It rolls back all schema and data changes. This is local PostgreSQL coverage; it does not verify RPC behavior against a hosted Supabase project.

## Relay handoffs

Apply `20261018_relay_handoff_tokens.sql` after the existing letter and media migrations. Relay invites are bearer links: the first invite expires after 10 minutes, and accepting it issues a carrier capability that lasts 30 days. A carrier capability can mint a fresh 10-minute handoff pass when its holder is ready to pass the drop on. Share each invite only with the intended next carrier. Carriers can add route events but cannot read the drop's text or media.

Without Supabase credentials, the app runs with local seeded examples and local text drafts. Real sends and cross-account media delivery are unavailable in that mode.
