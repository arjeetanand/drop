# Drop handoff

Updated: 2026-10-23

## Active checkout and Git

- Active code checkout: /Users/arjeetanand/projects/drop
- GitHub remote: private repository arjeetanand/drop
- Current branch: `feat/relay-token-fragment`, created from the pushed recipient-first composer checkpoint `20af1a2`.
- Recipient-first composer commit: `a9049cf` (`feat: put recipient first in drop composer`), pushed to `origin/feat/recipient-first-compose`.
- Relay token URL commit: `fd5a327` (`fix: keep relay bearer tokens out of request URLs`), pushed to `origin/feat/relay-token-fragment`; no pull request has been created.
- Live sender reaction commit: `9c375a1` (`feat: notify senders about new drop reactions`), pushed to `origin/feat/live-reaction-feedback`.
- The current branch also includes the pushed inbox checkpoint from `feat/drop-live-inbox-arrival`; its prior commits are listed below.
- Live inbox commit: `1cf321d` (`feat: surface new drops in live inbox`), pushed to `origin/feat/drop-live-inbox-arrival`; not merged and no pull request created.
- Prior handoff follow-up: `49b68a3` (`docs: record live inbox delivery`), the head of the inbox feature branch before this reaction branch was created.
- Prior feature commits, pushed to origin/feat/relay-route-live-refresh:
  - 21f8120 (feat: refresh shared relay routes live)
  - bc21947 (security: restrict relay route reads to public columns)
- Base checkpoint: 132f12c (docs: update Drop migration and auth handoff), on origin/fix/local-auth-redirects.
- Parent checkpoint: aebdc53 (docs: record relay location verification).
- `feat/live-reaction-feedback` tracks its GitHub branch; it is not merged and no pull request was created.
- The former OneDrive path `/Users/arjeetanand/Library/CloudStorage/OneDrive-OracleCorporation/projects/drop` is absent from the synced filesystem, and `projects` has no immediate `*drop*` match. No deletion was performed because the target is already absent. The separate `/letter` folder was not opened or changed.
- `.env.local` is already present in `/Users/arjeetanand/projects/drop`, has mode 600, is ignored by Git, and is not tracked. No copy was needed because the OneDrive source directory is absent. Its values were not displayed or committed; the configured Supabase URL was checked as loopback-only.

## Change inventory

- Removed third-party reverse geocoding from the relay handoff flow. QR and manual PIN flows ask before accessing current device location; manual neighborhood entry remains available, and location stays in local route history after a successful handoff.
- Removed the location suggestion action from secure token invites, which now use manual neighborhood entry and do not request device location.
- Added a screen-reader status announcement for handoff completion and whether the current device location was saved.
- Disclosed that legacy QR URLs contain the previous carrier's coordinates and send that URL to Drop when opened. This change does not migrate existing QR payloads.
- Configured local Supabase Auth redirects for Drop's 4004, 5004, and 6004 ports while preserving the old 3000 callback. Added a regression test and updated setup notes.
- Added visible route refresh to sender relay and journey screens: immediate read, 15-second polling while visible, refresh on tab return, manual retry, new-handoff announcements, and stale-route/error status. Empty journeys now wait for their first carrier in the copy; expired carrier invites hide QR/copy actions, announce expiry once, and offer a replacement.
- New server-issued carrier invites from Relay, Journey, and Pass On now put the bearer token in the URL fragment, outside the initial HTTP request. Previously issued query-token links still resolve and are rewritten to fragment form when opened.
- Restricted authenticated reads from `public.relay_handoffs` to route columns, excluding `source_token` and `request_id`. Added a disposable-database regression for sender/recipient access, outsider exclusion, and denied sensitive columns.
- Added a live incoming-drop cue for Home and Mailbox. Supabase Broadcast sends only the drop ID to the recipient's private topic; the client reloads through the existing row-level-security query. The visible tab retries every 60 seconds, and signals that overlap an inbox fetch queue one follow-up read.
- Home reuses the featured incoming-drop card for the “Just landed” label; Mailbox has a dismissible direct-open cue. Burst arrivals get a count; only dispatched or delivered received drops are eligible.
- Added sender reaction cues on Home and Mailbox and live reaction refresh on open sent-drop pages. A private sender-scoped Broadcast contains only the drop ID; reaction content is reloaded through participant RLS. Reconnect and visible-tab refresh recover missed signals, baseline and duplicate reactions are suppressed, and accessible status text names the reaction. A database guard rejects moving a reaction to a different drop.
- Reordered the composer so account readiness and recipient confirmation appear before note, photo, GIF, and styling controls. Existing recipient checks, draft persistence, invite flow, and send handling are reused.

## Verification

- For commit 429e555, `npm test` passed 86/86, `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. `.env.local` remained ignored and was not staged.
- For commits bc21947 and 21f8120, `npm test` passed 93/93, `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm run build -- --webpack` passed. The relay column-privilege SQL regression passed against a throwaway local PostgreSQL cluster in `/private/tmp`; the hosted Supabase project was not touched.
- Live inbox slice: `npm test` passed 101/101, `npm run lint`, `npx tsc --noEmit --incremental false`, `git diff --check`, and `npm run build -- --webpack` passed. Focused regressions cover a signaled drop during the first inbox response and a broadcast arriving during an in-flight read. The build emitted only the existing Browserslist freshness and ambiguous Tailwind easing warnings. Home and Mailbox each returned HTTP 200 on the local app at port 4004.
- Live sender reaction slice `9c375a1`: `npm test` passed 107/107, `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`, `git diff --check`, and `bash -n run.sh` passed. Five routes (`/`, `/mailbox`, `/letter/incoming-1`, `/compose`, `/journey`) returned HTTP 200 from the local app on port 4004. The feature commit is pushed to `origin/feat/live-reaction-feedback`; a separate documentation commit follows it on the same branch.
- Recipient-first composer `a9049cf`: `npm test` passed 107/107, lint, typecheck, Webpack production build, and `git diff --check` passed. Home, Compose, and Mailbox returned HTTP 200 on port 4004. Rendered viewport, keyboard, and safe-area checks remain open because browser automation is unavailable. The disposable PostgreSQL reaction-broadcast fixture also remains unverified; the isolated server failed with `shmget: Operation not permitted` in this sandbox. Build output included the existing Browserslist freshness and Tailwind easing warnings.
- Relay token URL slice `fd5a327`: `npm test` passed 109/109, lint, `npx tsc --noEmit --incremental false`, Webpack production build, and `git diff --cached --check` passed. `/relay/scan` returned HTTP 200 on the local app at port 4004. Browser interaction with a real fragment invite remains unverified because browser automation is unavailable. The build reported the existing Browserslist freshness and Tailwind easing warnings.
- The SQL fixture `tests/db/drop_reaction_broadcast.sql` is written but was not run: Docker was unavailable and a temporary PostgreSQL startup failed in this environment. Hosted cross-account delivery and rendered browser/screen-reader checks remain unverified.
- The inbox unit tests mock Supabase Realtime; the new broadcast policy and trigger have not been applied to local or hosted Supabase. Account-to-account delivery is not verified.
- The live inbox feature is committed and pushed to its task branch; main/default branch was not changed.
- The local Supabase config was not loaded by a running stack and email-link sign-in was not verified; no local Supabase service was running.
- Playwright/Chrome at 390px checked QR handoff with location unchecked, opted in, and denied; manual PIN with location opted in; and a secure token invite with a manual neighborhood. The checks saw zero geocoder requests and no page runtime errors. Fixtures used synthetic data; this is not a hosted or cross-device handoff test.
- The prior production build completed. Next emitted non-fatal Browserslist freshness and ambiguous Tailwind class warnings.
- Browser and screen-reader checks of the new route UI were not available in this environment; no Chromium/Playwright/DevTools runtime is configured. A rendered check at phone and desktop widths remains pending.
- `./run.sh` serves the local clone at `http://localhost:4004`; the app is left running. `/relay/scan` returned HTTP 200 after the relay URL change.
- `.env.local` is present in the active checkout, mode 600, ignored by Git, and untracked. Its values were not displayed or staged.
- The earlier route-security work remains on `feat/relay-route-live-refresh`, is not merged, and has no pull request.

## Remaining work

- Legacy `?d=` QR links still put previous-carrier coordinates in the URL and send them to Drop when opened. Use a new server-issued invite for future handoffs; old payloads are not safely convertible.
- Verify a valid carrier-issued handoff across accounts/devices and against hosted Supabase. No hosted Drop project has been created.
- Apply `20261022100000_drop_inbox_broadcast.sql` to the Free Drop Supabase project and verify real recipient notifications between two disposable accounts.
- Apply `20261022110000_drop_reaction_broadcast.sql` after the inbox broadcast migration and verify real sender reaction cues between two disposable accounts.
- Apply `20261022000000_restrict_relay_handoff_column_select.sql` to the Free Drop Supabase project when that project is available; only the disposable local PostgreSQL regression has been run so far.
- Restart local Supabase after its runtime is available, then verify email-link return to port 4004.
- Verify Home/Mailbox arrival rendering at phone and desktop sizes, keyboard behavior, and screen-reader status announcements when browser automation is available; check real-device keyboard/safe-area behavior.
- Verify the recipient-first composer in a rendered browser at 360px, 390px, and 430px, including the account-ready and signed-out states, invite return, keyboard, and safe-area behavior.
- Continue to keep /letter read-only and do all new Drop work in /Users/arjeetanand/projects/drop.

## Run locally

From /Users/arjeetanand/projects/drop, run npm ci, then ./run.sh. Drop uses http://localhost:4004; ./run.sh stop stops the project-owned process. The local Supabase smoke environment uses port 5004 and browser QA is reserved port 6004. The current branch is `feat/relay-token-fragment` at `fd5a327`, pushed to origin; it is not merged and has no pull request. Earlier inbox and route work remains on its separately pushed task branches.
