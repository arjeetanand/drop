# Drop handoff

Updated: 2026-10-22

## Active checkout and Git

- Active code checkout: /Users/arjeetanand/projects/drop
- GitHub remote: private repository arjeetanand/drop
- Current branch: ux/accessibility-motion-desktop
- Latest code commit: d742c285a5278ba63d5db567ff44fed20c38f57a (fix: require consent for relay location), pushed to origin.
- Parent commit: ea25d3d9387bf87facc3dc39354c0d689528cd0c
- The branch is not merged and no pull request was created.
- The former OneDrive path /Users/arjeetanand/Library/CloudStorage/OneDrive-OracleCorporation/projects/drop is absent. No folder was available to delete; no files were removed. /letter was not touched.
- .env.local is already present in the active checkout, has mode 600, is ignored by Git, and is not tracked. Its contents were not read or committed.

## Change inventory

- Removed third-party reverse geocoding from the relay handoff flow. QR and manual PIN flows ask before accessing current device location; manual neighborhood entry remains available, and location stays in local route history after a successful handoff.
- Removed the location suggestion action from secure token invites, which now use manual neighborhood entry and do not request device location.
- Added a screen-reader status announcement for handoff completion and whether the current device location was saved.
- Disclosed that legacy QR URLs contain the previous carrier's coordinates and send that URL to Drop when opened. This change does not migrate existing QR payloads.

## Verification

- `npm test`: 85/85 passed. `npm run lint`, `npm run typecheck -- --incremental false`, `npm run build -- --webpack`, and `git diff --check` passed.
- Playwright/Chrome at 390px checked QR handoff with location unchecked, opted in, and denied; manual PIN with location opted in; and a secure token invite with a manual neighborhood. The checks saw zero geocoder requests and no page runtime errors. Fixtures used synthetic data; this is not a hosted or cross-device handoff test.
- Production build completed. Next emitted non-fatal Browserslist freshness and ambiguous Tailwind class warnings.
- `./run.sh` serves this checkout at `http://localhost:4004`; the app returned HTTP 200 after restart.
- `.env.local` remains ignored and was not read or staged. The branch push contains only the eight listed code, test, and project-note files.

## Remaining work

- Legacy QR links still put previous-carrier coordinates in the URL and send them to Drop when opened; migrate these to server-issued capabilities before claiming that path avoids server receipt.
- Verify a valid carrier-issued handoff across accounts/devices and against hosted Supabase. No hosted Drop project has been created.
- Verify keyboard operation, reduced-motion behavior, desktop layout, and real-device keyboard/safe-area behavior.
- Continue to keep /letter read-only and do all new Drop work in /Users/arjeetanand/projects/drop.

## Run locally

From /Users/arjeetanand/projects/drop, run npm ci, then ./run.sh. Drop uses http://localhost:4004; ./run.sh stop stops the project-owned process. The local Supabase smoke environment uses port 5004 and browser QA is reserved port 6004.
