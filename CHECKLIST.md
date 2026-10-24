# Drop integration checklist

Updated: 2026-10-24

## Text Note demo (2026-10-24)

- [x] Add an attachment-free fictional Note as the first `/demo` option and reuse the existing reveal, reaction, sender-copy, and fresh-composer flow.
- [x] Preserve the active photo draft and all existing IndexedDB attachment keys and bytes; verify text-only storage and no backend/API or cross-origin request.
- [x] Pass unit tests, lint, TypeScript, browser-script syntax, diff check, production build, and isolated Chrome at 360×844, 390×844, 430×844, and 1440×900.
- [x] Push code commit `e5ee3f1` and open [PR #4](https://github.com/arjeetanand/drop/pull/4).
- [ ] Review and merge PR #4 with approval; verify screen-reader output and a physical device.

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
