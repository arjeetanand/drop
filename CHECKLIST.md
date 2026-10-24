# Drop integration checklist

Updated: 2026-10-24

## Merged integration

- [x] PR [#1](https://github.com/arjeetanand/drop/pull/1) was merged into `main` at `1141cff493bbda7ef75fbc12af8bb6a3d8d1efb7`.
- [x] The merged candidate passed 272 unit tests, lint, no-incremental TypeScript, the Webpack production build, `git diff --check`, `bash -n run.sh`, and the external-directory launcher smoke. The build produced 22 routes.
- [x] The merged tree uses deterministic UUIDv4 test fixtures. Review traced three GitGuardian findings in earlier PR commits to fixture data, not configured credentials; the scanner still sees those historical values.

## Hosted setup — blocked

- [ ] Verify the linked Supabase organization's Free plan and create the single approved Free Drop project. The organization ref is `sofucwhjqdyfensxlltl`; no Drop project exists yet. The CLI has no `SUPABASE_ACCESS_TOKEN`, and prior project creation returned 403.
- [ ] Apply migrations, configure Auth and private Storage, deploy the cleanup worker, and schedule its hourly run. Keep this project on Free with no paid add-ons.
- [ ] Run text, photo/GIF, claim, reaction, and Relay scenarios with two disposable hosted accounts; verify the actual 30-day Storage cleanup.

## Product checks still open

- [ ] Verify the installed PWA share target and OS share sheet in a compatible browser/device.
- [ ] Check screen-reader announcements and physical-device keyboard/safe-area behavior.
- [ ] Recheck rendered Relay recipient-collection and private-claim recovery flows on mobile and desktop.
