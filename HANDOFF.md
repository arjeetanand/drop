# Drop handoff

Updated: 2026-10-22

## Active checkout and Git

- Active code checkout: /Users/arjeetanand/projects/drop
- GitHub remote: private repository arjeetanand/drop
- Current branch: feat/drop-live-inbox-arrival (based on `87a2e10`, the pushed `feat/relay-route-live-refresh` checkpoint)
- Live inbox commit: `1cf321d` (`feat: surface new drops in live inbox`), pushed to `origin/feat/drop-live-inbox-arrival`; not merged and no pull request created.
- Prior feature commits, pushed to origin/feat/relay-route-live-refresh:
  - 21f8120 (feat: refresh shared relay routes live)
  - bc21947 (security: restrict relay route reads to public columns)
- Base checkpoint: 132f12c (docs: update Drop migration and auth handoff), on origin/fix/local-auth-redirects.
- Parent checkpoint: aebdc53 (docs: record relay location verification).
- The feature branch tracks its GitHub branch; it is not merged and no pull request was created.
- The former OneDrive path /Users/arjeetanand/Library/CloudStorage/OneDrive-OracleCorporation/projects/drop is absent locally. A live OneDrive listing of `projects` showed 16 immediate child folders and no `drop` folder, so there was nothing to delete. The separate `/letter` folder was not opened or changed.
- .env.local is already present in the active checkout, has mode 600, is ignored by Git, and is not tracked. Its contents were not read or committed.

## Change inventory

- Removed third-party reverse geocoding from the relay handoff flow. QR and manual PIN flows ask before accessing current device location; manual neighborhood entry remains available, and location stays in local route history after a successful handoff.
- Removed the location suggestion action from secure token invites, which now use manual neighborhood entry and do not request device location.
- Added a screen-reader status announcement for handoff completion and whether the current device location was saved.
- Disclosed that legacy QR URLs contain the previous carrier's coordinates and send that URL to Drop when opened. This change does not migrate existing QR payloads.
- Configured local Supabase Auth redirects for Drop's 4004, 5004, and 6004 ports while preserving the old 3000 callback. Added a regression test and updated setup notes.
- Added visible route refresh to sender relay and journey screens: immediate read, 15-second polling while visible, refresh on tab return, manual retry, new-handoff announcements, and stale-route/error status. Empty journeys now wait for their first carrier in the copy; expired carrier invites hide QR/copy actions, announce expiry once, and offer a replacement.
- Restricted authenticated reads from `public.relay_handoffs` to route columns, excluding `source_token` and `request_id`. Added a disposable-database regression for sender/recipient access, outsider exclusion, and denied sensitive columns.
- Added a live incoming-drop cue for Home and Mailbox. Supabase Broadcast sends only the drop ID to the recipient's private topic; the client reloads through the existing row-level-security query. The visible tab retries every 60 seconds, and signals that overlap an inbox fetch queue one follow-up read.
- Home reuses the featured incoming-drop card for the “Just landed” label; Mailbox has a dismissible direct-open cue. Burst arrivals get a count; only dispatched or delivered received drops are eligible.

## Verification

- For commit 429e555, `npm test` passed 86/86, `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. `.env.local` remained ignored and was not staged.
- For commits bc21947 and 21f8120, `npm test` passed 93/93, `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm run build -- --webpack` passed. The relay column-privilege SQL regression passed against a throwaway local PostgreSQL cluster in `/private/tmp`; the hosted Supabase project was not touched.
- Live inbox slice: `npm test` passed 101/101, `npm run lint`, `npx tsc --noEmit --incremental false`, `git diff --check`, and `npm run build -- --webpack` passed. Focused regressions cover a signaled drop during the first inbox response and a broadcast arriving during an in-flight read. The build emitted only the existing Browserslist freshness and ambiguous Tailwind easing warnings. Home and Mailbox each returned HTTP 200 on the local app at port 4004.
- The inbox unit tests mock Supabase Realtime; the new broadcast policy and trigger have not been applied to local or hosted Supabase. Account-to-account delivery is not verified.
- The live inbox feature is committed and pushed to its task branch; main/default branch was not changed.
- The local Supabase config was not loaded by a running stack and email-link sign-in was not verified; no local Supabase service was running.
- Playwright/Chrome at 390px checked QR handoff with location unchecked, opted in, and denied; manual PIN with location opted in; and a secure token invite with a manual neighborhood. The checks saw zero geocoder requests and no page runtime errors. Fixtures used synthetic data; this is not a hosted or cross-device handoff test.
- The prior production build completed. Next emitted non-fatal Browserslist freshness and ambiguous Tailwind class warnings.
- Browser and screen-reader checks of the new route UI were not available in this environment; no Chromium/Playwright/DevTools runtime is configured. A rendered check at phone and desktop widths remains pending.
- `./run.sh` serves the GitHub clone at `http://localhost:4004`; `/relay?letter=drop-route-check` and `/journey?letter=drop-route-check` each returned HTTP 200.
- `.env.local` is present in the active checkout, mode 600, ignored by Git, and untracked. Its contents were not read or staged.
- The earlier route-security work remains on `feat/relay-route-live-refresh`, is not merged, and has no pull request.

## Remaining work

- Legacy QR links still put previous-carrier coordinates in the URL and send them to Drop when opened; migrate these to server-issued capabilities before claiming that path avoids server receipt.
- Verify a valid carrier-issued handoff across accounts/devices and against hosted Supabase. No hosted Drop project has been created.
- Apply `20261022100000_drop_inbox_broadcast.sql` to the Free Drop Supabase project and verify real recipient notifications between two disposable accounts.
- Apply `20261022000000_restrict_relay_handoff_column_select.sql` to the Free Drop Supabase project when that project is available; only the disposable local PostgreSQL regression has been run so far.
- Restart local Supabase after its runtime is available, then verify email-link return to port 4004.
- Verify Home/Mailbox arrival rendering at phone and desktop sizes, keyboard behavior, and screen-reader status announcements when browser automation is available; check real-device keyboard/safe-area behavior.
- Continue to keep /letter read-only and do all new Drop work in /Users/arjeetanand/projects/drop.

## Run locally

From /Users/arjeetanand/projects/drop, run npm ci, then ./run.sh. Drop uses http://localhost:4004; ./run.sh stop stops the project-owned process. The local Supabase smoke environment uses port 5004 and browser QA is reserved port 6004. The current feature branch is feat/drop-live-inbox-arrival at 1cf321d. Prior route work remains pushed on feat/relay-route-live-refresh at bc21947 and 21f8120.
