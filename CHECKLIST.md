# Drop integration checklist

Updated: 2026-10-24

## Candidate and PR

- [x] Refresh `origin/main` and confirm the integration branch is based on the current main tip.
- [x] Review the Relay token handoff and launcher changes with the focused review agents.
- [x] Run the app test suite, lint, TypeScript check, production build, and external-directory launcher smoke.
- [x] Push each verified code commit separately to `feat/demo-relay-preview`.
- [x] Open [PR #1](https://github.com/arjeetanand/drop/pull/1) into `main`; use the PR page as the source of truth for current checks and merge state.
- [x] Trace the GitGuardian findings to test UUID fixtures; current test files use deterministic UUIDv4 fixtures. Earlier commits in the PR history still trigger the scanner.

## Product checks still open

- [ ] Verify the installed PWA share target and OS share sheet in a browser/device that supports the required flow.
- [ ] Check screen-reader announcements and physical-device keyboard/safe-area behavior.
- [ ] Validate two-account photo/GIF claims and actual 30-day Storage cleanup against the approved Free Supabase project.
