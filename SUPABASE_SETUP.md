# Supabase setup for Drop

Drop needs Supabase Auth, the existing `profiles` and `letters` schema, and the new private `drop-media` bucket for real account-to-account sends.

## Hosted project provisioning status — 2026-10-24

The CLI created the distinct `Drop App Free` organization, but could not verify its plan or create the `Drop` project: both organization details and project creation returned 403. The read-only project list contains only the existing `arjeetanand's Project`; it was not changed. No Drop project or paid compute/add-on was created, and `.env.local` was left unchanged. Continue only after verifying the new organization/project is Free.

The supplied token appears to lack the required fine-grained permissions. Supabase documents `organization_admin_read` for reading organization details and `organization_projects_create` for creating a project. For the remaining setup, also grant `database_migrations_write`, `edge_functions_write`, `edge_functions_secrets_write`, and `api_gateway_keys_read` and `api_gateway_keys_secret_read` on the new project. Store a new scoped token in the ignored local `.env.local`; do not paste it into chat. Revoke the token pasted into chat after replacing it.

1. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project to `.env.local`, plus `SUPABASE_SERVICE_ROLE_KEY` as a server-only secret in local and deployed environments. Never expose the service-role key with a `NEXT_PUBLIC_` name.
2. Apply every migration in `supabase/migrations/` in filename order. The validated-media migration restricts browser uploads to private staging paths; a Node route validates image bytes and writes final media using the service-role key. Apply it together with the matching app deployment so the older direct-upload client is not left active.
3. Local Supabase uses `http://localhost:4004` as its site URL and allows callbacks on the documented app ports `4004`, `5004`, and `6004`, for both `localhost` and `127.0.0.1`; the previous port-3000 callback remains allowed. If you change `supabase/config.toml`, restart the local stack with `npm run supabase:stop` and `npm run supabase:start`. The profile offers a passwordless email link; local messages are visible in Supabase Inbucket at `http://127.0.0.1:54324`. Configure the deployed site's Auth URL settings and SMTP separately for hosted sign-in. Google sign-in is also available when its OAuth provider is configured.
4. Sign in, save a unique username on Your profile, then send to a registered `@username`.

The app accepts decodable JPG, PNG, WebP, and GIF uploads up to 8 MB, 40 million decoded pixels, and 120 GIF frames. The browser uploads into an unreadable staging path; the server checks and re-encodes the actual image, applies orientation, and strips source metadata before writing the final object. The database binds new media paths to their exact sender and drop ID, verifies the stored MIME type and size, and enforces that text drops have no media, image drops use a static image type, and GIF drops use `image/gif`. Attachments stay in the private `drop-media` bucket; the app stores a storage path and requests a one-minute signed URL only after Supabase returns an authorized letter row. Storage policies allow only the sender or addressed recipient to read a linked attachment and allow deletion only when no drop references the object. The recipient alone can add or change a reaction.

## Local Supabase development

The Supabase CLI is pinned in `package.json`; Node.js 20+ and a Docker-compatible runtime are required. Start the local Auth, Database, and Storage services with `npm run supabase:start`. The first start downloads the service images. The CLI prints a local project URL, anon key, and service-role key; copy those into `.env.local` using the variable names in `.env.example`. Keep the service-role key server-only.

`npm run supabase:reset` recreates the local database from the migrations and clears local database data. Use this only for the local stack; do not add `--linked`. `npm run supabase:stop` stops the local services while retaining their data. Google OAuth still needs provider credentials; local email confirmation is disabled so test users can be created through Supabase Auth without a hosted mail provider.

The local stack is for development and testing only. Do not expose it to external traffic. Use the profile’s email-link sign-in and open the message in Inbucket to authenticate disposable local accounts through the normal callback flow.

### Local photo/GIF cleanup worker

Run `./node_modules/.bin/supabase migration up --local` after starting the local stack to apply pending migrations without resetting local data. Keep `.env.local` ignored and add a high-entropy `DROP_MEDIA_CLEANUP_SECRET` there; use the same value for the local function and Vault. In the local Supabase Studio SQL editor, run this once, replacing the two placeholders with the local anon key and the secret from `.env.local`:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('http://kong:8000', 'drop_media_cleanup_project_url');
select vault.create_secret('<local-anon-key>', 'drop_media_cleanup_anon_key');
select vault.create_secret('<same-DROP_MEDIA_CLEANUP_SECRET>', 'drop_media_cleanup_secret');
select private.schedule_drop_media_cleanup();
select jobname, schedule, active from cron.job where jobname = 'drop-expired-drop-media-hourly';
```

`http://kong:8000` is the local API address reachable from the database container. Keep the function-server command running in a separate terminal while exercising cleanup locally:

```bash
./node_modules/.bin/supabase functions serve cleanup-expired-drop-media --env-file .env.local --no-verify-jwt
```

The local function checks its private cleanup secret; `--no-verify-jwt` is for this local CLI server only. Do not use `supabase db reset` when you need to preserve local data. The smoke test does not invoke a live deletion pass; actual removal of an aged Storage object remains a separate verification.

With the local stack running and `.env.local` filled from its CLI output, run `npm run test:local-supabase`. The smoke test starts a temporary Next.js server, creates five disposable local accounts, and exercises text insert/read, reaction RLS, the real private GIF finalize route, participant storage reads, and an unknown-handle text claim from an unprofiled account through explicit claim and sender-status recovery. It also checks reissue invalidation, same-account retry, outsider/replay denial, and pre/post-claim privacy, then removes its test objects and accounts. It refuses any Supabase URL that does not resolve to this machine. It tests backend boundaries directly, not browser sign-in or the full composer flow, and does not verify hosted OAuth or hosted project settings.

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

Apply `20261023120000_drop_claim_invites.sql`, `20261023130000_drop_claimed_sender_broadcast.sql`, `20261023140000_sender_claimed_drop_status.sql`, `20261023150000_private_media_claim_invites.sql`, `20261023160000_reconcile_orphan_drop_media.sql`, and `20261023170000_drop_pending_media_retention.sql` in filename order with the other Supabase migrations. The first adds a private token-digest table and authenticated-only issue, reissue, and claim RPCs. The recipient must have a Drop profile and explicitly claim the text, photo, or GIF drop; page load alone does not consume the link. Reissuing rotates the capability, while a media drop's immutable 30-day claim/access deadline is measured from its first send. The second migration sends only the drop ID to the sender's private inbox topic after a successful claim. The third exposes only the authenticated sender's own claimed drop IDs; it does not return token or recipient-account data. The fourth adds sender-owned private media claim support, checks media remains inaccessible until claim, caps media links at 7 days and claims at 30 days, and queues expired unclaimed media for cleanup. The fifth adds a service-role-only cursor scan for finalized, unlinked `drop-media` objects older than 30 days; it checks path and metadata and enqueues valid orphans into the same cleanup worker. The sixth adds a service-role-only scan for valid, unlinked staging objects under `/pending/` whose Storage creation time is at least 30 days old. It supports both the legacy four-segment path and the current five-segment path. Queued paths stay blocked while Storage removal is pending; successful removals keep a path tombstone for at least 24 hours, cleared on a later scan. Relay claim links are not included. Sent cards and sender detail show “Claimed by [name]” after reload, while regular delivered drops remain “Delivered.”

### Scheduled cleanup for unclaimed photo/GIF drops

Before relying on photo/GIF claim links, deploy the `cleanup-expired-drop-media` Edge Function and configure its private request secret. Supabase injects the project URL and secret API-key set into the Edge runtime; add `DROP_MEDIA_CLEANUP_SECRET` in the project's Edge Function Secrets settings. Keep its value private and out of Git.

In the project database, enable `pg_cron` and `pg_net` and create these three Vault secrets. Use the project URL, its anon/publishable API key, and the same high-entropy cleanup secret configured for the Edge Function:

```sql
select vault.create_secret('<project-url>', 'drop_media_cleanup_project_url');
select vault.create_secret('<anon-or-publishable-api-key>', 'drop_media_cleanup_anon_key');
select vault.create_secret('<same-cleanup-secret-as-the-function>', 'drop_media_cleanup_secret');
```

After those values exist, apply `20261023150000_private_media_claim_invites.sql`, `20261023160000_reconcile_orphan_drop_media.sql`, and `20261023170000_drop_pending_media_retention.sql` in order. Deploy the updated `cleanup-expired-drop-media` Edge Function only after all three migrations are applied; it scans finalized orphans and abandoned staging uploads before leasing the Storage deletion queue. If the schedule migration ran before the extension or Vault setup, run the scheduler as the database owner and confirm the job is present:

```sql
select private.schedule_drop_media_cleanup() as scheduled;
select jobname, schedule from cron.job where jobname = 'drop-expired-drop-media-hourly';
```

The first query must return `true`; the second should show the hourly `drop-expired-drop-media-hourly` job. The media-issue RPC fails closed while that schedule or any required Vault value is missing. At the 30-day cutoff, SQL denies new claims and media reads, then the hourly worker retries object removal through the Supabase Storage API. Free-plan projects may pause after low activity, and worker or Storage outages can delay physical deletion; access still ends at the database cutoff while the project is active. Never delete rows directly from `storage.objects` to remove files.

Run the privacy and transition fixture against a separate disposable PostgreSQL database. It creates its schema and data inside a transaction and rolls them back:

```bash
createdb drop-claim-smoke
psql -X -v ON_ERROR_STOP=1 -d drop-claim-smoke -f tests/db/drop_claim_invites.sql
dropdb drop-claim-smoke
```

The fixture covers authenticated RPC grants, pending-note privacy, digest-only storage, token rotation, whitespace-preserving reissue, claim expiry, sender/outsider denial, same-account retries after expiry, the private ID-only sender broadcast with duplicate suppression, sender-scoped durable claim status after invite expiry, and media cleanup. Finalized-orphan cases cover bounded cursor pages, cursor reset, old objects behind the cursor, the near-30-day boundary, invalid batch sizes, linked/pending/malformed/recent/wrong-bucket exclusions, grants, and duplicate suppression. Pending-upload cases cover the 30-day cutoff, malformed/recent exclusions, service-only scanning, the four-segment legacy path, authenticated five-segment upload acceptance, queued-path rejection, retry, idempotent finish, and the 24-hour tombstone. It also confirms ordinary delivered notes and pending/revoked invites are excluded. Relay trigger controls check recipient/sender broadcasts and reject an unrelated-update duplicate. It rolls back its schema and data. It does not exercise live Realtime channel authorization, the collection RPC, hosted Supabase settings, browser-to-browser authentication, or concurrent sessions. Cleanup scans read `storage.objects` in ordered cursor pages without adding an index to the managed table. Supabase assigns Storage entities to `supabase_storage_admin` and restricts index creation on existing managed-schema tables ([permissions](https://supabase.com/docs/guides/platform/permissions), [managed-schema restrictions](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025)). The batch size bounds candidate work, but PostgreSQL may still scan or sort more rows as the bucket grows; large-bucket query cost is unverified. Revisit with an indexed app-owned upload ledger or Storage API discovery if this becomes material.

## Relay handoffs

Apply `20261018000100_relay_handoff_tokens.sql` and `20261022000000_restrict_relay_handoff_column_select.sql` after the existing letter and media migrations. The later migration grants authenticated participants only the route columns and keeps the bearer token and retry key private. Relay invites are bearer links: the first invite expires after 10 minutes, and accepting it issues a carrier capability that lasts 30 days. A carrier capability can mint a fresh 10-minute handoff pass when its holder is ready to pass the drop on. Share each invite only with the intended next carrier. Carriers can add route events but cannot read the drop's text or media. Sender route views refresh immediately, every 15 seconds while visible, and when the tab returns; a manual refresh is also available.

Without Supabase credentials, the app runs with local seeded examples and local text drafts. Real sends and cross-account media delivery are unavailable in that mode.
