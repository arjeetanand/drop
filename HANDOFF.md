# Drop handoff

Updated: 2026-10-22

## Active checkout and Git

- Active code: /Users/arjeetanand/projects/drop
- The old OneDrive path is absent locally, and the connected OneDrive projects folder has no Drop child. There was no OneDrive Drop folder to delete; no content was removed.
- .env.local already exists in the active checkout with mode 600 and is ignored by Git. Its contents were not read or committed.
- /letter was not touched.
- Current branch: ux/reaction-privacy-mobile
- Tested code commit: d94226bd8f0b77b560b9acbebc64da56a8de9c8e (pushed to origin)
- Base branch: fix/idempotent-drop-media-finalize at a4f59524c138b087012418d741fb2c49b07efab1
- The branch is not merged and no pull request was created.

## Change inventory

- Persist a stable upload ID with a selected media draft and reuse it after resume or retry.
- Recover a final private media object after a lost response only when its bytes match the freshly validated retry.
- Reject a different attachment on a linked draft and attempt to remove its staging object.
- Add regression coverage for lost-response retries, staged cleanup, and upload-ID persistence.
- Make run.sh safely restart only a Drop-owned listener, reserve ports 4004/5004/6004, and keep setup documentation current.
- Keep received-drop reactions at least 44px and lay five buttons in one row at 360px.
- Explain live reaction visibility for sender and recipient, while labeling local samples and demos as device-only.
- Update the workspace plan and task checklist to reflect the local checkout and remaining browser checks.

## Verification

- npm test: 84/84 passed.
- npm run lint: passed.
- npm run typecheck: passed.
- Webpack production build compiled and generated routes with Next.js's test-only Google Fonts mock. An unmocked build could not reach fonts.googleapis.com in this environment (ENOTFOUND).
- Checks ran in an isolated copy with the same lockfile and source synced from the active checkout. No packages were installed in the active checkout.
- The reaction row uses 236px for five 44px targets with 4px gaps; the source review estimated about 248px available at 360px. No rendered browser check was available, so 360/390/430px behavior remains open.
- The local Supabase Auth endpoint at 127.0.0.1:54321 was unavailable. No local database was started or reset, and no hosted project was created.

## Remaining checks

- Render and interact with the received-drop reaction flow at 360px, 390px, and 430px; verify keyboard, reduced motion, and device safe areas.
- Run authenticated local Supabase send/retry checks with two disposable accounts when the local stack is available.
- Verify the optional relay handoff in a browser and hosted account-to-account behavior.
- Request approval before merging the pushed task branch.

## Run locally

From /Users/arjeetanand/projects/drop, install locked dependencies with npm ci, then run ./run.sh. Drop serves at http://localhost:4004; the script supports start, restart, and stop. The local Supabase smoke test uses port 5004 and browser QA is reserved port 6004.

The active checkout still has no node_modules, so ./run.sh has not been started from this checkout. The next work should continue in this local clone and keep /letter read-only.
