# Drop handoff

Updated: 2026-10-22

## Active checkout and Git

- Active code checkout: /Users/arjeetanand/projects/drop
- GitHub remote: private repository arjeetanand/drop
- Current branch: fix/local-auth-redirects
- Auth redirect fix commit: 429e555 (fix: allow local Supabase auth callbacks on Drop ports), pushed to origin/fix/local-auth-redirects.
- Parent checkpoint: aebdc53 (docs: record relay location verification).
- The branch tracks origin/fix/local-auth-redirects; it is not merged and no pull request was created.
- The former OneDrive path /Users/arjeetanand/Library/CloudStorage/OneDrive-OracleCorporation/projects/drop is absent locally. A live OneDrive listing of `projects` showed 16 immediate child folders and no `drop` folder, so there was nothing to delete. The separate `/letter` folder was not opened or changed.
- .env.local is already present in the active checkout, has mode 600, is ignored by Git, and is not tracked. Its contents were not read or committed.

## Change inventory

- Removed third-party reverse geocoding from the relay handoff flow. QR and manual PIN flows ask before accessing current device location; manual neighborhood entry remains available, and location stays in local route history after a successful handoff.
- Removed the location suggestion action from secure token invites, which now use manual neighborhood entry and do not request device location.
- Added a screen-reader status announcement for handoff completion and whether the current device location was saved.
- Disclosed that legacy QR URLs contain the previous carrier's coordinates and send that URL to Drop when opened. This change does not migrate existing QR payloads.
- Configured local Supabase Auth redirects for Drop's 4004, 5004, and 6004 ports while preserving the old 3000 callback. Added a regression test and updated setup notes.

## Verification

- For commit 429e555, `npm test` passed 86/86, `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. `.env.local` remained ignored and was not staged.
- The local Supabase config was not loaded by a running stack and email-link sign-in was not verified; no local Supabase service was running. The change was pushed to the task branch, not merged.
- Playwright/Chrome at 390px checked QR handoff with location unchecked, opted in, and denied; manual PIN with location opted in; and a secure token invite with a manual neighborhood. The checks saw zero geocoder requests and no page runtime errors. Fixtures used synthetic data; this is not a hosted or cross-device handoff test.
- The prior production build completed. Next emitted non-fatal Browserslist freshness and ambiguous Tailwind class warnings.
- `./run.sh` serves this checkout at `http://localhost:4004`; the app returned HTTP 200 after restart.
- The latest push contains the five tracked files in commit 429e555. `.env.local` was not read or staged.

## Remaining work

- Legacy QR links still put previous-carrier coordinates in the URL and send them to Drop when opened; migrate these to server-issued capabilities before claiming that path avoids server receipt.
- Verify a valid carrier-issued handoff across accounts/devices and against hosted Supabase. No hosted Drop project has been created.
- Restart local Supabase after its runtime is available, then verify email-link return to port 4004.
- Verify keyboard operation, reduced-motion behavior, desktop layout, and real-device keyboard/safe-area behavior.
- Continue to keep /letter read-only and do all new Drop work in /Users/arjeetanand/projects/drop.

## Run locally

From /Users/arjeetanand/projects/drop, run npm ci, then ./run.sh. Drop uses http://localhost:4004; ./run.sh stop stops the project-owned process. The local Supabase smoke environment uses port 5004 and browser QA is reserved port 6004.
