# Supabase setup for Drop

Drop needs Supabase Auth, the existing `profiles` and `letters` schema, and the new private `drop-media` bucket for real account-to-account sends.

1. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project to `.env.local`, plus `SUPABASE_SERVICE_ROLE_KEY` as a server-only secret in local and deployed environments. Never expose the service-role key with a `NEXT_PUBLIC_` name.
2. Apply every migration in `supabase/migrations/` in filename order. The validated-media migration restricts browser uploads to private staging paths; a Node route validates image bytes and writes final media using the service-role key. Apply it together with the matching app deployment so the older direct-upload client is not left active.
3. Local Supabase uses `http://localhost:4004` as its site URL and allows callbacks on the documented app ports `4004`, `5004`, and `6004`, for both `localhost` and `127.0.0.1`; the previous port-3000 callback remains allowed. If you change `supabase/config.toml`, restart the local stack with `npm run supabase:stop` and `npm run supabase:start`. The profile offers a passwordless email link; local messages are visible in Supabase Inbucket at `http://127.0.0.1:54324`. Configure the deployed site's Auth URL settings and SMTP separately for hosted sign-in. Google sign-in is also available when its OAuth provider is configured.
4. Sign in, save a unique username on Your profile, then send to a registered `@username`.

The app accepts decodable JPG, PNG, WebP, and GIF uploads up to 8 MB, 40 million decoded pixels, and 120 GIF frames. The browser uploads into an unreadable staging path; the server checks and re-encodes the actual image, applies orientation, and strips source metadata before writing the final object. The database binds new media paths to their exact sender and drop ID, verifies the stored MIME type and size, and enforces that text drops have no media, image drops use a static image type, and GIF drops use `image/gif`. Attachments stay in the private `drop-media` bucket; the app stores a storage path and requests a one-minute signed URL only after Supabase returns an authorized letter row. Storage policies allow only the sender or addressed recipient to read a linked attachment and allow deletion only when no drop references the object. The recipient alone can add or change a reaction.

## Local Supabase development

The Supabase CLI is pinned in `package.json`; Node.js 20+ and a Docker-compatible runtime are required. Start the local Auth, Database, and Storage services with `npm run supabase:start`. The first start downloads the service images. The CLI prints a local project URL, anon key, and service-role key; copy those into `.env.local` using the variable names in `.env.example`. Keep the service-role key server-only.

`npm run supabase:reset` recreates the local database from the migrations and clears local database data. Use this only for the local stack; do not add `--linked`. `npm run supabase:stop` stops the local services while retaining their data. Google OAuth still needs provider credentials; local email confirmation is disabled so test users can be created through Supabase Auth without a hosted mail provider.

The local stack is for development and testing only. Do not expose it to external traffic. Use the profile’s email-link sign-in and open the message in Inbucket to authenticate disposable local accounts through the normal callback flow.

With the local stack running and `.env.local` filled from its CLI output, run `npm run test:local-supabase`. The smoke test starts a temporary Next.js server, creates three disposable local accounts, exercises text insert/read, reaction RLS, the real private GIF finalize route, and participant storage reads, then removes its test objects and accounts. It refuses any Supabase URL that does not resolve to this machine. It tests the backend boundaries directly, not browser sign-in or the full composer flow, and does not verify hosted OAuth or hosted project settings.

## Local policy smoke test

With local PostgreSQL tools available, run the policy test against a disposable database from the repository root:

```bash
createdb drop-policy-smoke
psql -X -v ON_ERROR_STOP=1 -d drop-policy-smoke -f tests/db/sent_drop_integrity.sql
dropdb drop-policy-smoke
```

The script applies the relevant migrations, checks payload/media consistency, draft edits, sent-row immutability, linked-media deletion, failed-upload cleanup, and sender/recipient read access, then rolls back its changes. It tests PostgreSQL RLS behavior locally; it does not replace a two-account check against the configured Supabase project.

## Relay capability smoke test

Run the relay-token regression test against a separate disposable database:

```bash
createdb drop-relay-handoff-smoke
psql -X -v ON_ERROR_STOP=1 -d drop-relay-handoff-smoke -f tests/db/relay_handoff_tokens.sql
dropdb drop-relay-handoff-smoke
```

The transaction checks sender-only relay starts, short-lived passes, one-time text and GIF handoff acceptance, exact retry recovery, pass rotation, coordinate-free and coordinate-bearing handoffs, participant-only route visibility, and private token-table access. It also confirms the carrier handoff result omits message text and media fields. It rolls back all schema and data changes. This is local PostgreSQL coverage; it does not verify RPC behavior against a hosted Supabase project.

## Accountless private claim links

Apply `20261023120000_drop_claim_invites.sql`, `20261023130000_drop_claimed_sender_broadcast.sql`, and `20261023140000_sender_claimed_drop_status.sql` in filename order with the other migrations. The first adds a private token-digest table and authenticated-only issue, reissue, and claim RPCs. The recipient must have a Drop profile and explicitly claim the text note; page load alone does not consume the link. Reissuing from the sender detail page rotates the capability, including after expiry, while claimed or revoked links cannot be reissued. The second migration sends only the drop ID to the sender's private inbox topic after a successful claim. The third exposes only the authenticated sender's own claimed drop IDs; it does not return token or recipient-account data. Sent cards and sender detail show “Claimed by [name]” after reload, while regular delivered notes remain “Delivered.”

Run the privacy and transition fixture against a separate disposable PostgreSQL database. It creates its schema and data inside a transaction and rolls them back:

```bash
createdb drop-claim-smoke
psql -X -v ON_ERROR_STOP=1 -d drop-claim-smoke -f tests/db/drop_claim_invites.sql
dropdb drop-claim-smoke
```

The fixture covers authenticated RPC grants, pending-note privacy, digest-only storage, token rotation, whitespace-preserving reissue, claim expiry, sender/outsider denial, same-account retries after expiry, the private ID-only sender broadcast with duplicate suppression, and sender-scoped durable claim status after invite expiry. It also confirms ordinary delivered notes and pending/revoked invites are excluded. Relay trigger controls check recipient/sender broadcasts and reject an unrelated-update duplicate. It rolls back its schema and data. It does not exercise live Realtime channel authorization, the collection RPC, hosted Supabase settings, or browser-to-browser authentication.

## Relay handoffs

Apply `20261018000100_relay_handoff_tokens.sql` and `20261022000000_restrict_relay_handoff_column_select.sql` after the existing letter and media migrations. The later migration grants authenticated participants only the route columns and keeps the bearer token and retry key private. Relay invites are bearer links: the first invite expires after 10 minutes, and accepting it issues a carrier capability that lasts 30 days. A carrier capability can mint a fresh 10-minute handoff pass when its holder is ready to pass the drop on. Share each invite only with the intended next carrier. Carriers can add route events but cannot read the drop's text or media. Sender route views refresh immediately, every 15 seconds while visible, and when the tab returns; a manual refresh is also available.

Without Supabase credentials, the app runs with local seeded examples and local text drafts. Real sends and cross-account media delivery are unavailable in that mode.
