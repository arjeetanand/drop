# Drop integration checklist

Updated: 2026-10-24

## Claim first-use profile setup (2026-10-24)

- [x] Make the handle first and required on private-claim return; keep display name and bio optional and collapsed.
- [x] Add handle-only persistence coverage and exercise the blank-optional-fields profile through local Supabase text/image/GIF claim smoke.
- [x] Verify keyboard disclosure and responsive layout at mobile portrait/landscape and desktop sizes; pass unit, lint, type, build, browser, and local Supabase checks.
- [x] Stabilize the focused browser run with a fresh page per viewport, a page-load wait, and failure diagnostics; repeat the five-viewport run twice with zero cross-origin requests blocked.
- [x] Verify the rendered email-link sign-in → required-handle profile save → sealed pre-claim state → explicit claim/open flow against local Docker Supabase; verify test mail, drop, accounts, and temporary files are removed.
- [x] Make the browser runner reject a non-local Docker endpoint and Supabase URL credentials/query/fragment; recover accounts by exact email plus a unique marker if creation response is lost.
- [x] Push profile setup commit `2b53bcd` and browser-to-claim follow-up `aabe941` on `fix/claim-first-use-profile`; both are tracked by [PR #3](https://github.com/arjeetanand/drop/pull/3).
- [x] Push smoke-stability commit `ee844cb` to the same branch and update PR #3; keep the PR unmerged pending explicit approval.
- [ ] Merge PR #3 after explicit approval.
- [ ] Verify hosted account-to-account behavior, aged-object deletion, physical-device input, and spoken screen-reader output.

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
- [ ] Verify a real aged-object deletion through the local cleanup worker; no Storage deletion was triggered in this repair.

## Product checks still open

- [ ] Verify the installed PWA share target and OS share sheet in a browser/device that supports the required flow.
- [ ] Check screen-reader announcements and physical-device keyboard/safe-area behavior.
- [ ] Validate two-account photo/GIF claims and actual 30-day Storage cleanup against the approved Free Supabase project.
