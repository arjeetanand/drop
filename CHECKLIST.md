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
- [x] Confirm [PR #8](https://github.com/arjeetanand/drop/pull/8) remains `OPEN` and `DRAFT`; docs were pushed at branch head `1603719` and GitGuardian passed. The 280-test, lint, type, build, and local browser checks apply to code commit `f0c6c70`. The request to mark it ready was blocked by the automatic review gate because it could notify reviewers; leave it draft pending explicit approval.
- [x] Verify the separate local private-claim QR flow: local email sign-in, one successful invite RPC, correct pending sender row, accessible QR show/hide, and exact QR-token decode using Vision and Core Image. No hosted project was contacted.
- [x] Pass `node scripts/browser-demo-smoke.mjs http://127.0.0.1:6004 --share-target-only` with a synthetic image: import, same-ID replay, reload preservation, and 375×844, 390×844, 844×390, and 1440×900 layouts; no cross-origin or backend writes.
- [x] Pass `npm run build -- --webpack` in the authorized local build context; Next generated 22 routes. Only existing Browserslist freshness and Tailwind easing warnings remain.
- [x] Leave the canonical app on port 4004 untouched; run the isolated browser check on port 6004 and stop only that test server afterward.
- [ ] Verify installed-PWA/OS share-sheet behavior, screen-reader output, physical-device behavior, hosted two-account delivery, and actual 30-day Storage cleanup.
- [x] Pass the requested local QR browser check for PR #7. Keep the PR unmerged pending the user's merge approval.

## Pilot acceleration checkpoint (2026-10-25)

- [x] Verify the core local text pilot on `feat/recipient-unread-e2e` at `429a629`: two disposable accounts complete send, unread receipt on mobile and desktop, explicit open/read-state clearing, reaction, and sender-visible reaction after reload.
- [x] Pass the latest local Supabase rehearsal on that branch across nine groups covering auth/profile setup, text/photo/GIF claims, privacy, reactions, media finalization, relay collection, and legacy relay handling; disposable data cleanup completed.
- [x] Pass PWA branch tests (280/280), lint, TypeScript, Webpack production build, and the focused share-target browser smoke.
- [ ] Complete the secret-free GitHub Actions gate on `chore/pilot-ci`; draft PR #9 is open, GitGuardian passed, and its first Actions run passed on code commit `d27e381`. Recheck after the pending docs push changes the head.
- [ ] Review draft PR #10's dependency patch; it has zero critical audit findings but still has 5 high and 1 moderate audit findings, and no Actions run yet.
- [ ] Create/configure the approved Free hosted Supabase project, deploy migrations/functions/secrets, then run hosted disposable-account checks. No hosted end-to-end pilot proof exists yet.

## Product checks still open

- [ ] Verify the installed PWA share target and OS share sheet in a browser/device that supports the required flow.
- [ ] Check screen-reader announcements and physical-device keyboard/safe-area behavior.
- [ ] Validate two-account photo/GIF claims and actual 30-day Storage cleanup against the approved Free Supabase project.
