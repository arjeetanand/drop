# Drop integration checklist

Updated: 2026-10-27

## Main and PR closure checkpoint (2026-10-27)

- [x] Verify PR #15 merged; fast-forward local main to origin/main at b705b3b.
- [x] Keep localhost:4004 available and confirm the merged app returns HTTP 200.
- [x] Inventory the remaining open PRs (#3, #4, #7–#12) without treating them as merged.
- [ ] Review/update/merge only the remaining PRs that are still needed for the pilot. PR #7 authenticated QR and camera scan remain unverified; PR #11 is a dirty draft; PR #12 targets a feature branch.
- [ ] Finish the hosted Free-plan, migration reconciliation, Auth/email, 30-day cleanup, real two-account, and physical-device gates listed below before calling the hosted pilot ready.

## Relay arrival recap (2026-10-27)

- [x] Add the recipient-facing “It made it” recap after Relay collection; show only the aggregate hand count and keep private text/media out of the recap.
- [x] Keep the recap visible through the mailbox Realtime refresh, suppress the collected row until the recipient continues, and route **Open your drop** through the existing reveal flow.
- [x] Move focus to the next action and add a browser assertion for focus, recap privacy, handoff counts, and no GIF Storage request before opening.
- [x] Pass `npm test` (302/302), `npm run lint`, `npx tsc --noEmit --incremental false`, browser-script syntax, `git diff --check`, and `npm run test:browser-relay`. The isolated production browser journey passed for text and GIF at 390×844 with no overflow, failed requests, console errors, runtime exceptions, or cross-origin requests.
- [x] Commit as `6ccd4c6` and push to `origin/codex/invitee-first-send` for PR #13.
- [x] Refresh PR #13 on final head `641bb8d`: CI and GitGuardian passed and GitHub reported `CLEAN`.
- [x] Merge PR #13 into `main` through GitHub; squash commit `f314ced66598d809e9e9ec104d0cba4ea602f6eb`.
- [x] Confirm the hosted Drop project is active in the `Drop App Free` organization and all 22 `main` migrations are applied; record the three extra remote migrations for reconciliation.
- [ ] Confirm the organization's actual billing plan is Free; reconcile the three remote-only migrations before any future `db push`.
- [ ] Configure hosted Auth redirects and email delivery (or Google provider), deploy the cleanup function, and activate/verify the 30-day deletion schedule.
- [ ] Verify real hosted two-account delivery, actual OS sharing, spoken screen-reader output, and physical-device/camera behavior before a live user pilot.

## Full pilot closure to main (2026-10-27)

- [x] Include the secret-free GitHub Actions gate for pull requests and main pushes.
- [x] Restrict local destructive fixtures to the exact Drop Supabase containers and reject another project using the same port.
- [x] Stop background sidebar mailbox refresh on routes where the private shell is hidden; record the remaining duplicate recovery read as a low-priority follow-up.
- [x] Patch the dependency advisories: Next.js, eslint-config-next, and the SWC WASM fallback at 16.4.3; Sharp 0.35.5; remove unused direct Zod; refresh compatible transitive packages. npm's install/audit pass reported zero vulnerabilities.
- [x] Pass 302 unit tests, lint, Next route type generation, TypeScript, diff checks, and the Webpack production build with all 22 routes.
- [x] Commit and push dependency changes 66d8930 and f651b3e to codex/invitee-first-send.
- [x] Open draft PR #13 directly into main.
- [x] Confirm CI and GitGuardian passed on head 14cee94 with a clean merge state; this final status note triggers another workflow run.
- [x] Keep Drop's run.sh process on its documented port 4004. The current sandbox HTTP probe was blocked by local-network permission; earlier local checks returned HTTP 200.
- [x] Verify hosted project presence and migration history read-only; the project is active, all repository migrations are applied, and three remote-only migrations need reconciliation.
- [ ] Verify the organization's actual Free plan, hosted Auth email/redirect configuration, deployed cleanup function, and scheduled physical cleanup.
- [ ] Verify real two-account delivery, OS sharing, spoken screen-reader output, physical-device/camera behavior, and run the opt-in pilot.
- [x] Refresh final PR checks and merge PR #13 after the user's direct request to complete the code to `main` through a PR.

## Signed-out friend first send and unique Home inbox (2026-10-27)

- [x] Open an owner's public profile while signed out, follow **Send a drop**, and keep the pre-addressed editable draft through local Mailpit signup at 390×844.
- [x] Require a separate explicit **Send drop** tap, verify exactly one delivered text row, and sign the owner in separately to confirm the drop appears once on Home.
- [x] Remove the featured drop from the mailbox preview list so Home does not render the same received drop twice; show accurate copy when the newest drop is featured above.
- [x] Pass `npm test` (301/301), `npm run lint`, `npx tsc --noEmit --incremental false`, browser-script syntax, `git diff --check`, and the Webpack production build. The plain `npm run typecheck` was blocked by sandbox `EPERM` writing `tsconfig.tsbuildinfo`.
- [x] Commit the code as `c388a14` and push `codex/invitee-first-send` to `origin`.
- [x] Leave Drop running at `http://localhost:4004` via `./run.sh start`; verify HTTP 200.
- [ ] Open one full-pilot review PR directly into `main` after restoring GitHub CLI authentication; see the closure checklist above.
- [ ] Verify hosted account-to-account delivery, OS sharing, screen-reader output, and physical-device behavior.

## First-friend local end-to-end verification (2026-10-27)

- [x] From signed-out Home, keyboard-activate **Invite a friend**, sign up through local Mailpit, and verify the auth callback returns to exactly `/profile?invite=1` without an unrelated `next` route.
- [x] Verify the original sealed-claim handoff survives invite signup, profile sync gates the share controls, and explicit sharing contains only the public handle and canonical profile URL.
- [x] Complete the same user's private claim/reveal and verify outsider read denial and replay denial.
- [x] From a friend's signed-in session, open the sender's public profile, use its **Send a drop** link, confirm the handle in Compose, send a text reply, and verify the reply in the sender's Home inbox.
- [x] Pass both loopback browser smokes with exact disposable data cleanup: three Auth/profile fixtures and one Mailpit message in first-signup; both exact send rows, reaction, accounts, profiles, app, and browser sessions in send/react.
- [x] Pass `npm test` (301/301), `npm run lint`, `npm run typecheck`, both browser-script syntax checks, and `git diff --check`.
- [x] Push verified code commits `a238fa0` and `70214d9` separately to `codex/social-relay-pilot`; do not merge. GitHub API could not refresh PR #12's head/checks after the pushes.
- [ ] Verify hosted two-account delivery, native OS sharing, screen-reader output, and physical-device behavior before treating those gates as complete.

## Home first-friend activation (2026-10-27)

- [x] Replace the passive empty-inbox message with a clear first-drop invitation and a link to `/profile?invite=1`; keep the demo sample marked as not received.
- [x] Verify keyboard name/focus, 44px target, and clearance above fixed mobile navigation; activate the link and preserve invite context at 320×740 and 390×844.
- [x] Run each mobile accessibility viewport in a fresh isolated Edge session so focus-scroll checks do not inherit the previous viewport's page state. Review screenshots in `/private/tmp/drop-first-friend-final-verification/`.
- [x] Pass `npm test` (301/301), `npm run lint`, `npm run typecheck`, browser-script syntax, `bash -n run.sh`, `git diff --check`, and `npm run build -- --webpack`. The default Turbopack build in the scratch clone is blocked by its external `node_modules` symlink; the Webpack production build succeeds.
- [x] Push code commit `986e2e4` to `codex/social-relay-pilot`. After that code push, PR #12 was open/draft against `feat/pilot-integrated-preview`; `GitGuardian Security Checks` was pending and GitHub reported merge state `UNSTABLE`. No merge occurred.
- [ ] Verify current hosted Supabase project/Auth/migrations before real-account testing; complete hosted delivery and scheduled deletion, spoken screen-reader output, installed-PWA sharing, physical camera/device behavior, and the planned opt-in sender study.

## Compose starters and GIF Relay pilot slice (2026-10-26)

- [x] Add optional text/photo/GIF starters that fill only blank editable content, focus the field, preserve the attachment, and never send automatically.
- [x] Wrap long subject, fragment, and opened message text on narrow screens; verify the 390px detail view has no horizontal overflow.
- [x] Extend and pass the isolated text/GIF Relay browser journey, including exact final/staged Storage verification, sealed-media privacy, recipient collection/render, and confirmed cleanup.
- [x] Pass `npm test` (301/301), TypeScript, focused ESLint, runner syntax/guard, `git diff --check`, and the isolated production browser build/run. Review mobile screenshots in `/private/tmp/drop-pilot-final-evidence.Lyw5xo/`.
- [x] Commit code as `bce0f37` and push it with separate documentation commit `6a20dc4` to `feat/pilot-integrated-preview`; GitHub confirms PR #11 is open/draft on this branch and `main` remains `5138f88`. CI checks were not queried.
- [ ] Provision the approved hosted Free project when a scoped Management API token is available; complete hosted delivery/retention, screen-reader, installed-PWA sharing, and physical-device/camera checks.

## Secure Relay browser journey (2026-10-26)

- [x] Add `npm run test:browser-relay` with an isolated production app on port `6004`, exact loopback Supabase origin checks, redirect denial, and a browser request firewall.
- [x] Create the text Relay drop through signed-in sender Compose; verify Relay mode, confirmed recipient, the exact dispatched row, and cleanup by the UI-created draft ID.
- [x] Verify the sender creates the invite in the UI and the UUIDv4 bearer stays in the fragment; accept it as a carrier with geolocation denied and no location call.
- [x] Verify carrier subject/body privacy, fresh invite replay denial, exactly one handoff with null coordinate fields, sender Journey refresh, and recipient route-only view followed by explicit collection/reveal.
- [x] Pass the full 390×844 local browser run with no horizontal overflow, browser errors, or cross-origin requests; verify disposable drop/users/profiles/processes/browser/temp cleanup.
- [x] Pass `npm test` (298/298), lint, TypeScript, production build within the smoke, runner syntax, and `git diff --check`.
- [x] Push code commit `f92a78c` to the existing `feat/pilot-integrated-preview` branch. GitHub API/DNS was unavailable for a fresh PR-state check; remote `main` was last verified at `5138f88`.
- [ ] Provision and verify the hosted Free project when a Management API token is available; complete hosted delivery/retention, screen-reader, installed-PWA sharing, and physical-device/camera checks.

## Local Supabase fixture-target guard (2026-10-26)

- [x] Add a fail-closed listener, Docker endpoint, and matching-container preflight to all six fixture-writing Supabase smoke scripts.
- [x] Recognize only the exact Rancher Desktop Lima SSH mux socket process title; add regression coverage rejecting a remote SSH tunnel with Rancher markers in unrelated arguments.
- [x] Pass `npm test` (298/298), lint, no-incremental TypeScript, syntax checks for the helper and six scripts, and `git diff --check`.
- [x] Pass `npm run test:browser-qr` at 390×844 with exact drop/profile/Auth/process/temp cleanup; QR pixel decoding was unavailable.
- [x] Pass `npm run test:local-supabase` on the verified local stack, including text/photo/GIF claims, send/read/reaction, relay collection, and cleanup of five disposable accounts and temporary media. No database reset was run.
- [x] Push code commit `f8c709d` to `origin/feat/pilot-integrated-preview`; PR #11 was verified open/draft at that code head; remote `main` remains `5138f88`.
- [ ] Provision and verify the hosted Free project after a Management API token is available; then verify hosted two-account delivery, scheduled physical deletion, screen-reader output, installed-PWA sharing, and physical-device/camera behavior.

## Integrated pilot candidate (2026-10-26)

- [x] Assemble the verified pilot changes on `pilot/combined-verification`, based on `feat/pilot-integrated-preview` at `f0c015a`.
- [x] Add a route-independent sweep for expired claim handoffs on app startup, `pageshow`, and focus; keep the existing 10-minute TTL and bearer claim flow. Code commit: `2eb4071`.
- [x] Add private-claim QR display and clear the rendered QR when account or draft changes. Code commits: `98cb6aa` and `f8cbde3`; the existing `qrcode.react@4.2.0` dependency is reused.
- [x] Pass the combined `npm test` suite (288/288), `npm run lint`, `npm run typecheck`, and `git diff --check`.
- [x] Pass `npm run build -- --webpack`; Next.js compiled and generated all 22 routes. Existing Browserslist freshness and ambiguous Tailwind easing warnings remain.
- [x] Pass the authenticated local QR browser flow at 390×844 on `pilot/qr-integration`: private link issuance, QR render, keyboard focus, hide/show stability, bearer fragment placement, screenshot decode matching the displayed link, no console/page errors, and exact fixture cleanup. Details: [QR browser verification](./docs/pilot-qr-verification.md).
- [x] Add `npm run test:browser-qr` as a repeatable local QR browser smoke (code commits `9e764e8` and `2a9cf49`, pushed to the existing pilot branch); it checks 390×844 issue/privacy/accessibility, fragment-only link shape, stable hide/show, draft reset, redirect-denying loopback Supabase requests, and exact cleanup. Browser QR decoding was unavailable, and the earlier manual pixel-decode result remains separate.
- [x] Pass the local 31-day staged-media deletion check through the cleanup worker; retain a recent object and remove only the exact test fixtures. Details: [retention verification](./docs/pilot-retention-verification.md).
- [x] Append issue/cause/resolution and evidence to `LEARNINGS.md`.
- [x] Transfer the tested commits and docs into canonical `feat/pilot-integrated-preview` at `d9d9823`; verify the canonical branch is clean and the app, local Auth, and Mailpit return HTTP 200.
- [x] Push the tested update through code checkpoint `9781ed6` to the existing pilot branch; PR #11 was open/draft at that head, PR #7 stayed open at `dec1608`, and remote `main` stayed at `5138f88`.
- [ ] Verify hosted account-to-account delivery and scheduled physical deletion, actual screen-reader output, installed-PWA/OS sharing, and physical-device/camera scanning.

## Pilot accessibility follow-up (2026-10-25)

- [x] Raise Home's send-requirement helper to at least 4.5:1 and assert its rendered computed-color contrast in a real browser.
- [x] Keep photo/GIF media exposed with the meaningful fallback names “Attached photo” and “Attached GIF” in composer, recipient preview, and received view when accompanying text is nonempty.
- [x] Add a visible 3px focus ring to the clipped media picker input and scroll the picker into view on keyboard focus so the fixed action tray does not cover it.
- [x] Add unit coverage for both media labels and browser coverage for computed contrast, keyboard picker focus, media accessibility names, responsive overflow, and the post-share-import interactive state.
- [x] Pass `npm test` (287/287), `npm run lint`, `npm run typecheck`, browser-script syntax, and staged diff checks.
- [x] Pass isolated Chrome accessibility smoke at 320×740 and 390×844, and the focused PWA share-target smoke on port 6004. Review screenshots under `/private/tmp/drop-a11y-evidence`; the server was stopped and port 6004 released.
- [x] Commit the code as `ca29555` on `fix/pilot-a11y-accessibility`; keep `main` and PR #7 unchanged.
- [ ] Verify with a screen reader and a physical device; hosted account-to-account sending and OS share-sheet installation are outside this local check.

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
- [ ] Verify hosted behavior, screen-reader output, physical-device behavior, and a physical camera scan. PR #7's isolated local QR browser check passed and the PR remains open as requested.

## Private unread state (2026-10-25)

- [x] Add private recipient read markers and authenticated, recipient-scoped mark/read RPCs for delivered drops.
- [x] Add unread card markers and desktop/mobile Inbox counts; clear only after full open and guard asynchronous state against account changes.
- [x] Pass `npm test` (280/280), `npm run lint`, no-incremental TypeScript, `npm run test:local-supabase` (9 groups), and the rollback-only SQL fixture.
- [x] Pass authenticated local Edge browser flow at 390×844 and 1440×900: read RPC, cleared markers, reload persistence, and cleanup of disposable records.
- [x] Pass isolated Webpack production build and `git diff --check`.
- [x] Push code commit `a416d81` to `origin/feat/recipient-unread-state`.
- [ ] Verify the same recipient in a second authenticated session; verify hosted behavior, screen-reader output, and physical-device behavior.

## Current branch state

- [x] Keep PR #7 open as requested after its isolated local QR browser check passed at 390×844; a physical camera scan and hosted claim remain open. Unread-state work remains on its own pushed branch without a PR.
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

## Social Relay identity and feasibility pilot (2026-10-26)

- [x] Keep direct delivery available and explain Relay as one accepted handoff at a time, with recipient collection ending the route.
- [x] Label carrier names as self-entered and unverified; disclose that the one-time invite is not bound to an account and its first receiver can accept.
- [x] Document product identity, occasion-based use, platform API limits, opt-in pilot scope, and measures in `docs/social-relay-pilot.md`.
- [x] Extend the Relay browser smoke to exercise two text carriers, one-time replay denial, sender route refresh, recipient collection, and generic share-sheet copy.
- [x] Pass `npm test` (301/301), `npm run typecheck`, focused ESLint, browser script syntax, and `git diff --check`.
- [x] Pass the full isolated text/GIF Relay browser journey before the final bearer-link disclosure copy was added.
- [ ] Rerun the final browser journey with the bearer-link disclosure assertions. Port 6004 is occupied by an active `next-server` in `/private/tmp/drop-local-demo-cleanup`; it was left untouched.
- [ ] Run the opt-in human value/usability pilot and verify native OS sharing, screen-reader output, and physical-device behavior.
- [x] Commit code as `b9fb0f5` on `codex/social-relay-pilot`, based on `feat/pilot-integrated-preview`; push the feature branch. No merge to `main`.
- [x] Open draft [PR #12](https://github.com/arjeetanand/drop/pull/12) into `feat/pilot-integrated-preview`; leave it unmerged.
- [ ] Review PR CI status when GitHub's API or Code Review connection is available; both checks failed to connect after PR creation.
