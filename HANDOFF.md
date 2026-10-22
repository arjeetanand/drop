# Drop handoff

Updated: 2026-10-22

## Active checkout and Git

- Active code: `/Users/arjeetanand/projects/drop`
- Previous OneDrive checkout: absent. The `letter` folder was not changed.
- `.env.local` is present in the active checkout, mode `600`, and ignored by Git. Its contents were not displayed or committed.
- Branch: `fix/idempotent-drop-media-finalize`
- Pushed commit: `a59457817045e588f97573334a1731f033f97d3a` (`fix idempotent media finalization retries`)
- The branch is pushed to `origin`; it is not merged and no PR was created.

## Change inventory

- Persist a stable upload ID with a selected media draft and reuse it after resume or retry.
- Recover a final private media object after a lost response only when its bytes match the freshly validated retry.
- Reject a different attachment on a linked draft and attempt to remove its staging object.
- Add retry, conflict-cleanup, and draft-persistence regression coverage.
- Reserve app/test ports 4004/5004/6004, make `run.sh` safely restart only a Drop-owned listener, and update setup documentation.

## Verification

- `npm test`: 84/84 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build -- --webpack`: passed. The default Turbopack build could not spawn a helper process in this environment.
- Local syntax checks, `bash -n run.sh`, and `git diff --check`: passed.
- In an isolated checkout with the same locked dependencies, `run.sh` start/restart/stop worked and `/` plus `/compose` returned HTTP 200. This was a local runtime smoke check, not a browser/device test.
- The full suite and runtime checks used an isolated verification copy because the active checkout has no `node_modules`. No packages were installed.

## Remaining checks

- The local Supabase auth endpoint at `127.0.0.1:54321` was unavailable, so the authenticated storage smoke test did not run. No local database was started or reset; no hosted Supabase project exists.
- Verify the lost-response retry in a real browser with two disposable local accounts when the local Supabase stack is available.
- Human-relay browser handoff, hosted auth/delivery, and device checks remain open in `tasks/todo.md`.

## Run locally

From `/Users/arjeetanand/projects/drop`, install the locked dependencies with `npm ci`, then run `./run.sh`. Drop serves at `http://localhost:4004`; the script supports `start`, `restart`, and `stop`. The local Supabase smoke test uses port 5004 and browser QA is reserved port 6004.

The next Git action is review of the pushed branch; request approval before merging it into the default branch.
