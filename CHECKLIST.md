# Drop integration checklist

Updated: 2026-10-25

## Candidate and PR

- [x] Refresh `origin/main` and confirm the integration branch is based on the current main tip.
- [x] Review the Relay token handoff and launcher changes with the focused review agents.
- [x] Run the app test suite, lint, TypeScript check, production build, and external-directory launcher smoke.
- [x] Push each verified code commit separately to `feat/demo-relay-preview`.
- [x] Merge [PR #1](https://github.com/arjeetanand/drop/pull/1) into `main`.
- [x] Open [PR #2](https://github.com/arjeetanand/drop/pull/2) for the local claim-smoke repair; use its page as the source of truth for current checks and merge state.
- [x] Trace the GitGuardian findings to test UUID fixtures; current test files use deterministic UUIDv4 fixtures. Earlier commits in the PR history still trigger the scanner.

## Local Docker and claim-smoke repair (2026-10-24)

- [x] Start the local Supabase services in Docker and configure `pg_cron`, `pg_net`, Vault values, the hourly cleanup schedule, and the local Edge Function runtime.
- [x] Correct the bearer-link smoke: reject an invalid token before claim, retain cross-account replay denial after claim, and include legitimate claim recipients in recent-recipient history.
- [x] Pass `npm run test:local-supabase`, `npm test`, lint, type-check, and production build; confirm the smoke removes its disposable accounts.
- [x] Verify rendered mobile email sign-in and two-account text/photo/GIF claim/open in isolated Chrome at 390×844 using local Mailpit; confirm both attachments render, requests stay on local origins, and disposable accounts, media, emails, and browser profiles are cleaned up.
- [ ] Verify a real aged-object deletion through the local cleanup worker; no Storage deletion was triggered in this repair.

## Drop back fresh-draft isolation (2026-10-24)

- [x] Make **Drop back** force a persisted new draft addressed to the received drop's sender; preserve the previous draft before navigation and show a recovery message if that write cannot be verified.
- [x] Add unit regressions for a blank-caption photo draft, its exact attachment bytes, sender normalization, and invalid-handle refusal.
- [x] Pass `npm test` (274/274), lint, no-incremental TypeScript, browser-script syntax, `git diff --check`, and `npm run build -- --webpack`.
- [x] Pass the isolated Chrome `--drop-back-only` flow at 390×844: stable draft ID, sender handle in the composer, original photo record/bytes unchanged, no send, no overflow, and no cross-origin requests.
- [x] Push code commit `a71612b`, add the local Docker runtime record, and merge [PR #5](https://github.com/arjeetanand/drop/pull/5) into `main` at `e098388`.
- [ ] Verify with a screen reader and on a physical device. The browser case uses a local received-demo fixture, not a real hosted account-to-account drop.

## Docker-backed local runtime recovery (2026-10-24)

- [x] Confirm the existing Rancher Desktop daemon and Drop Supabase services are available through the approved local runtime context; leave Docker socket permissions and global settings unchanged.
- [x] Restart Drop with `./run.sh start` and verify HTTP 200 on port 4004; verify local Auth and Mailpit return HTTP 200.
- [x] Pass `npm run test:local-supabase` across eight groups; the test script removes its five disposable accounts and temporary media.
- [x] Leave Drop running on port 4004 for local use.

## Share-target rollback and private-claim QR check (2026-10-25)

- [x] Roll back failed PWA imports by their captured account and preserve a committed draft/attachment when cleanup is skipped during an account switch or cannot confirm deletion.
- [x] Add regression coverage for a switch during attachment cleanup and make current-account deletion return an explicit `deleted` or `account-switched` result while preserving the existing public delete API.
- [x] Pass `npm test` (280/280), lint, TypeScript, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check`.
- [x] Push code commit `f0c6c70` to `origin/feat/pwa-share-acceptance`.
- [x] Open draft [PR #8](https://github.com/arjeetanand/drop/pull/8) for the PWA branch; it remains open and in draft while browser/build follow-ups remain.
- [x] Verify the separate local private-claim QR flow: local email sign-in, one successful invite RPC, correct pending sender row, accessible QR show/hide, and exact QR-token decode using Vision and Core Image. No hosted project was contacted.
- [ ] Repeat the share-target browser smoke with a clean Chrome startup. One run exercised import, replay, reload, and responsive behavior but failed its final console check on a cold-start React warning; two later attempts timed out before DevTools started.
- [ ] Retry the production build when `fonts.googleapis.com` resolves; the latest Webpack build attempt stopped on DNS `ENOTFOUND` during `next/font`.
- [ ] Resolve the port-4004 runtime conflict from the canonical Drop checkout. The feature worktree's `./run.sh start` detected PID 47239 from `/Users/arjeetanand/projects/drop` and refused to stop it; HTTP requests to `localhost:4004` failed, so that process was left untouched.
- [ ] Verify installed-PWA/OS share-sheet behavior, screen-reader output, physical-device behavior, hosted two-account delivery, and actual 30-day Storage cleanup.
- [ ] Keep [PR #7](https://github.com/arjeetanand/drop/pull/7) open. Its QR browser check passed; do not merge without the user's go-ahead.

## Product checks still open

- [ ] Verify the installed PWA share target and OS share sheet in a browser/device that supports the required flow.
- [ ] Check screen-reader announcements and physical-device keyboard/safe-area behavior.
- [ ] Validate two-account photo/GIF claims and actual 30-day Storage cleanup against the approved Free Supabase project.
