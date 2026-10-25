# Drop integration checklist

Updated: 2026-10-25

## PWA share-target rollback reliability (2026-10-25)

- [x] Confirm the pilot candidate already contains the installable share manifest, service-worker target, and bounded multipart import handler.
- [x] Add account-captured rollback for in-flight imports, preserving the staged handoff and prior draft/media for retry after account or persistence failures.
- [x] Add unit coverage and make browser-smoke retry/replay assertions verify the final `letter` route and imported content.
- [x] Pass focused unit tests (46/46), full `npm test` (286/286), lint, no-incremental TypeScript, browser-smoke syntax/ESLint, and `git diff --check`.
- [x] Pass the isolated production share-target browser smoke at 375×844, 390×844, 844×390, and 1440×900. Production build passed with a temporary local-font response fixture; the unmocked build could not resolve Google Fonts DNS.
- [x] Push code commit `ff9c2ff` to `origin/feat/pilot-pwa-share`; keep the task notes in a separate commit.
- [x] Fast-forward `fix/pilot-send-account-disclosure` to the same verified code and documentation history as `feat/pilot-pwa-share`; keep `main` and PR #7 unchanged.
- [ ] Verify PWA installation and the operating-system share sheet on a supported browser/device; complete screen-reader, physical-device, and hosted account checks.

## Production browser smoke stability and pilot candidate (2026-10-25)

- [x] Replace the headless animation-state wait with a page-shell check and a 420ms settle; include animation state in failure diagnostics.
- [x] Use keyboard activation for reveal, open, and sender-copy actions after reload while retaining touch coverage in the initial 360×844 flow.
- [x] Pass the production GIF journey at 360×844, 390×844, 430×844, and 1440×900; pass the photo/reaction reload flow at 390×844.
- [x] Pass prompt-to-draft and existing attachment preservation, handleless claim choice, and saved-claim recovery at all four widths. Confirm zero cross-origin requests and no horizontal overflow.
- [x] Pass `npm test` (281/281), lint, no-incremental TypeScript, browser-smoke syntax and ESLint, and `git diff --check`; production build passed with 22 routes.
- [x] Push code commit `36f557d` to `fix/pilot-send-account-disclosure`; keep the code and documentation in separate commits.
- [ ] Complete hosted Free-project account-to-account checks, screen-reader and physical-device checks, the share-sheet check, and PR #7's QR browser check.

## Home send-account clarity (2026-10-25)

- [x] Explain on Home that the no-sign-in demo stays on this device and sending needs a Drop account.
- [x] Add a browser assertion and pass the Home prompt flow at 360×844, 390×844, 430×844, and 1440×900.
- [ ] Hosted send, screen-reader output, physical-device behavior, and the QR browser check remain open.

## Local send, same-recipient unread sync, and reaction browser flow (2026-10-25)

- [x] Verify Compose send, unread Home in two independent sessions for the same recipient at 390×844 and 1440×900, Inbox open/read, recipient 🫶 reaction, and sender live plus reloaded reaction.
- [x] Build an isolated production app with Webpack, then verify the second recipient session clears “New” from its server refresh without a document reload.
- [x] Verify exact local cleanup of the drop, reaction, auth users, profiles, app process, and temporary browser profiles; reject non-loopback Supabase and keep the service-role key out of browser environment.
- [x] Pass `npm test` (281/281), smoke-script syntax, harness ESLint, `git diff --check`, and the full authenticated local production browser run.
- [x] Confirm the Rancher Desktop Docker daemon and local Supabase stack are running; start Drop on port 4004 and verify the app, Auth, and Mailpit return HTTP 200.
- [x] Push code commit `0e672f3` to `origin/feat/recipient-unread-e2e`; record the project notes in a separate commit on the same branch.
- [ ] Verify hosted behavior, screen-reader output, and physical-device behavior. Keep PR #7 open for its separate QR browser check.

## Private unread state (2026-10-25)

- [x] Add private recipient read markers and authenticated, recipient-scoped mark/read RPCs for delivered drops.
- [x] Add unread card markers and desktop/mobile Inbox counts; clear only after full open and guard asynchronous state against account changes.
- [x] Pass `npm test` (280/280), `npm run lint`, no-incremental TypeScript, `npm run test:local-supabase` (9 groups), and the rollback-only SQL fixture.
- [x] Pass authenticated local Edge browser flow at 390×844 and 1440×900: read RPC, cleared markers, reload persistence, and cleanup of disposable records.
- [x] Pass isolated Webpack production build and `git diff --check`.
- [x] Push code commit `a416d81` to `origin/feat/recipient-unread-state`.
- [ ] Verify the same recipient in a second authenticated session; verify hosted behavior, screen-reader output, and physical-device behavior.

## Current branch state

- [x] Keep PR #7 open for the private-claim QR browser check; unread-state work remains on its own pushed branch without a PR.
- [ ] Review and merge branches only through their PRs after the remaining checks pass.

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

## Product checks still open

- [ ] Verify the installed PWA share target and OS share sheet in a browser/device that supports the required flow.
- [ ] Check screen-reader announcements and physical-device keyboard/safe-area behavior.
- [ ] Validate two-account photo/GIF claims and actual 30-day Storage cleanup against the approved Free Supabase project.
