# Drop integration checklist

Updated: 2026-10-26

## Text-note no-account demo (2026-10-26)

- [x] Add a local-only text-note example beside the existing photo and GIF demos; keep media attachment writes exclusive to media samples.
- [x] Preserve existing drafts and attachments, keep reactions local, and hide generated demo IDs from the sample detail view.
- [x] Pass `npm test` (327/327), lint, typecheck, browser-script syntax, and `git diff --check`.
- [x] Pass the isolated Edge text-demo flow at 360×844, 390×844, 430×844, 768×1024, and 1440×900; verify reaction reload, sender copy, draft preservation, zero write requests, and zero cross-origin requests.
- [x] Commit code as `5bb3ddf` and push `feat/demo-text-note`; keep `main`, the canonical app at 4004, and `/letter` unchanged.
- [x] Pass the isolated production build for the current task source with 22 routes; retain the existing Browserslist and easing-class warnings in the handoff.
- [ ] Configure hosted Supabase Google OAuth and verify real account-to-account sending; current local credentials point to loopback and hosted sign-in has not been checked.

## Compact demo media previews (2026-10-26)

- [x] Use separate display-only WebP previews on Home and the chooser; fetch the original PNG/GIF only after selecting its sample.
- [x] Generate an 840×630 photo preview (46,286 B) and a static 280×280 GIF poster (20,854 B) with the existing `sharp` dependency; preserve the original PNG and 24-frame GIF payload files.
- [x] Pass `npm test` (328/328), lint, typecheck, browser-script syntax, `git diff --check`, and isolated Webpack production build (22 routes).
- [x] Pass the isolated 390×844 browser flow: 67,704 B transferred for both chooser previews, no original-media request before selection, correct `image/png` and `image/gif` source responses after selection, and both opened in the recipient view.
- [x] Re-run the text-note smoke at 360×844, 390×844, 430×844, 768×1024, and 1440×900.
- [x] Commit code as `7740912` and push `perf/demo-preview-assets`; no PR or merge was created.
- [ ] Configure and verify hosted Google sign-in and two-account delivery. Firebase was assessed but not added because direct Firebase auth would require extra Supabase configuration and a broad identity/schema migration.

## Opt-in new-drop alert pilot (2026-10-26)

- [x] Add private per-device subscriptions and idempotent delivery events for Instant, Relay collection, and successful claim; exclude drafts, duplicate delivered updates, and self-sends.
- [x] Add authenticated, CORS-enabled subscription management and the server-only bounded Web Push dispatcher; remove stale provider endpoints and keep notification data generic.
- [x] Add the signed-in Profile opt-in/out control and same-origin Inbox notification click behavior. Permission is requested only after the user taps the control.
- [x] Pass `npm test` (325/325), lint, typecheck, `supabase db lint --local`, the rollback-only SQL transition fixture, and `git diff --check`.
- [x] Pass `npm run test:browser-drop-push` at 390×844 against the real local manager Edge Function, including CORS preflight, auth, opt-in, account transfer/isolation, disable, generic notification handling, and exact fixture cleanup. The synthetic push endpoint was registered but never dispatched.
- [x] Commit the code on `feat/drop-arrival-alerts` as `08e794a`; keep `main` and port `4004` unchanged.
- [x] Push the feature branch to `origin/feat/drop-arrival-alerts`; the initial DNS lookup failed, then the push succeeded and the remote tip was verified. No PR or merge was created.
- [ ] Create the hosted Free project, deploy migration/functions, configure VAPID/internal secrets and dispatcher wake schedule, then prove real provider delivery and OS notification behavior.
- [ ] Run recipient interviews, screen-reader checks, and physical-device acceptance before widening the pilot.

## Home PWA install/share onboarding (2026-10-26)

- [x] Add a Home card that explains install-dependent share-to-Drop, offers the browser's install prompt when available, shows a manual menu guide otherwise, and always keeps **Attach in Compose** available.
- [x] Exercise the manifest and service worker, manual guide, deferred install prompt, installed state, Compose fallback, and 390px viewport in the isolated production-browser smoke.
- [x] Pass `npm test` (301/301), `npm run lint`, `npm run typecheck`, runner syntax, `git diff --check`, and `npm run test:browser-pwa-share-onboarding`; the focused run cleaned its isolated app and did not use Supabase or touch port `4004`.
- [x] Commit and push code `4242fa0` to `origin/feat/pwa-share-onboarding`; verify remote pilot at `9b3ee7c`, prior task branch at `6a47d27`, and `main` at `5138f88`. No PR or merge was made.
- [ ] Verify actual PWA installation and OS share-sheet discovery on a supported device; complete hosted, screen-reader, and physical-device acceptance.

## Known-recipient Instant photo/GIF browser journey (2026-10-26)

- [x] Add `npm run test:browser-instant-media` for sender Compose → Instant delivery → recipient Inbox/open/reaction with a PNG and GIF.
- [x] Verify exact delivered-row and final-object metadata/signature, staged-object removal, no media-byte fetch before explicit Open, outsider download/signed-URL denial, sender reaction feedback after reload, and 390×844 overflow.
- [x] Verify exact disposable Auth/profile/drop/reaction/Storage cleanup; the run used loopback Supabase and port `6004`, with no database reset, hosted request, or `4004` interruption.
- [x] Pass isolated production build/browser run, `npm test` (301/301), `npm run lint`, `npm run typecheck`, script syntax/guard/focused ESLint, and `git diff --check`.
- [x] Commit and push code `f83053c` to `origin/test/media-claim-compose-e2e`; confirm pilot branch `9b3ee7c` and `main` `5138f88` stayed unchanged. Draft PR #11 remains on the pilot branch; this task branch has no PR.
- [x] Exercise media upload retry through the rendered browser: injected PNG/GIF finalize failures retained the same draft/upload IDs, required recipient recheck, removed staged objects, and produced one final row/object per retry; a lost committed response did not resubmit (`npm run test:browser-instant-media`, 390×844, `71b1f5b`).
- [ ] Finish hosted delivery/retention, screen-reader, installed-PWA, and physical-device/camera checks.

## Private photo/GIF claim browser journey (2026-10-26)

- [x] Add `npm run test:browser-media-claim` to create photo and GIF claims from the sender’s actual Compose UI at 390×844, then complete first-use recipient setup, explicit claim/reveal, and outsider replay denial.
- [x] Verify exact staged/final Storage paths, final media MIME/size/signature, pending privacy, sender claimed status after reload, and exact disposable account/drop/profile/object cleanup.
- [x] Make cleanup capture safe upload paths before strict UUID/prefix assertions and recursively enumerate the unique disposable sender's Storage prefix; refuse unsafe paths and other account IDs.
- [x] Keep the isolated production build offline with local-only Google Font fixtures; pass production build and the full sender→recipient→outsider browser journey with no overflow, browser errors, cross-origin requests, or cleanup failure.
- [x] Pass runner syntax, guard self-test, focused ESLint, and `git diff --check`.
- [x] Commit and push code `7b24d99` to `origin/test/media-claim-compose-e2e`; verify the existing pilot branch stayed at `9b3ee7c` and `origin/main` stayed at `5138f88`. This is a separate branch; no PR was opened or merged.
- [ ] Complete hosted two-account media claims, native installed-PWA sharing, screen-reader output, and physical-device/camera acceptance after the approved hosted project is available.

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
