# Drop handoff

Updated: 2026-10-26

## Latest checkpoint — Compose starters and GIF Relay pilot verification (2026-10-26)

- Added optional note/caption starters for text, photo, and GIF Compose; selection fills an editable field, preserves existing text and attachments, and never sends automatically. Wrapped unbroken subject, fragment, and message text on the opened-drop screen to prevent narrow-screen overflow.
- Extended `npm run test:browser-relay` to exercise sender-created GIF Relay end to end, including exact final/staged Storage checks, private media before collection, post-collection render, confirmed not-found cleanup, and starter selection/focus/attachment preservation. Optional 390×844 screenshots are in `/private/tmp/drop-pilot-final-evidence.Lyw5xo/`.
- Verification passed: `npm test` (301/301), TypeScript, focused ESLint, smoke syntax and loopback guard, `git diff --check`, and the isolated production browser journey. The text and GIF Relay runs had no overflow, browser errors, failed requests, or cross-origin browser traffic. The 4004 app remained available; test data, Storage objects, and browser profiles were cleaned.
- Code commit `bce0f37` and separate documentation commit `6a20dc4` are pushed to `origin/feat/pilot-integrated-preview`. GitHub confirms PR #11 remains open/draft on this branch with base `main`; its CI checks were not queried. Remote `main` remains `5138f88`; no merge occurred.
- Hosted Supabase is still blocked: `.env.local` and the process environment have no `SUPABASE_ACCESS_TOKEN`, the Supabase ChatGPT connector is disabled by workspace admin, and the earlier pasted credential was not reused. No hosted project, billing, or hosted data changed. Hosted delivery/retention, actual screen-reader output, installed-PWA sharing, and physical device/camera checks remain open.

**Next:** add a fresh scoped Supabase Management API token to the canonical checkout's local `.env.local` (do not paste it into chat) to provision the approved Free project, then complete hosted acceptance. Refresh PR #11 state/checks before any merge; keep `main` unchanged until the remaining gates pass and the user approves merging.

## Latest checkpoint — secure Relay browser journey (2026-10-26)

- `npm run test:browser-relay` now starts with a signed-in sender creating the text Relay drop through Compose, confirms the selected Relay mode and recipient, and reads back the exact dispatched row. The rest of the flow accepts the UUIDv4 fragment invite as a carrier, confirms location is never called, verifies subject/body privacy, rejects a fresh replay, refreshes the sender Journey, then collects and reveals the drop as the recipient.
- The final local browser run passed at `390×844`: no horizontal overflow, console/runtime errors, or cross-origin browser requests. The runner verified exact cleanup of its UI-created drop, three Auth users/profiles, browser profiles, temporary app, and process groups. Its isolated production build passed. `npm test` passed 298/298; lint, TypeScript, runner syntax/guard/ESLint, and `git diff --check` passed. No hosted request or database reset occurred.
- Focused review found the Relay button includes helper text and the handle-check label changes with recipient state. The smoke now checks the Relay title as rendered text and waits on the enabled recipient check state; the final rerun passed.
- Code commit `f92a78c` is pushed to `origin/feat/pilot-integrated-preview`; PR #11 was last verified open/draft at `5f9562a`. GitHub API DNS failed after the push, so the current PR state/checks were not refreshed. Remote `main` was last verified at `5138f88`; no merge was made. The existing app on `4004` was left running, and test port `6004` was released.
- The task environment still has no usable Supabase Management API token, so no hosted Free project or billing/resource change was made. Hosted delivery/retention, screen-reader output, installed-PWA sharing, and physical-device/camera checks remain open.

**Next:** continue the local pilot while hosted Management API access is unavailable, then complete hosted and device acceptance when that access exists. Refresh PR #11's current state/checks before any merge; keep it unmerged until remaining gates pass and the user approves merging.

## Latest checkpoint — local Supabase fixture-target guard (2026-10-26)

- Added a fail-closed listener/Docker/container provenance check to the six fixture-writing Supabase smokes. A review found that broad Rancher/Lima/socket substring matching could accept a lookalike remote SSH tunnel; the guard now accepts only the exact Rancher Desktop Lima mux socket title and requires a local Docker endpoint plus the matching Supabase container.
- Verification: `npm test` passed 298/298; lint, no-incremental TypeScript, script syntax, and `git diff --check` passed. `npm run test:browser-qr` passed at 390×844 with exact drop/profile/Auth/process/temp cleanup. `npm run test:local-supabase` passed the local text/image/GIF claim, send/read/reaction, relay collection, and cleanup checks for five disposable accounts and temporary media. No database reset was run. No application source changed, so no production build was run.
- Code commit `f8c709d` is pushed to `origin/feat/pilot-integrated-preview`. GitHub verified PR #11 open/draft at that code head; remote `main` remains `5138f88`; no merge occurred. Port 4004 was not restarted or stopped.
- The task has no Supabase Management API token. The CLI reports `SUPABASE_ACCESS_TOKEN` missing; `.env.local` app keys are not project-management credentials. No hosted project, billing, or hosted data changed.
- QR pixel decoding, hosted delivery/retention, screen-reader output, installed-PWA OS sharing, physical camera scanning, and physical-device behavior remain open.

**Next:** add a scoped Management API token locally, verify the Free project, and finish hosted/device acceptance. Keep PR #11 open until the remaining gates pass and the user approves merging.

## Latest checkpoint — repeatable QR browser smoke pushed (2026-10-26)

- Pushed code commits `9e764e8` (repeatable QR smoke) and `2a9cf49` (loopback-only Supabase requests with redirects denied) to `origin/feat/pilot-integrated-preview`. GitHub confirmed draft PR #11 open at `2a9cf49`; remote `main` remains `5138f88`. No merge occurred.
- `npm run test:browser-qr` passed on local Supabase at 390×844. It verified pending private text-drop state, anonymous read denial, accessible focused QR/link, stable hide/show, and new-draft reset. Cleanup verified the exact drop/profile/Auth user were removed, app/browser process groups exited, and the temporary directory was deleted. Port 6004 was released; port 4004 remains owned by the canonical app.
- `npm test` passed 288/288; `npm run lint`, `npm run typecheck`, `node --check`, and `git diff --check` passed. No application source changed, so the Webpack build was not rerun in this slice. QR decoding was unavailable (`BarcodeDetector` absent); the earlier manual pixel-decode result is separate evidence.
- The QR browser initially stalled because setting its `HOME` to a temporary folder prevented macOS loopback navigation. Keeping the regular process `HOME` while using a disposable `--user-data-dir` restored the flow. Every Node-side Supabase request now enforces the exact configured loopback origin and rejects redirects; the service-role key is not passed to child processes.
- This run did not contact hosted Supabase. Hosted account-to-account delivery and physical retention remain open, along with spoken screen-reader, installed-PWA OS sharing, and physical camera/device checks.

**Next:** provision the approved Free hosted project when a Management API token is available to the task, then run hosted two-account and scheduled-retention checks. Keep PR #11 unmerged until remaining gates pass and the user approves merging.

## Previous checkpoint — tested pilot branch pushed before repeatable QR automation (2026-10-26)

- Pushed the tested canonical candidate to `origin/feat/pilot-integrated-preview` through code checkpoint `9781ed6`. GitHub confirmed draft PR #11 open at that head, PR #7 open and unchanged at `dec1608`, and `main` at `5138f88`.
- PR #11 currently reports GitGuardian Security Checks as passing. No additional CI checks were reported. Local validation passed 288/288 unit tests, lint, no-incremental TypeScript, diff check, and Webpack build with 22 routes.
- `http://localhost:4004` is running from `/Users/arjeetanand/projects/drop`; local Auth and Mailpit each return HTTP 200. The local Supabase Docker stack is running with no database reset.
- No PR was merged. QR browser automation, hosted Free project setup/two-account delivery/scheduled deletion, physical camera/device behavior, installed-PWA OS sharing, and spoken screen-reader checks remain open.
- The verified feature push is `9781ed6`; follow-up docs can advance the branch, so check the current PR head before any merge decision.

**Next:** provision and configure the approved Free hosted project when access is available, then run the real two-account and scheduled-retention checks. Keep PR #11 unmerged until the hosted and device gates pass and the user approves merging.

## Latest checkpoint — canonical pilot candidate running locally (2026-10-26)

- Fast-forwarded the verified local branch into canonical `feat/pilot-integrated-preview` at `d9d9823`. Its four commits ahead of the cached `origin` ref are `2eb4071` (expired claim handoff sweep), `98cb6aa`/`f8cbde3` (QR issue and stale-state reset), and this pilot evidence/docs update.
- Canonical verification: 288/288 unit tests, lint, `npx tsc --noEmit --incremental false`, and diff checks passed. The equivalent tested source tree built successfully with Webpack into 22 routes after the existing Google Fonts fetch was allowed. The standard typecheck command was rerun without incremental output because the restricted canonical checkout denied writing `tsconfig.tsbuildinfo`.
- The canonical `./run.sh start` process owns port 4004 and serves `http://localhost:4004` with HTTP 200; local Auth at 54321 and Mailpit at 54324 also return HTTP 200. The project Docker stack is running. No database reset was run.
- The authenticated QR browser proof and 31-day local staged-media worker proof are recorded in `docs/pilot-qr-verification.md` and `docs/pilot-retention-verification.md`. A committed repeatable QR browser smoke is still pending.
- The update has not been pushed. GitHub could not be refreshed; PR #11 was last observed open/draft at `f0c015a`, and PR #7 was not changed. No merge to `main`, hosted Supabase access, or `.env.local` read occurred.
- Hosted Free project setup and two-account verification, hosted cleanup scheduling/deletion, physical QR/camera/device behavior, installed-PWA system sharing, and spoken screen-reader output remain open.

**Next:** push the tested branch update to the existing draft PR when GitHub is reachable, then complete hosted and device acceptance before asking for any merge.

## Latest checkpoint — QR pilot and cleanup verification (2026-10-26)

- Combined three reviewed code commits on `pilot/combined-verification` from candidate base `f0c015a`: `2eb4071` prunes expired claim handoffs at app startup and on `pageshow`/focus; `98cb6aa` adds QR display for private claim links; `f8cbde3` clears stale QR state when the active draft or account changes.
- Combined verification passed: `npm test` 288/288, lint, typecheck, `git diff --check`, and `npm run build -- --webpack` with 22 routes. The build passed after allowing the existing Google Fonts requests; non-blocking Browserslist and Tailwind ambiguity warnings remain.
- Authenticated local Chrome QR journey passed at 390×844 on `pilot/qr-integration`. It verified issue/render, focus, hide/show using the same link, token only in the URL fragment, decoded screenshot matching the displayed invite, one pending claim row with no recipient yet, anonymous RLS denial, no browser errors/cross-origin calls, and exact cleanup of the test drop/user/profile. Details are in `docs/pilot-qr-verification.md`.
- Local retention worker removed one exact 31-day staged-media fixture through the Storage API while a recent fixture stayed available. The test began and ended with zero fixture objects/tombstones and the initial null cursor restored; details are in `docs/pilot-retention-verification.md`.
- The combined branch is still an isolated local verification branch and has not been transferred or pushed. The canonical checkout remains at `f0c015a`; GitHub could not be queried during this run, so PR #11 and PR #7 remote status is unrefreshed. No `main` merge, hosted Supabase access, or `.env.local` read occurred.
- Main remaining pilot gates: hosted project migrations/secrets/scheduler and two-account delivery; hosted physical deletion; physical QR scan/device behavior; installed-PWA OS share; and spoken screen-reader verification.

**Next:** transfer the reviewed commits and evidence docs into canonical `feat/pilot-integrated-preview`, rerun final checks there, then push the authorized update to the existing draft PR if GitHub is reachable. Keep the PR unmerged while the hosted/device acceptance gates are open.

## Latest checkpoint — integrated pilot candidate published for review (2026-10-25)

- The current candidate is `feat/pilot-integrated-preview`, tracked by [draft PR #11](https://github.com/arjeetanand/drop/pull/11). It is not merged. PR #7 remains open and unchanged; `git log -1 --oneline --decorate` shows the exact current branch tip.
- Candidate app code commit `723d45f` integrates the standalone signup test `d49aaf3`; full first-use claim coverage and its documentation are integrated in the pushed checkpoint `7dad439`. Scope includes mobile composer actions/accessibility, send/read/reaction, private photo/GIF claims, PWA share-target recovery, and first-time email signup/profile setup.
- Verification on the candidate: 287/287 unit tests, lint, TypeScript, smoke-script syntax, diff check, and Webpack production build (22 routes) passed. Local authenticated text, private-media, and PWA browser flows passed on the candidate application code; the public signup browser flow passed on its source branch and is integrated. Default Turbopack rerun was blocked by font-fetch and worker-port environment restrictions; Webpack build passed.
- The combined new-recipient signup-to-private-claim test now passes locally: fresh claim, signed-out invite page, email request, Mailpit magic-link callback, handle setup, profile sync, return to the same claim, explicit claim and reveal/open, plus outsider and replay denial. Exact cleanup removed the claim, three disposable Auth users/profiles, and Mailpit message. The harness was corrected to follow the app's claim-page-to-profile step and normalize CSS-uppercase button labels; app source did not need a change.
- The canonical `/Users/arjeetanand/projects/drop` checkout is now on `feat/pilot-integrated-preview`. `./run.sh start` serves the pilot at `http://localhost:4004`; the loopback request returned HTTP 200. The previous branch and detached preview worktree were preserved.
- Hosted email/delivery, storage policy and 30-day cleanup remain unverified because there is no hosted Drop project. Physical camera/phone behavior, installed-PWA system sharing, and spoken screen-reader output remain open. PR #7's local QR browser check passed, but its feature is not in this candidate.

**Next:** complete hosted Supabase delivery/retention and physical-device, OS-share, screen-reader, and QR-camera checks when their environments are available; keep PR #11 draft and unmerged until the remaining gates and your merge approval.

## Latest checkpoint — pilot accessibility follow-up (2026-10-25)

- Improved the Home send-account helper to meet 4.5:1 contrast, retained accessible names for attached photo/GIF media across the composer, recipient preview, and received view when text is present, and added a visible keyboard focus ring for the clipped picker input. Keyboard focus scrolls the picker above the fixed action tray.
- Added unit regression coverage for both media labels and real-browser checks for computed contrast, keyboard focus visibility, AX-tree media names in all three views, responsive overflow, and interactivity after PWA share import reaches its canonical route. The route was interactive in the check, so no share-import app change was needed.
- Verification passed: `npm test` (287/287), `npm run lint`, `npm run typecheck`, browser-smoke syntax, and staged diff checks. Isolated Chrome checks passed at 320×740 and 390×844: computed contrast was 4.62:1; keyboard focus showed a visible 3px mint outline on the photo and GIF picker without overlap; both media kinds had the expected accessible names with nonempty text in composer, preview, and received samples. The focused share-target check also passed its canonical-route interactivity assertion. No cross-origin requests or horizontal overflow were observed.
- Code commit `ca29555` is on `fix/pilot-a11y-accessibility`, branched from `feat/pilot-integrated-preview` (`da358a5`). The branch is isolated in `/private/tmp/drop-a11y`; port 6004 was released after testing. Browser screenshots are in `/private/tmp/drop-a11y-evidence`.
- These local checks do not verify actual screen-reader announcements, physical-device behavior, hosted sending, or operating-system share-sheet installation. No hosted Supabase resource was used, `.env.local` was not read, `/letter` was not changed, and `main` and PR #7 were left unchanged.

**Next:** review and merge the accessibility branch through the normal PR flow after screen-reader and device acceptance are scheduled; keep hosted delivery and OS share-sheet acceptance separate from these local results.

## Latest checkpoint — PWA share-target account-switch recovery (2026-10-25)

- The pilot candidate already had the installable manifest, service-worker share target, and bounded multipart import handler. This branch adds the relevant follow-up from `feat/pwa-share-acceptance`: imports capture their account/draft context, rollback is scoped to that captured owner, and failed persistence keeps the staged handoff available for retry. The smoke now checks the canonical `letter` route and expected content even if navigation completes before it observes the intermediate handoff URL.
- Verification: focused unit tests passed 46/46; full `npm test` passed 286/286; lint, no-incremental TypeScript, browser-smoke syntax and ESLint, and `git diff --check` passed. The isolated production share-target smoke passed synthetic PNG import, caption/recipient state, retry after injected persistence failures, prior draft/media preservation, same-ID replay, and widths 375×844, 390×844, 844×390, and 1440×900. The production build passed using a temporary test-only local-font fixture; the unmocked build could not resolve Google Fonts DNS. No fixture or `node_modules` symlink is committed.
- Code commit `ff9c2ff` and PWA documentation commit `43ea3d6` are pushed to `origin/feat/pilot-pwa-share`; the pilot candidate ref `fix/pilot-send-account-disclosure` was fast-forwarded through the same history. Both refs identify the same current candidate tip. No main merge, new PR, or PR #7 change was made.
- The local browser run used port 6004 and was stopped after verification. It does not verify installation or the operating-system share sheet. Hosted account-to-account behavior, screen-reader output, and physical-device checks remain open. `/letter` and `.env.local` were not changed.

**Next:** verify Drop installation and inbound sharing from a supported OS share sheet on a physical device, then finish screen-reader and hosted account checks.

## Latest checkpoint — production browser smoke stability and pilot candidate (2026-10-25)

- Stabilized the full browser smoke after headless Chrome stalled on `page-enter` animation state during viewport changes. The runner now waits for route content and the page shell, settles for 420ms (the CSS animation is 380ms), and includes animation details in timeout snapshots. Reveal, open, and sender-copy actions after reload use keyboard input; the initial 360px flow still exercises touch.
- Verification: `npm test` passed 281/281; `npm run lint`, no-incremental TypeScript, browser-smoke syntax, targeted ESLint, and `git diff --check` passed. The production build passed with 22 routes. The isolated production browser smoke passed the GIF path at 360×844, 390×844, 430×844, and 1440×900; the photo/reaction/reload path at 390×844; the prompt-to-draft path with existing attachment preservation; and handleless claim choice plus saved-claim recovery at all four widths. It reported zero cross-origin requests and no horizontal overflow. Screenshots were visually reviewed at mobile and desktop sizes.
- Code commit `36f557d` is pushed to `fix/pilot-send-account-disclosure`; this handoff, checklist, plan, README, and learning update are committed separately on the same branch. The candidate builds on the locally verified account-to-account send, unread-sync, and reaction work from `feat/recipient-unread-e2e`. Nothing was merged; PR #7 remains open for its QR check.
- Drop remains on `http://localhost:4004`; the isolated production test server on 6004 is stopped after verification. This demo/recovery smoke does not establish hosted account-to-account behavior. Hosted verification, screen-reader output, physical-device behavior, system share-sheet behavior, and PR #7's QR browser check remain open.

**Next:** complete the authorized Free-project hosted send checks when the project credentials and local endpoint are available, then finish screen-reader and physical-device acceptance. Keep PR #7 open until its QR browser check passes.

## Latest checkpoint — Home send-account clarity (2026-10-25)

- Home now says the demo stays on this device and a Drop account is needed to send. The browser smoke asserts this copy before starting the Home prompt flow and before the demo flow.
- Verification: `npm test` passed 281/281; lint, no-incremental TypeScript, browser-script syntax, and `git diff --check` passed. The focused Chrome prompt flow passed keyboard entry and draft/attachment preservation at 360×844, 390×844, 430×844, and 1440×900; the browser gate recorded zero cross-origin requests. The full GIF smoke passed at 360×844 and 390×844, then timed out waiting for the Home entrance animation at the next viewport even though Home rendered with the new copy.
- Code commit `64f29b5` is on `fix/pilot-send-account-disclosure`; documentation is in a separate commit on that branch. The isolated Next dev server used port 5004 and is stopped after testing. The canonical app remains on port 4004.
- Hosted send, screen-reader output, physical-device behavior, and PR #7’s separate QR browser check remain open. No hosted Supabase resource changed; `/letter` and `.env.local` were not changed.

**Next:** resolve or isolate the flaky page-animation wait in the full browser smoke, then continue hosted and device acceptance when the approved Free project and physical-device access are available.

## Latest checkpoint — local same-recipient unread sync and Docker runtime (2026-10-25)

- Extended the authenticated smoke to three isolated browser profiles: sender plus two sessions for the same recipient. It builds an isolated production app with `next build --webpack`, runs `next start` on port 6004, and verifies that the second recipient session clears “New” after the server read-state refresh while its Home document stays open.
- The same flow sends from Compose, checks both recipient sessions at 390×844 and 1440×900, opens from Inbox, records the exact successful read marker, reacts with 🫶, verifies sender live and persisted reaction, checks browser errors and origins, and removes the exact disposable rows, accounts, profiles, app, and browser profiles.
- Verification: `npm test` passed 281/281; browser-smoke syntax, ESLint for the changed harness, and `git diff --check` passed. The full production browser run passed, including exact RPC response correlation and no-reload sync. The local Docker daemon reports server 29.5.2; the Supabase stack is up, and the app, Auth, and Mailpit return HTTP 200.
- Code commit `0e672f3` is pushed to `origin/feat/recipient-unread-e2e`; this handoff/checklist/plan/README/learning update is a separate commit on the same branch. No PR is open for this branch. PR #7 remains open for its separate QR browser check.
- Drop is running at `http://localhost:4004`. The Docker socket permissions and global Docker settings were not changed. No hosted Supabase resource was used or changed, `.env.local` was not committed, and `/letter` was not changed.

**Next:** verify hosted migration/API behavior, screen-reader output, and physical-device behavior when the hosted project is available. Complete PR #7's separate QR browser check before merging that PR.

## Latest checkpoint — private, durable unread state (2026-10-25)

- Added private server-side read markers for actual delivered recipient drops, recipient-scoped RPCs, unread card/navigation indicators on desktop and mobile, and account-safe handling of asynchronous read events. Read markers are not exposed to senders.
- Verification: `npm test` passed 280/280; lint, no-incremental TypeScript, `git diff --check`, and the isolated Webpack production build passed. `npm run test:local-supabase` passed all 9 groups, and the rollback-only SQL fixture passed against a disposable local database. Authenticated Edge browser verification passed at 390×844 and 1440×900: sign-in, open, successful read RPC, cleared markers, and persisted state after reload. Cleanup left no disposable users or drops, no port 5004 listener, and no temporary browser profile or owned app process.
- Code commit `a416d81` and documentation commit `e53c0d0` are pushed to `origin/feat/recipient-unread-state`. This branch has not been opened as a PR or merged. PR #7 remains open for the private-claim QR browser check.
- No hosted Supabase resource or credential changed. After the isolated browser smoke cleaned up, the project app returned HTTP 200 on port 4004 and remains available at `http://localhost:4004`.

**Next:** verify read synchronization in a second authenticated session for the same recipient, then complete hosted migration/API, screen-reader, and physical-device checks when available. The app uses `./run.sh start` and the stable URL `http://localhost:4004`.

## Latest checkpoint — PR #5 merged into main (2026-10-24)

- PR #5, **fix: preserve unfinished drafts when replying**, merged into `main` at `e098388` (`Merge pull request #5 from arjeetanand/fix/drop-back-fresh-draft`). The reviewed PR head was `37afbda`, including code commit `a71612b` and the Docker runtime recovery record.
- Verification before merge: GitGuardian passed; the independent code review found no actionable issues; `npm test` passed 274/274; lint and no-incremental TypeScript passed; local Docker-backed Supabase smoke passed all eight groups; Drop, Auth, and Mailpit returned HTTP 200.
- The remote PR source branch and Docker recovery task branch remain available. Automatic review declined the extra source-branch deletion request, so no branch deletion was performed.
- The merged change contains no hosted Supabase resource changes. Hosted two-account behavior, actual 30-day media deletion, screen-reader behavior, and physical-device checks remain open.

**Next:** continue the remaining hosted, aged-object cleanup, accessibility, and device checks; use `main` as the current branch and `e098388` as the latest code-bearing merge.

## Latest checkpoint — Restore the local Docker-backed runtime (2026-10-24)

- The app initially refused connections on port 4004 because its Next.js process was stopped. The Docker client and Rancher Desktop daemon were already installed/running; the default sandboxed command could not access the Docker socket, while the approved local runtime context could. No Docker permissions or global settings were changed.
- Started Drop with `./run.sh start` on its documented port. The app, Supabase Auth, and Mailpit returned HTTP 200. The existing local Supabase Docker services remained in place.
- `npm run test:local-supabase` passed all eight groups with five disposable local accounts; the script's cleanup completed. The cleanup worker was not invoked, and no hosted Supabase resources or unrelated containers were changed.
- No application code changed. The Next.js app runs directly through Node; the local Supabase backend runs in Docker through the Supabase CLI. This checkpoint is on `chore/docker-runtime-recovery`; see the branch's latest Git commit and the final task report for its exact SHA and push state.

**Next:** use `http://localhost:4004`; continue the open product, hosted-project, aged-object deletion, screen-reader, and device checks when their required access is available.

## Latest checkpoint — Docker-backed local account-to-account verification (2026-10-24)

- The local Docker/Supabase stack is healthy. The initial Docker socket denial came from the workspace sandbox blocking Rancher Desktop access; read-only elevated status confirmed the daemon and local services. No socket permissions or global Docker settings were changed.
- The local stack has the project migrations applied, `pg_cron`/`pg_net`, local Vault configuration, the hourly media-cleanup schedule, and the local cleanup Edge Function runtime. Local API and Mailpit are on `127.0.0.1:54321` and `127.0.0.1:54324`. `.env.local` remains ignored and mode `600`; no keys were printed or committed.
- `npm run test:local-supabase` passed with five disposable accounts and cleaned them up. An isolated Chrome run at 390×844 then used the actual profile email sign-in and local Mailpit link in one browser context; a second account claimed and opened sent text, photo, and GIF drops, and both media attachments rendered. The browser stayed on local origins with no console errors.
- Browser-test cleanup verified zero matching accounts and sender-prefix Storage objects remain; it removed two test Storage objects, two captured sign-in emails, and the isolated Chrome profiles. The corrected browser harness is temporary under `/private/tmp`; no application source changed.
- The cleanup worker was not invoked, so actual 30-day Storage deletion remains unverified. A worker POST was previously stopped by the automatic approval review because the endpoint can delete aged media. Hosted Supabase, `/letter`, and unrelated Docker data were not changed.
- Current code candidate remains `fix/drop-back-fresh-draft` at `a71612b`, pushed and tracked by [PR #5](https://github.com/arjeetanand/drop/pull/5); PR #5 is open and unmerged. This checkpoint records local verification only.

**Next:** verify actual deletion with an exact disposable aged-object fixture if the deletion action clears review; run the pending SQL fixture; finish hosted, screen-reader, and physical-device checks separately.

## Latest checkpoint — Drop back draft isolation (2026-10-24)

- Fixed the received-drop **Drop back** action so it creates a separate persisted text draft addressed to the sender. The old `/compose?new=1` route could intentionally reuse any empty-text draft, including one with a photo/GIF. The new action normalizes the sender handle, requires the old draft to be preserved and the new draft to be verifiably stored, and navigates by the new draft ID. If storage fails, it stays on the received drop and reports that the existing draft is unchanged.
- Added unit and focused browser regressions. The unit case keeps the old draft fields and attachment bytes under its original ID. Isolated Chrome at 390×844 verified the control by keyboard, the new route and prefilled handle, the preserved photo data, the explicit account gate, no send, no horizontal overflow, and no cross-origin requests.
- Verification: `npm test` passed 274/274; `npm run lint`, `./node_modules/.bin/tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, `git diff --check`, and `npm run build -- --webpack` passed. The build reported the existing outdated Browserslist data and ambiguous Tailwind easing-class warnings. Local Home returned HTTP 200 on port 4004.
- Code commit `a71612b` (`fix: start fresh draft from received drop`) is pushed to `origin/fix/drop-back-fresh-draft` and tracked by [PR #5](https://github.com/arjeetanand/drop/pull/5), which is open and unmerged. The browser fixture is local; hosted two-account delivery, screen-reader output, and physical-device behavior remain unverified. No hosted Supabase resources, credentials, or `/letter` files were changed.

**Next:** review this branch and open its PR when ready; then complete screen-reader and physical-device checks and verify a real received-drop reply with disposable accounts.

## Latest checkpoint — Docker-backed local Supabase smoke repair (2026-10-24)

- Corrected `scripts/local-supabase-smoke.mjs`: an invalid bearer token is denied before claim, while the existing check still rejects a second account replaying the valid token after the first claim. The raw recent-recipient query now expects both the direct recipient and the profiled claimant from the sender’s claimed text/media invites. No claim RPC behavior changed.
- The Docker-backed local Supabase stack is running. `pg_cron` and `pg_net` are enabled; the three local Vault entries are present; `drop-expired-drop-media-hourly` is active; and the local cleanup Edge Function is being served by the CLI process. `.env.local` remains ignored and mode `600`; no secret values were printed or committed.
- Verification: `npm run test:local-supabase` passed across five disposable accounts and its cleanup left zero `drop-smoke-*` accounts. `npm test` passed 272/272; lint, type-check, `node --check scripts/local-supabase-smoke.mjs`, `git diff --check`, and `npm run build -- --webpack` passed. The build only reported the existing Browserslist data and ambiguous Tailwind easing-class warnings. `http://localhost:4004/` returned HTTP 200.
- Code commit `8115a58` (`test: align claim smoke with bearer semantics`) is pushed on `fix/local-bearer-claim-smoke`; [PR #2](https://github.com/arjeetanand/drop/pull/2) tracks the change. Hosted Supabase provisioning was not attempted. The smoke and unit tests do not confirm an actual aged Storage object deletion; screen-reader and physical-device checks remain open.

**Next:** keep the local Edge Function server running while using the local Supabase stack; follow [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) to restart it. Verify actual object deletion only with a disposable aged-object fixture.

## Latest checkpoint — Main integration PR and Relay invite safety (2026-10-24)

- Current integration candidate: `/Users/arjeetanand/projects/drop`, branch `feat/demo-relay-preview`; GitHub PR [#1](https://github.com/arjeetanand/drop/pull/1) targets `main`. The PR opened at head `1c5870aa362ee3005c59420ca95c410f77b8ccb0` against `main` at `1887ac4c702952f26ebb4a196ae19fd6ac2cb620`; test-fixture cleanup later advanced the code head to `8ecb1a4edff12ce1843a9830d21b1884b6d55a63`. At that code head, `origin/main...HEAD` was `0 126`; this project-note commit adds one more commit. The live PR page records current review, checks, and merge state.
- Relay bearer tokens are read only from URL fragments. Query-only legacy invites are rejected and the token query is removed from visible browser history; ask the carrier for a fresh invite. A legacy query can still reach the server in the initial request before client-side cleanup.
- `run.sh` now changes to the project directory before invoking npm, including when started through an absolute path from elsewhere. Test UUID fixtures use deterministic UUIDv4 values in the current tree.
- Verification: `npm test` passed 272/272; `npm run lint`, `npx tsc --noEmit --incremental false`, `git diff --check`, `bash -n run.sh`, external-working-directory launcher smoke, and `npm run build -- --webpack` passed. Build generated 22 routes and emitted the existing outdated Browserslist data and ambiguous Tailwind easing-class warnings.
- GitGuardian Security Checks reports three `Generic High Entropy Secret` findings in test files in commits `fd5a327`, `b7483df`, and `fb7bd07`. Inspection traced them to UUID fixtures, not configured credentials. The current tree replaces those fixture values in `8ecb1a4`, but the scanner still examines earlier commits in the PR range. GitHub reports no required branch-protection checks for `main`; the PR page shows the live check result.
- The installed-PWA/system-share browser smoke remains unverified because Chrome did not publish `DevToolsActivePort`. Screen-reader and physical-device behavior, hosted Supabase two-account delivery, and actual Storage cleanup remain unverified. No hosted Drop project was created. `.env.local` was not staged or changed, and `/letter` was not changed.

**Follow-up:** complete the system share-sheet and physical-device checks, then validate two-account media delivery and 30-day Storage cleanup against the approved Free Supabase project when hosted access is available.

## Latest checkpoint — fictional Relay demo preview (2026-10-24)

- `/demo` now includes a no-account, fictional three-stop Relay preview. The drop stays covered until **Collect this drop**; the reveal uses a separate blue-hour illustration that is not rendered by the visible photo/GIF chooser. Route steps expose upcoming, current, and completed states to assistive technology.
- The preview changes component state only. It does not read location, send, persist, or use the backend. Independent product/accessibility review found no concrete issue.
- Verification: `npm test` passed 251/251; `npm run lint`, `npx tsc --noEmit --incremental false`, `git diff --check`, and `npm run build -- --webpack` passed. Isolated Chrome at 360×844, 390×844, and 430×844 verified keyboard and touch progression, focus retention, accessible route state, sample hidden before collection, no horizontal overflow, no page errors, and no external requests. The temporary CDP check and screenshot are in `/private/tmp/drop-relay-demo-browser-smoke.mjs` and `/private/tmp/drop-relay-demo-browser-smoke.png`.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `feat/demo-relay-preview`. Code commit `d218721` (`feat: add sealed Relay preview to demo`) is pushed to `origin/feat/demo-relay-preview`. No PR or merge was created. `/letter`, `.env.local`, and hosted Supabase were not changed in this slice.
- Supabase correction: the checkout has `node_modules/.bin/supabase`; the read-only project-list command stops with `AccessTokenRequiredError`. A browser login does not authenticate the CLI. No hosted Drop project, database, worker, or secret was created or changed in this slice. Actual screen-reader use, a physical device, hosted delivery, and Storage cleanup remain unverified.

**Next:** continue the mobile-first Drop plan with local verification while hosted Supabase access is being resolved; complete screen-reader and physical-device checks when available.

## Latest checkpoint — local cleanup migration and media claim recovery (2026-10-24)

- Removed the reconciliation index on Supabase-managed `storage.objects` after the local migration role rejected it. The cleanup keeps its age-ordered cursor pages; scan/sort cost at large bucket sizes is unmeasured.
- Applied migrations `20261023160000` and `20261023170000` to the existing local database. Both are recorded as applied, and there is no custom index on the managed Storage table.
- Sender detail reads now use the shared claim eligibility check for text, image, and GIF. Corrected stale cleanup fixture assertions for claimed-drop count and the account that claimed the media.
- Verification: `npm test` passed 249/249; lint, no-incremental TypeScript, and `git diff --check` passed. The rollback SQL fixture passed in a fresh disposable local database, which was dropped afterward. The hosted worker, two-account delivery, physical Storage deletion, and browser flow were not exercised in this slice.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `fix/storage-objects-index-role`. Code commits `8605dbf` and `2807ea4` are pushed. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed.
- The project has a local CLI dependency at `node_modules/.bin/supabase`, but the read-only project-list command returns `AccessTokenRequiredError`; a browser login does not authenticate the CLI. No hosted Free project, Vault value, schedule, or Edge Function was verified or changed. Screen-reader and physical-device checks remain open.

**Next:** verify the approved Free project through an accessible dashboard or scoped CLI session, then configure the cleanup worker and complete two-account media claims plus actual Storage deletion. Measure scan cost before scaling storage volume.

## Latest checkpoint — demo to first drop (2026-10-24)

- The local demo sender copy now offers **Make one for a friend** and opens a forced-new blank, editable text draft by its ID. The sample message, reaction, media, and demo identity stay in the local demo; the “nothing was sent or shared” notice remains visible. The prior draft and its local photo attachment remain recoverable, and the composer lands at the top.
- The action keeps the existing account and recipient send gates. The product path is a contextual first action after a safe same-device tryout; real first-use comprehension still needs user observation.
- Verification: `npm test` passed 249/249; lint, no-incremental TypeScript, `node --check scripts/browser-demo-smoke.mjs`, `git diff --check`, and `npm run build` passed. Isolated Chrome passed the focused sender-copy → CTA → composer keyboard flow at 390×844. It checked the CTA and unsent notice, route/draft identity, empty editable fields, no copied reaction/demo identity/media, top-of-page landing, and the old draft plus IndexedDB photo bytes. No cross-origin requests, console errors, or browser exceptions were observed in the passing run. The production build reports only outdated Browserslist data.
- Browser screenshot evidence is outside the repo at `/private/tmp/drop-browser-fresh-qa-20261024d/`. The smoke must use a no-env app copy when `.env.local` contains hosted credentials because the isolated browser deliberately blocks cross-origin auth; one no-env startup attempt also timed out at the account placeholder, then a fresh retry passed.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `feat/demo-to-first-drop`. Code commit `df710fd` (`feat: start a fresh drop from the demo`) is pushed to `origin/feat/demo-to-first-drop`. No PR or merge was created. `/letter` and `.env.local` were not changed.
- The user reports a Supabase dashboard login, but this task has no authenticated dashboard control. The read-only CLI check stopped before its API request because the sandbox blocked writing CLI telemetry under `~/.supabase`; no project, plan, or billing change was made. Hosted Free-plan verification, two-account delivery, physical 30-day deletion, screen-reader use, and physical-device behavior remain open.

**Next:** verify the approved Free Supabase project through an available dashboard or scoped CLI session, then apply/configure hosted services and test two-account delivery plus actual Storage cleanup. Run a small first-use usability check and complete screen-reader and physical-device checks.

## Latest checkpoint — relay count and mobile pass (2026-10-24)

- Relay statistics now count `carrier` handoffs only, excluding sender and recipient roles. Relay and Journey both label the value **Carriers**.
- The Relay controls stack on narrow screens; its passport ID and main headline wrap within the content width.
- Verification: `npm test` passed 249/249; lint, no-incremental TypeScript, `git diff --check`, and `npm run build` passed. A disposable Chrome check measured no overflow at 390 CSS pixels and desktop width. The repo smoke runner timed out on its initial `Page.navigate`, so the complete demo journey was not verified in this checkpoint.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `fix/relay-carrier-count`. Code commit `4f8d512` is pushed to `origin/fix/relay-carrier-count`. No PR or merge was created. `/letter` and `.env.local` were not changed.
- The Supabase CLI has no authenticated access token. The approved Free project, hosted two-account sends, actual 30-day Storage deletion, screen-reader behavior, and physical-device checks remain open.

**Next:** connect the sender-side demo copy to a fresh editable draft while preserving existing work, then resume Supabase setup when authenticated CLI or dashboard access is available.

## Latest checkpoint — Home writing spark (2026-10-24)

- Home’s **Use this thought** now opens a new editable text-drop draft seeded with the displayed prompt. The route carries the draft ID only; prompt text remains in draft content.
- The action forces a new draft instead of reusing the blank-draft optimization. Regression coverage confirms the prior photo draft and attachment can still be recovered by their original ID.
- Verification: `npm test` passed 248/248; `npm run lint`, `./node_modules/.bin/tsc --noEmit --incremental false`, and `node --check scripts/browser-demo-smoke.mjs` passed. The isolated Chrome prompt smoke passed at 360×844, 390×844, 430×844, and 1440×900, verifying an editable seeded draft, a clean URL, and preserved photo-draft attachment recovery. No cross-origin requests were observed. Chrome did not publish its DevTools port in the default sandbox; the authorized local run completed successfully.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `fix-private-claim-share-cancel-copy`. Code commit `2a29ffa` (`fix: seed home thought into fresh drop draft`) is pushed to origin. This handoff, checklist, plan, README, and learning entry are in a separate docs commit. No PR or merge was created; `/letter` and hosted Supabase were not changed.
- The user says they are signed in to Supabase, but this task has no authenticated dashboard control. No new project or billing plan was verified. The approved 30-day unclaimed-media and abandoned-staging cutoff remains implemented in the existing migration; actual hosted deletion is unverified.

**Next:** provision and verify the approved Free project through an accessible dashboard or scoped local credential, then apply migrations and configure the cleanup worker. Validate two-account claims and actual Storage deletion; complete screen-reader and physical-device checks.

## Latest checkpoint — Supabase Free provisioning access (2026-10-24)

- The user authorized one distinct Free organization and one Free project, with no paid add-ons. Supabase CLI created the organization `Drop App Free` (ref `sofucwhjqdyfensxlltl`). The API response did not include a plan, and the organization-details request returned 403, so Free status is not yet verified.
- Project creation for `Drop` in `ap-south-1`, without a compute-size override, returned 403. A follow-up read-only project list showed only the existing `arjeetanand's Project`; no Drop project was created. No paid compute/add-on was selected, the existing project was not changed, and the generated database password was removed.
- The current `.env.local` is ignored and mode 600; its existing values were not displayed or changed. The hosted setup needs a new scoped PAT with organization admin read and project create on `Drop App Free`, plus database migration write, Edge Function deploy, Edge secrets write, and `api_gateway_keys_read` and `api_gateway_keys_secret_read` for setup. A dashboard-created Free project is an alternative.
- The PAT supplied in chat was used for the organization and read-only/project-create attempts. Revoke it after replacing it with a new scoped token stored locally; do not paste the replacement into chat.
- Production verification now passes: `npm run build -- --webpack` completed; the only warnings are outdated Browserslist data and an ambiguous Tailwind easing class. `./run.sh` restarted Drop on port 4004 and the Home route returned HTTP 200.
- No code or hosted database migration changed. The approved 30-day deletion rule remains as implemented.

**Next:** verify the organization plan and provision the single Free project using a correctly scoped token or the dashboard. Then apply migrations in order, configure the cleanup worker/Vault values, and run hosted two-account delivery and Storage checks. Screen-reader and physical-device checks remain open.

## Latest checkpoint — handleless private claim links

- The composer now offers **Share without a handle** from an empty recipient step. The sender must choose this route explicitly; the panel explains that anyone holding the bearer link can claim, and it keeps the connected-account, saved-payload, and Instant-delivery gates. Switching back restores focus to the handle field.
- Successful recipientless claim issuance persists as `claim_pending` with a generic recipient label in Sent. Saved detail copy reports the pending status without saying the link was shared. Ordinary addressed sends still require a confirmed handle.
- Regression tests cover explicit eligibility, saved `claim_pending` persistence, generic local/remote recipient projections, and refusal of a normal delivered send without a recipient. The browser smoke now checks disclosure, account readiness, unchanged saved-draft status, focus return, neutral detail copy, and reload recovery.
- Verification: `npm test` passed 247/247; lint, no-incremental TypeScript, browser-script syntax, and `git diff --check` passed. The full isolated Chrome smoke passed the GIF flow at 360×844 (touch), 390×844, 430×844, and 1440×900 (keyboard), photo at 390×844, and the handleless and claim-recovery flows at all four widths (keyboard). No horizontal overflow, cross-origin requests, or Auth/RPC/Storage-write requests were observed. Screen-reader and physical-device behavior were not tested.
- Active checkout: `/Users/arjeetanand/projects/drop`; app remains available at `http://localhost:4004`. Branch: `fix-private-claim-share-cancel-copy`. Code commit `a6f8de7` (`feat: add handleless private claim route`) is pushed to `origin/fix-private-claim-share-cancel-copy`; the project notes are committed separately on the same branch. No PR or merge was created. The production build was not rerun: prior attempts were blocked by `.next/trace` write permission and Google Fonts DNS resolution.
- The user reconfirmed 30-day deletion for abandoned staging uploads; the existing migration already matches, so this slice changed no retention code. No hosted Drop project is configured, so real account-to-account claims and actual Storage deletion remain unverified. Next: validate those against the approved Free setup, then complete screen-reader and physical-device checks.

## Latest checkpoint — saved private-claim recovery browser assertions (2026-10-24)

- The browser smoke now seeds a disposable pending claim, verifies Compose recovers the saved drop after reload without offering the lost in-memory copy link, and checks that **Open saved drop** leads to the exact encoded detail route with an enabled fresh-link button.
- Verification: `npm test` passed 245/245; lint, no-incremental TypeScript, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed. An isolated Chrome context passed at 360×844 by touch and 390×844, 430×844, and 1440×900 by keyboard. The pages had no horizontal overflow, cross-origin or Auth/REST/Storage request, console error, or JavaScript exception.
- The repo runner's standalone Chrome timed out on DevTools `Page.navigate` in this environment. The equivalent recovery flow passed in a disposable context on the existing QA Chrome process. This does not verify the OS share sheet, live account-to-account delivery, actual Storage deletion, screen readers, or a physical phone.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `fix-private-claim-share-cancel-copy`. Code commit `b064dab` (`test: verify saved claim recovery in browser`) is pushed; this handoff and project notes are being committed separately. No PR or merge was created; `/letter`, `.env.local`, and hosted resources were not changed.
- Next: verify the real two-account photo/GIF claim and physical 30-day Storage cleanup against the approved Free or disposable local Supabase backend, then complete screen-reader and physical-device checks.

## Latest checkpoint — accessible reaction names (2026-10-24)

- Reaction buttons now have natural-language names (“React with a purple heart”, “React with a face holding back tears”, “React with heart hands”, and similar) using the same shared mapping as live reaction announcements. Unit tests cover all supported reactions and an unknown-reaction fallback; the rendered browser smoke checks all five button names.
- Verification: `npm test` passed 245/245; lint, `npx tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed. Isolated Chrome, running from a temporary copy without `.env.local`, passed GIF flows at 360×844 (touch), 390×844, 430×844, and 1440×900 (keyboard), and a photo flow at 390×844 (keyboard). Home/chooser had no horizontal overflow; the request gate observed no cross-origin, Auth, RPC, or Storage-write requests. The main checkout returned HTTP 200 for `/` on port 4004 and was left running.
- The smoke proves rendered labels and browser keyboard/touch simulation, not spoken output from a real screen reader or behavior on a physical device. No hosted two-account claim or real Storage deletion ran. The PostgreSQL rollback fixture also remains unrun: Homebrew PostgreSQL 16.15 `initdb` failed with `shmget` “No space left on device,” including with mmap options; no SQL assertions executed and all temporary directories were removed.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `fix-private-claim-share-cancel-copy`. Code commits `7823b41` (`fix: give reaction controls spoken names`) and `783bc52` (`fix: make reaction labels read naturally`) are pushed; this handoff, plan, checklist, README, and learning entry are recorded in a separate documentation commit on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed.
- Next: verify the first-friend photo/GIF claim journey across two disposable accounts and the actual 30-day Storage cleanup against an isolated local or approved Free Supabase backend. Then complete screen-reader and physical-device checks.

## Latest checkpoint — private claim share recovery (2026-10-24)

- The composer now says when a private claim link is ready but has not been shared, and keeps the copy action available after a cancelled share sheet. On reload, the copy stays neutral about whether it was shared; **Open saved drop** opens the corresponding encoded detail route for claim status and the existing fresh-link action.
- Regression coverage checks the unshared/recovered copy and single-segment path encoding. Verification: `npm test` passed 243/243; lint, no-incremental TypeScript, and `git diff --check` passed. Independent review found no concrete issue.
- The full signed-in demo still did not reach its flow because its page-level gate blocks the configured Auth request. The saved recovery/detail route has since been verified separately in a credential-free isolated browser context. No server-side activity was covered by the browser gate.
- The 30-day deletion rule for valid abandoned staging uploads remains confirmed and already implemented. Hosted two-account delivery and actual Storage cleanup remain open until the approved Free project or an isolated local fixture is available.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `fix-private-claim-share-cancel-copy`. Code commit `53cbb82` (`fix: make private claim recovery truthful`) is pushed; this handoff and learning entry are recorded in a separate documentation commit on the same branch. No PR or merge was created; `/letter`, `.env.local`, and hosted resources were not changed.
- Next: test operating-system share cancellation in a real browser, then verify the complete two-account photo/GIF claim and 30-day Storage cleanup journey against the approved Free or disposable local Supabase runtime.

## Latest checkpoint — demo browser viewport coverage (2026-10-24)

- Home now offers **Try a demo drop**. The chooser opens a bundled photo or GIF in the existing recipient reveal, reaction, and sender-copy flow without sign-in or a handle. The sample is stored locally, sends no notification, and leaves the active draft intact.
- Demo media writes capture one local account scope before fetching the bundled asset. A stale account is rejected before the IndexedDB write; a switch during the write is rejected and rollback targets only the captured account. Tests cover active-draft preservation and both account-switch windows.
- Verification this slice: `npm test` passed 241/241, `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, `git diff --check`, and isolated Chrome browser flows passed. The GIF journey passed at 360×844 (touch), 390×844 and 430×844 (keyboard), and 1440×900 (keyboard); the photo journey passed at 390×844 (keyboard). Home and the chooser had no horizontal overflow at all four widths. The page-scoped request gate observed no cross-origin, Auth, RPC, or Storage-write requests. Plain incremental `npm run typecheck` hit a sandbox EPERM writing ignored `tsconfig.tsbuildinfo`; the no-incremental check passed. Build was not rerun for this test-script-only slice; it passed in the prior demo checkpoint.
- Chrome touch input timed out at 430px, so that viewport uses keyboard activation in the automated flow. The user confirmed valid abandoned staging uploads should be deleted after 30 days; the existing migration matches this rule, and no cleanup code or hosted resource changed. Hosted two-account sends, actual Storage deletion, screen-reader behavior, and physical-device keyboard/safe-area checks remain open.
- Active checkout: `/Users/arjeetanand/projects/drop`; branch `test/demo-accessible-viewports`. Code commit `81a5646` (`test: expand demo browser viewport coverage`) and documentation commit `5ffe3f2` (`docs: record demo browser verification`) are pushed to `origin/test/demo-accessible-viewports`. No PR or merge was created. `/letter` and `.env.local` were not changed or staged.
- Next: continue the larger mobile-sharing plan by verifying real account-to-account media send and the cleanup worker only after the approved Free Supabase project is configured; then cover screen readers and physical-device keyboard/safe-area behavior.

## Latest checkpoint — unknown-handle photo/GIF claim coverage (2026-10-24)

- Extended `scripts/local-supabase-smoke.mjs` to create and finalize a disposable PNG and GIF claim invite for the same signed-in account with no Drop profile. It asserts that rows, downloads, and signed URLs stay unavailable before profile setup and after profile setup until the claimant explicitly claims each invite. After claim, sender and claimant can read the row/media while an outsider cannot; the sender status RPC contains both IDs. Cleanup tracks staging and final object paths and removes them through the Supabase Storage API.
- Extended `tests/db/drop_claim_invites.sql` for the same unprofiled and profiled-but-unclaimed checks, explicit claims for both kinds, post-claim media reads, and durable sender status. The existing media cleanup schedule/Vault gate remains intact. The approved 30-day policy for unclaimed media and abandoned staging uploads is unchanged.
- Verification: `npm test` passed 237/237; `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/local-supabase-smoke.mjs`, and `git diff --check` passed. The live local Supabase smoke was not run because loopback port 54321 is owned by an SSH listener and PostgreSQL at 54322 did not respond. The SQL fixture was not run: a disposable PostgreSQL 16.15 server failed at `shmget` while allocating System V shared memory. Home returned HTTP 200 on port 4004 after `./run.sh start`; rendered browser behavior was not checked.
- Code commit `adc648b` (`test: cover unknown-handle photo and GIF claims`) is pushed to `origin/test/unknown-handle-media-claim-smoke`. Documentation and the append-only learning entry are being committed separately on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted Supabase resources were not changed.
- Next: rerun the SQL fixture and local Auth/Storage smoke only after a disposable Supabase project with the hourly cleanup schedule and Vault values is available. Then verify the rendered mobile/desktop claim path and actual 30-day cleanup against the approved Free project.

## Latest checkpoint — private claim send receipt (2026-10-24)

- The Sent claim receipt distinguishes a completed share sheet from a copied link, uses neutral wording for missing/invalid legacy outcome flags, and does not say the recipient received or opened it. Waiting comes from an owner-filtered pending row; claimed requires the sender-scoped claim-status RPC. Status refreshes on focus/visibility/auth changes, is keyed to drop and account, suppresses stale responses, and is announced politely to assistive technology.
- A requested Sent drop ID is authoritative. If it is missing locally, the page does not substitute the current draft. Receipt query parameters contain only the drop ID and typed display flags; bearer token and message content are absent.
- The user reconfirmed automatic deletion of valid abandoned staging uploads after 30 days. The existing policy and cleanup migration already match this; no cleanup code or hosted resource changed in this slice.
- Verification: `npm test` passed 237/237; lint, no-incremental TypeScript, and `git diff --check` passed. Home and `/sent?letter=missing&claim=1&share=copied` returned HTTP 200 on port 4004. The production build stopped with `EPERM` opening `/Users/arjeetanand/projects/drop/.next/trace`. Rendered browser behavior, hosted two-account status, and actual media deletion were not verified.
- Branch `fix/private-claim-receipt-outcome`; code commit `ac0396f` (`fix: clarify private claim receipts`) is pushed to `origin`. The README, plan, checklist, handoff, and learning entry are being committed separately. Reviewers found and verified fixes for cross-receipt/account status carryover and missing live announcements. No PR or merge was created. `.env.local`, `/letter`, and hosted resources were not changed.
- Drop is running at `http://localhost:4004`. Next: test rendered share/copy and claim status with browser tooling; then verify unknown-handle photo/GIF claims and actual Storage cleanup against isolated local or approved Free Supabase services.

## Latest checkpoint — PKCE callback effect replay (2026-10-24)

- Reuse one pending exchange for a one-time Supabase PKCE code when React replays the auth callback effect. Cleanup now prevents disposed effect runs from changing callback state or navigating after a newer run takes over.
- Added deterministic coverage for same-code exchange reuse, distinct codes, stale callbacks, and the combined replay case where only the active callback reaches the private claim route. Independent frontend review found no concrete findings.
- Verification: `npm test` passed 224/224; `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. `npm run build` stopped with `EPERM` opening `.next/trace` in the active checkout. No browser-rendered sign-in, hosted OAuth, or two-account flow was verified.
- Branch `fix/auth-callback-effect-replay`; code commit `7afdf3b` (`fix: guard auth callback effect replay`) is pushed to `origin`. The checklist, README, plan, handoff, and learning entry are being committed separately. No PR or merge was created. `.env.local`, `/letter`, and hosted resources were not changed.
- The existing local Node listener on port 4004 was left untouched; this turn did not verify an HTTP response. Local Supabase ports remain unavailable, and no hosted project is configured.
- Next: verify email/OAuth callback rendering and a two-account private claim in an isolated browser/Supabase runtime; continue with unknown-handle photo/GIF access and actual 30-day Storage cleanup when the Free project/runtime is available.

## Latest checkpoint — unknown-handle text claim smoke coverage (2026-10-24)

- Extended `scripts/local-supabase-smoke.mjs` to use five disposable accounts and cover the unknown-handle text journey from pending invite through profile creation, reissue, explicit claim, same-account retry, outsider/replay denial, participant privacy, sender status, and reaction visibility. Denial assertions require the expected authorization SQLSTATE and no returned drop ID.
- Verification: `npm test` passed 220/220; `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/local-supabase-smoke.mjs`, and `git diff --check` passed. The live local Supabase smoke and rollback-only claim SQL fixture were not run: port 54321 is owned by an SSH listener, and the disposable PostgreSQL startup failed on host shared-memory allocation. Browser rendering was not checked.
- Branch `test/unknown-handle-claim-smoke`; code commit `e5b7b43` (`test: cover unknown-handle text claim smoke`) is pushed to `origin`. The README, Supabase setup guide, plan, checklist, handoff, and learning entry are committed separately on this branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed.
- The approved retention rule remains 30 days for unclaimed media and valid abandoned staging uploads; physical deletion still depends on the configured cleanup worker. Hosted Free Supabase setup is not configured, so hosted migrations, two-account behavior, and actual Storage deletion remain unverified.
- Next: rerun the local smoke and SQL fixture against a confirmed disposable runtime, then complete browser-rendered mobile/desktop claim checks and the photo/GIF claim plus cleanup journey against the approved Free project when available.

## Latest checkpoint — mobile claim-first return (2026-10-23)

- Profile saves return to the claim handoff only after successful remote sync. The sync-gated return path is sanitized, and the recipient still must press **Claim this drop**; the app does not auto-claim.
- Reworked the claim screen for a shorter mobile flow with a compact semantic progress bar, preserved privacy and expiry details, and focus on the claim action after account readiness or a retryable claim failure. If the browser cannot persist the invite, the page blocks profile navigation and explains recovery without putting the bearer token in a route.
- Verification: `npm test` passed 220/220; `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. `/`, `/claim`, claim-aware `/profile`, and `/auth/callback` returned HTTP 200 on local port 4004. Independent source review found no blocker.
- Branch `feat/claim-first-mobile-flow`; code commits `23240ea` (`fix: return to claim after profile sync`) and `9f188ee` (`feat: streamline private claim return flow`) are pushed. No PR or merge was created. `.env.local`, `/letter`, and hosted resources were not changed.
- Browser-rendered mobile/desktop flow, keyboard and screen-reader focus, storage-blocked UI, hosted OAuth/email return, cross-tab behavior, and two-account claim remain unverified. Local Supabase was not started because an SSH process owns port 54321. A production build was not run for this slice; previous builds were blocked by DNS resolution of the existing Google Fonts host.
- Next: run rendered browser and two-account tests when browser tooling and the approved Free Supabase runtime are available; use another approved local port mapping only after confirming the SSH listener's purpose.

## Latest checkpoint — relay draft private-claim fallback (2026-10-23)

- Relay mode now offers an explicit switch to Instant for a connected sender whose current recipient lookup confirmed an unknown handle. This opens access to the existing private photo/GIF/text claim path, which still requires a separate user action to create/share the link.
- The mode switch persists the current draft with its saved attachment and stable media upload ID, changes only delivery mode, then moves focus to the existing private-link action. It stays disabled and its handler rechecks eligibility while an invite, send, or delete is active.
- Verification: focused eligibility tests and `npm test` passed 219/219; lint, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. The safe claim authorization remains instant-only; no server or SQL policy changed.
- Branch `feat/relay-claim-fallback`; code commit `56dc3f2` (`feat: offer instant claims for relay drafts`) is pushed. Documentation updates are being recorded in a separate commit on this branch. No PR or merge was created; `/letter` and hosted Supabase were not changed.
- `./run.sh start` restarted the Drop-owned process and Next reported ready on port 4004. The HTTP probe returned HTTP 000, so route responses were not verified. No rendered browser interaction ran; the production build remains blocked by the existing `fonts.googleapis.com` DNS failure.
- Hosted unknown-handle photo/GIF claims, hosted migrations/worker, actual Storage deletion, and keyboard/screen-reader verification remain open. No hosted project is configured.
- Next: use the rendered mobile and desktop composer to verify the switch, saved attachment preservation, focus, and explicit claim-link action; then exercise the flow with two disposable accounts against local or approved Free Supabase.

## Latest checkpoint — 30-day staged-media cleanup and retry identity (2026-10-23)

- Added `20261023170000_drop_pending_media_retention.sql` to scan valid, unlinked staging objects under `/pending/` after 30 days, in batches of up to 25. The cleanup Edge Function removes them through the Supabase Storage API and retries failures. A per-path lock prevents queued deletion from racing a same-path upload; completed paths stay tombstoned for at least 24 hours and are cleared by a later scan.
- New uploads preserve one finalized-media ID for the logical draft and use a fresh ID for each staging attempt. The composer now backfills and reads back the stable ID for a restored legacy attachment before issuing a private media-claim invite; it stops if local persistence fails.
- Expanded the rollback-only PostgreSQL fixture to prove authenticated acceptance of five-segment staging paths and scan recognition. The fixture also covers old/new path formats, the 30-day cutoff, queued-path reservation, retry, idempotent finish, and tombstone expiry.
- Verification: `npm test` passed 218/218; lint, no-incremental TypeScript, and `git diff --check` passed. `tests/db/drop_claim_invites.sql` passed against an isolated PostgreSQL 16 cluster. The SQL fixture transaction rolled back and the temporary server stopped cleanly.
- Branch `feat/claim-invite-journey`; code commits `d71c4e3` (`feat: expire abandoned staged media after 30 days`), `41247b6` (`fix: persist media ID for legacy claim retries`), and `5bf4df3` (`test: cover authenticated five-part staging paths`) are pushed. The documentation/checklist/learning update is a separate commit. `/letter` and hosted Supabase resources were not changed.
- Production build did not complete because this environment could not resolve `fonts.googleapis.com` for existing Google Fonts; it was not rerun after the small retry-ID fix. Deno Edge bundling, hosted migration/worker configuration, real Storage deletion, two-account claims, and concurrent DB behavior remain unverified. Rendered claim/retry, accessibility, and device checks remain open.
- Next (superseded by the current checkpoint): verify the approved Free project, configure the cleanup worker, and validate two disposable accounts plus actual Storage cleanup. The earlier custom index was removed in commit `8605dbf`; large-bucket scan cost and concurrent DB interleavings remain open.

## Latest fix — safe guest draft auth recovery (2026-10-23)

- A sign-in return to a guest draft now stays on the profile recovery screen if copying fails, the requested draft cannot be verified, or the signed-in account changes during transfer. Recovery offers an explicit retry or a safe profile route.
- Compose navigation requires an account-scoped persisted draft readback. Draft ID collisions use the ID returned by the completed copy. The active Supabase session is checked before and after asynchronous transfer and retry; the account storage lookup does not fall back to seeded or default drafts.
- Verification: `npm test` passed 206/206; lint, no-incremental TypeScript, `git diff --check`, and `npm run build -- --webpack` passed. Home and Auth callback returned HTTP 200 on port 4004. Independent QA reviewed missing-draft, ID collision, guest-preservation, and account-switch recovery.
- Branch `fix/guest-draft-return-recovery`; code commit `67095bc` (`fix: preserve safe guest draft auth recovery`) is pushed. This handoff, checklist, README, and learning entry are committed separately on the same branch. No PR or merge was created. `/letter` and hosted resources were not changed.
- Rendered callback interaction, keyboard/screen-reader behavior, and real cross-account guest photo/GIF transfer remain unverified; the local check was an HTTP route check, not a browser interaction test.
- Next: verify the recovery controls in a rendered browser, then test guest text/photo/GIF transfer and retry across two disposable accounts when a local or approved Free Supabase project is available.

## Latest fix — retryable claim verification (2026-10-23)

- A failed claim RPC no longer automatically tells the recipient the invite expired. The claim function maps SQLSTATE `42501` to the generic unavailable/fresh-link message because the database uses it for invalid, expired, revoked, replaced, already-claimed, and other terminal outcomes. Other RPC errors and thrown failures receive calm retry copy without exposing backend text.
- A failed attempt leaves the token in the claim page's current session; only a successful claim clears the stored handoff and opens the drop. Successful RPC responses with missing/invalid IDs retain the generic unavailable message.
- Verification: focused claim tests passed 8/8; `npm test` passed 200/200; lint, no-incremental TypeScript, and `git diff --check` passed. Home and Claim returned HTTP 200 at `http://localhost:4004`. Independent QA approved after the SQLSTATE correction.
- Branch `fix/claim-rpc-retry-copy`; code commit `e2e8db7` (`fix: keep claim service failures retryable`) is pushed. This handoff, checklist, README, and learning entry are committed separately on the same branch. No PR or merge was created.
- Rendered claim interaction, screen-reader behavior, hosted two-account claims, and actual Storage deletion remain open. `/letter` and hosted resources were not changed.
- Next: validate rendered retry/terminal states when browser automation is available, then complete the two-account photo/GIF claim and 30-day Storage cleanup journey against local or approved Free Supabase.

## Latest checkpoint — cleanup endpoint boundary tests (2026-10-23)

- Extracted the cleanup Edge Function into an injectable request handler; `index.ts` now supplies the Deno environment and Supabase client adapter. The endpoint still checks POST, a configured high-entropy request secret, project URL/service key, and bounded content length before constructing a service client.
- Added nine rejected-request cases that assert zero client/RPC/Storage calls, plus an authorized reconciliation → lease → Storage removal → finish path and a retryable 503 when job finalization fails.
- Verification: the focused test file passed 12/12; `npm test` passed 196/196; lint, no-incremental TypeScript, and `git diff --check` passed. Home and Claim returned HTTP 200 at `http://localhost:4004`.
- Independent QA review found no required changes. Deno is not installed; the Supabase CLI was not usable because its version check hit an EPERM telemetry write outside the workspace, so no Edge bundle/deploy check ran. The adapter's client type assertion is not validated by the app TypeScript check. The fake client does not prove real Storage deletion or hosted secret/schedule configuration.
- Branch `fix/cleanup-endpoint-boundary`; code commit `30e3190` (`test: cover private media cleanup endpoint boundary`) is pushed. This handoff and related checklist/README/learning updates are in a separate docs commit on the same branch. No PR or merge was created. `/letter` and hosted resources were not changed.
- Next: verify the unknown-handle photo/GIF claim flow with two disposable accounts, pre-claim privacy, claim replay/reissue, sender status, and real Storage deletion after applying the migrations and deploying the worker to a local or approved Free project.

## Latest fix — claim email return across tabs (2026-10-23)

- On claim entry, the bearer token is captured from the URL fragment and removed from the address. For email or Google sign-in that returns in another tab of the same browser, a random opaque UUID points to a browser-local record with a 10-minute expiry. The receiving tab binds the token to that handoff ID in its own session storage before the shared record is removed, so a stale token cannot resume a different invite. The raw token is never put in query/path URLs or share text. If session storage is unavailable, the shared record stays until expiry. The open tab schedules expiry cleanup, and each claim-page load prunes expired or malformed records if an earlier tab closed before its timer ran. A successful claim clears any remaining handoff. A different browser or device must reopen the original invite.
- Claim recipients now see a claim-specific profile setup path; the generic request to send a handle back is hidden, the auth callback says it is returning to the drop, and a synced profile has a prominent Continue to claim action. The final claim remains explicit.
- Verification: `npm test` passed 184/184; lint, no-incremental TypeScript, `git diff --check`, and `tests/db/drop_claim_invites.sql` passed in a fresh disposable PostgreSQL 16 cluster over a Unix socket. Home, Claim, claim-aware Profile return, and Auth callback routes returned HTTP 200 on port 4004.
- The isolated Webpack production build could not fetch the existing Google Fonts (`fonts.googleapis.com`, `ENOTFOUND`). Rendered browser, separate-tab email, hosted two-account, and actual Storage deletion checks remain open; browser automation and hosted Supabase are unavailable in this environment. No hosted resources changed.
- Branch: `fix/claim-email-return`. Code commit `b7483df` is pushed; the checklist, README, handoff, and append-only learning entry are in a separate documentation commit. The app remains available at `http://localhost:4004`.

## Latest decision — private media retention (2026-10-23)

- The product decision is confirmed: automatically delete unclaimed photo/GIF drops after 30 days. Existing code already matches this: initial media invite issuance sets an immutable 30-day access cutoff, while each bearer link lasts at most 7 days and reissues do not extend the cutoff.
- `tests/db/drop_claim_invites.sql` covers the cutoff, replay/reissue boundaries, expired access denial, and cleanup job state. It models Storage deletion through the worker RPC; it does not prove a running Edge Function removed a real Storage object.
- Current environment check: the local app was restarted from `/Users/arjeetanand/projects/drop` and `/`, `/claim`, and `/compose?new=1` return HTTP 200 on port 4004. Local Supabase on port 54321 remains stopped. Supabase CLI and browser automation are unavailable; the installed Docker client cannot reach a daemon. No hosted Supabase resources were accessed or changed.
- Next: restore a disposable local Supabase runtime without resetting shared state, then add and run an API smoke for unknown-handle photo and GIF issue/claim, sender status, and pre/post-claim Storage access. Follow with rendered sign-in and claim checks when isolated browser automation is available.

## Latest checkpoint — local verification and card contrast (2026-10-23)

- Improved small text contrast on the home, sent, and relay cobalt cards in `app/page.tsx`, `app/sent/page.tsx`, and `app/relay/page.tsx`. White at 70%/75% opacity on `#2b45f7` measured 3.88:1/4.26:1; the new 80% value measures 4.63:1.
- `npm run test:local-supabase` passed with four disposable accounts. It verified known-recipient sender/recipient access, outsider denial, reactions, GIF finalization after a simulated lost response, relay privacy/collection, and legacy relay normalization; the process exited cleanly after removing test users and media.
- `npm test` passed 175/175; `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build -- --webpack`, and `git diff --check` passed. The production build emitted only the existing Browserslist freshness and Tailwind easing warnings.
- Local HTTP checks returned 200 for `/`, `/sent`, `/relay`, `/claim`, and `/compose` at `http://localhost:4004`. `./run.sh` leaves Drop running on the main port; local Supabase verification uses 5004 and browser QA reserves 6004.
- Code commit `d842811` (`fix: improve contrast on Drop blue cards`) is pushed to `origin/fix/drop-card-contrast`. Plan, README, checklist, and learning entry are included in a separate documentation commit on the same branch. No PR or merge was created.
- This was local verification for known-recipient flows. Unknown-handle photo/GIF claims, rendered browser/device/accessibility behavior, hosted migrations/scheduling, actual hosted Storage deletion, large-bucket scan performance, and concurrent DB interleavings remain unverified. No hosted resources were changed.
- Next: use secure local Supabase CLI authentication for the approved Free setup, then verify the unknown-handle two-account claim journey and cleanup behavior in the hosted project; finish rendered mobile/desktop browser checks when a browser runtime is available.

## Previous checkpoint — media orphan reconciliation

- Added migration `20261023160000_reconcile_orphan_drop_media.sql`: a service-role-only keyset scan examines up to 25 old `drop-media` objects per call, validates finalized path and image/GIF metadata, skips linked or already queued paths, and queues qualifying unlinked objects after 30 days for deletion through the existing Storage API worker.
- The worker now runs orphan discovery before leasing. Discovery is best-effort: if it fails, existing cleanup jobs still lease and process, then the worker reports a partial failure for the next scheduled run.
- Verification: `npm test` passed 175/175; lint, no-incremental TypeScript, `git diff --check`, and `bash -n run.sh` passed. The rollback-only `tests/db/drop_claim_invites.sql` fixture passed against disposable local PostgreSQL 16, including page continuation, cursor reset/wrap, an older object behind the cursor, a near-cutoff object, exclusions, invalid limits, grants, and idempotency. `/`, `/compose`, and `/claim` returned HTTP 200 on port 4004.
- Code commit `ae33ab2` (`feat: reconcile orphaned media cleanup`) is pushed to `origin/feat/media-orphan-reconciliation`. This handoff, setup notes, checklist, plan, README, and learning entry are in a separate documentation commit. No PR or merge was created.
- At the time of this earlier checkpoint, no hosted migration, scheduled Edge Function, actual Storage deletion, two-account flow, or rendered browser check had run. The managed-table index concern was later resolved by removing that index; see the latest checkpoint above. Concurrent database interleavings remain untested.
- The existing Drop development server is healthy at `http://localhost:4004`. Next: verify the approved Free project, configure the cleanup worker, and validate two-account claims plus real Storage deletion.

## Previous checkpoint — Realtime fixture topic scoping

- The reaction broadcast fixture now filters direct SQL reads to the simulated channel topic. The prior assertion scanned rows from every topic and treated an authorized `drop-inbox` subscription as if it received `drop-reactions` messages; the production authorization policies were unchanged.
- Verification: `tests/db/drop_reaction_broadcast.sql` passed on disposable PostgreSQL 16, and `git diff --check` passed.
- Code commit `88f9b11` (`test: scope Realtime fixture reads by channel topic`) is pushed to `origin/feat/media-orphan-reconciliation`.
- Hosted Realtime delivery and rendered two-account behavior remain unverified. Next: validate media orphan reconciliation against the approved hosted Free project.

## Latest checkpoint — private photo/GIF claim links and cleanup

- The composer can send an instant photo/GIF claim link to an unknown handle. The recipient must authenticate and explicitly claim before media opens; senders retain a durable claimed status after reload. Relay claim links remain out of scope.
- Media claim links last up to 7 days, while the immutable claim/access cutoff is 30 days after first send. The hourly worker queues deletion through the Supabase Storage API and retries failures. Free-project pauses and worker/Storage outages can delay physical deletion.
- The composer preserves its selected file and rotates the local upload path only after cleanup is confirmed. Finalized but unlinked media normally gets a delayed cleanup tombstone; same-path locks protect recovery and deletion.
- Verification: `npm test` passed 171/171; lint, no-incremental TypeScript, `git diff --check`, `bash -n run.sh`, and the rollback-only PostgreSQL claim/media fixture passed. `npm run build -- --webpack` passed with existing Browserslist and Tailwind easing warnings. `/`, `/compose`, `/claim`, `/mailbox`, and `/letter/drop-fixture?view=sender` returned HTTP 200 at `127.0.0.1:4004`.
- No hosted migration, Edge Function schedule, real Storage deletion, cross-account send, or rendered browser interaction was run. Browser/Playwright automation is unavailable. The SQL lock tests are sequential, not concurrent. The new scan covers finalized objects when both orphan-queue attempts fail, but hosted cleanup remains incomplete until the migration and worker are deployed.
- Code commit `2d578ca` (`feat: add private photo and GIF claim drops`) is pushed to `origin/feat/private-media-claims`. This handoff, checklist, plan, README/setup notes, and learning entry are being committed separately. No PR or merge was created. The local app remains available on port 4004.
- Next: apply the migrations and configure the worker/Vault secrets on the approved Free Supabase project, then verify two-account claim/reissue and actual Storage deletion. The orphan-discovery gap is covered in the latest checkpoint; concurrent database interleavings remain to test before production.

## Previous checkpoint — relay collection terminal views

- Journey and Relay now use the sender's durable delivered relay status and stored activity time to show recipient collection. The map, route chain, custody timeline, and passport complete together; carrier invites disappear after collection. A failed first status read stays unknown, preventing an invite from appearing on an unconfirmed state.
- Verification: `npm test` passed 161/161; lint, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. The guarded `./run.sh start` serves port 4004; `/`, `/journey?letter=drop-fixture`, and `/relay?letter=drop-fixture` return HTTP 200.
- Browser QA used a fresh temporary profile and synthetic GET-only fixture. Journey at 390×844 and 1440×900 showed “This journey isn’t available”; Relay at 390×844 showed the waiting state and carrier invite. The fixture did not hydrate a sender row, so no collected-state browser pass is claimed. Console output, desktop Relay, carrier mode, screen-reader, and device behavior remain unchecked.
- No database rows or hosted resources changed. The production build was not rerun; its prior attempt was blocked by DNS resolution of the existing Google Fonts host. The local app remains available at `http://localhost:4004`.
- Code commit `3ee659a` (`fix: complete relay collection views`) is pushed to `origin/fix/relay-collection-terminal-state`. This handoff and learning-log update is being committed separately. No PR or merge was created.
- Next: validate the collected sender views using a valid local authenticated fixture, then check carrier, dispatched, and instant-delivered states. Continue private photo/GIF claim links only after the text claim path is accepted and unclaimed-media retention is decided.

## Previous checkpoint — sender journey after relay collection

- Fixed a mismatch where the sender header reported a collected drop while the relay chain and custody timeline still showed the recipient as the next stop. The journey now derives the recipient stop from durable `delivered` status and uses the stored collection activity time; it leaves the saved handoff route unchanged.
- Added regression coverage for dispatched and collected states, event text/time, repeat-safe projection, and unchanged handoff state. The append-only learning entry is in [LEARNINGS.md](./LEARNINGS.md).
- Verification: `npm test` passed 159/159; lint, no-incremental TypeScript, and `git diff --check` passed. Production build was attempted from an isolated source copy and stopped because sandbox DNS returned `ENOTFOUND fonts.googleapis.com` for existing Google Fonts in `app/layout.tsx`.
- Local browser QA at 390×844 confirmed `/` and Next layout assets respond, but the page remained at “Checking your account…” and no rendered interaction or screenshot was verified. Screen-reader, device, and hosted two-account behavior remain open.
- Code commit `d9eeadb` (`fix: reflect relay collection in sender journey`) is pushed to `origin/feat/journey-collection-receipt`; its documentation and learning-log update were committed separately as `fa1ae1c`. The local app remains on port 4004. No PR or merge was created.
- Next: retry the production build where Google Fonts resolve, then verify the relay collection journey in an authenticated browser at mobile and desktop widths.

## Previous verified checkpoint — persistent sender claim status

- Added a forward-only sender-status RPC over the private invite table. It returns only claimed drop IDs for the authenticated sender and verifies the matching row is a delivered instant text note; invite tokens and recipient account IDs remain private. The UI maps that status to “Claimed by [name]” in Sent and sender detail, including after a reload. Ordinary delivered notes stay “Delivered,” and the live one-time announcement remains.
- Added an append-only [LEARNINGS.md](./LEARNINGS.md) and a repository instruction to record the issue, cause, fix, verification, Git checkpoint, and remaining gap for each completed code or issue-resolution slice.
- Bounded the optional claim-status read to five seconds so it cannot hold Mailbox or detail indefinitely. A cold sender detail retries a failed status read after ten seconds, then every 60 seconds while visible; a successful negative ends retries, and a positive only updates the badge without announcing an old claim.
- Code commit `84e5ba2` (`feat: persist sender claim status`) is pushed to `origin/feat/persistent-claim-status`; documentation is committed separately. No PR or merge was created.
- Verification: `npm test` passed 158/158; `npm run lint`, `npx tsc --noEmit --incremental false`, the isolated PostgreSQL claim/broadcast/status fixture, and `git diff --check` passed. The fixture confirms sender-only status after token expiry and excludes ordinary deliveries, pending/revoked invites, anon, and another account.
- `npm run build -- --webpack` passed from a disposable source copy. It reported the existing Browserslist freshness and Tailwind easing warnings. The local server on port 4004 returned HTTP 200 for `/`, `/mailbox`, `/letter/incoming-1?view=sender`, and `/claim`.
- Rendered browser, screen-reader, and two-account behavior were not checked. The migrations are not applied to hosted Supabase; hosted status reads remain unavailable until the approved Free project is configured and all three claim migrations are applied.
- The active checkout is `/Users/arjeetanand/projects/drop`; `.env.local` is already there, mode 600 and ignored by Git. The former OneDrive Drop path is absent, so no file remained to delete; `/letter` is unchanged. No hosted Supabase resources were created.
- Next: verify the rendered sender flow and account-to-account claim against local or hosted Supabase when available.

## Previous verified checkpoint — accountless private text claim

- Added a text-first claim link for instant notes sent to an unknown handle. The recipient must sign in, set up a Drop profile, and explicitly claim the note. Tokens use 256-bit secure randomness, travel in the URL fragment, and only their SHA-256 digest is stored; note text and recipient handles are absent from share copy.
- Added sender `claim_pending` status and a detail-page reissue action. Reissue reads exact stored content inside an authenticated RPC, also works after invite expiry, and refuses claimed or revoked notes. A per-tab guard and, where supported, Web Locks keep concurrent reissue/share calls from replacing one another in the same browser; a later operation from another device can invalidate a link already shared.
- Added an isolated PostgreSQL fixture for RLS, RPC grants, digest storage, expiry, token rotation, whitespace preservation, claim replay, and sender/outsider denial. Code commit `e3d5c5b` (`feat: add private text drop claim links`) is pushed to `origin/feat/invite-first-drop-resilience`; docs commit follows separately. No PR or merge was created.
- Verification: `npm test` passed 151/151; `npm run lint`, `npx tsc --noEmit --incremental false`, the isolated PostgreSQL claim fixture, and `git diff --check` passed. `/`, `/compose`, `/claim`, `/mailbox`, and `/letter/incoming-1` each returned HTTP 200 on port 4004. `npm run typecheck` could not write `.tsbuildinfo` in this checkout; the equivalent no-incremental TypeScript check passed.
- Production build remains unverified: the active checkout cannot write `.next/trace`, while an isolated copy failed to resolve Google Fonts (`fonts.googleapis.com`). Browser automation, screen-reader/device checks, and hosted two-account claim behavior remain open. The local app is running at `http://localhost:4004`.
- `.env.local` is already in `/Users/arjeetanand/projects/drop`, mode 600 and ignored by Git. The OneDrive Drop directory is absent, so there was nothing to move or delete; `/letter` remains untouched. No hosted Supabase resources were created; authenticated management access is still needed for the approved Free organization/project. Rotate the PAT that was pasted into chat before using it again.
- Next: verify the rendered claim and reissue flows, then provision the Free Supabase setup through secure local CLI authentication and test two disposable accounts. Extend private claims to photo/GIF and relay after the text path is accepted.

## Previous verified checkpoint — recipient relay collection

- Recipient relay cards now show only sender and carrier route updates while a drop is in transit. The recipient must collect it before letter content, media, reactions, or private journey events become readable; the sender journey refreshes to the collected state.
- Code commit `75f8a89` (`feat: let recipients collect relay drops`) is pushed to `origin/feat/invite-first-drop-resilience`. This handoff and checklist update are committed separately. No pull request or merge was created.
- The two ordered migrations add the recipient route summary and repeat-safe collection RPC, gate content and media on `dispatched` status, and normalize older dispatched rows whose `delivery_mode` is still `instant`. The compatibility migration replaces the old media-path check before backfilling, while validating new and changed paths.
- Verification: `npm test` passed 145/145; lint, `npx tsc --noEmit --incremental false`, local Supabase smoke, `node --check scripts/local-supabase-smoke.mjs`, `bash -n run.sh`, and `git diff --check` passed. Smoke verified four disposable local accounts, route-only summaries, pre-collection privacy for message/media/reactions/events/notes, collection retry safety, and legacy dispatched rows. The focused migration review found no blockers.
- `run.sh` is active on port 4004; `/` and `/mailbox` returned HTTP 200. No rendered browser, screen-reader, real-device, or hosted cross-account check was run for this slice. The active-checkout production build hit sandbox `EPERM` writing `.next/trace`; a scratch Webpack build could not resolve `fonts.googleapis.com`. An isolated production build had passed earlier in this feature work.
- The authoritative checkout is `/Users/arjeetanand/projects/drop`. `.env.local` is present, mode 600, ignored, and untracked. The former OneDrive Drop directory is absent, so no file was moved or deleted; `letter` remains untouched.
- No hosted Supabase project was created. The user approved a distinct Free organization and one Free project; the local Supabase CLI reports that no access token is configured, and no hosted resources were changed. The app's local environment remains loopback-only.
- Next: rotate the Supabase PAT that was pasted into chat, authenticate the CLI locally, then finish the approved Free Supabase setup with no paid add-ons. Apply both recipient relay migrations in order and verify photo/GIF relay plus sender/recipient reactions across disposable accounts. Rendered browser, screen-reader, and real-device checks remain open.

## Active checkout and Git

- Active code checkout: /Users/arjeetanand/projects/drop
- GitHub remote: private repository arjeetanand/drop
- Current branch: `feat/journey-collection-receipt` is based on pushed commit `4b45809` and includes pushed code commit `d9eeadb`. The documentation and learning-log commit is pending. Earlier commits include `84e5ba2` (persistent sender claim status), `0b11a73` (learning-log setup), `75f8a89` (relay recipient collection), `8493097` (sender reaction race safety), `6f618ed` (invite storage guard), and `41c409e` (profile copy fallback). No pull request has been created.
- Previous mailbox search-focus branch: `fix/mailbox-search-focus`, code commit `bbf9df8` pushed to origin; no pull request has been created.
- Mailbox empty-state feature commit: `10efead` (`feat: tailor mailbox empty states to filters`), pushed to `origin/feat/mailbox-filter-empty-states`; the docs update is committed separately.
- Recipient-first composer commit: `a9049cf` (`feat: put recipient first in drop composer`), pushed to `origin/feat/recipient-first-compose`.
- Relay token URL commit: `fd5a327` (`fix: keep relay bearer tokens out of request URLs`), pushed to `origin/feat/relay-token-fragment`; no pull request has been created.
- Prior handoff/docs commits on feat/relay-token-fragment: 629f480 and 7fc824f, both pushed to origin.
- Live sender reaction commit: `9c375a1` (`feat: notify senders about new drop reactions`), pushed to `origin/feat/live-reaction-feedback`.
- The current branch also includes the pushed inbox checkpoint from `feat/drop-live-inbox-arrival`; its prior commits are listed below.
- Live inbox commit: `1cf321d` (`feat: surface new drops in live inbox`), pushed to `origin/feat/drop-live-inbox-arrival`; not merged and no pull request created.
- Prior handoff follow-up: `49b68a3` (`docs: record live inbox delivery`), the head of the inbox feature branch before this reaction branch was created.
- Prior feature commits, pushed to origin/feat/relay-route-live-refresh:
  - 21f8120 (feat: refresh shared relay routes live)
  - bc21947 (security: restrict relay route reads to public columns)
- Base checkpoint: 132f12c (docs: update Drop migration and auth handoff), on origin/fix/local-auth-redirects.
- Parent checkpoint: aebdc53 (docs: record relay location verification).
- `feat/live-reaction-feedback` tracks its GitHub branch; it is not merged and no pull request was created.
- The former OneDrive path `/Users/arjeetanand/Library/CloudStorage/OneDrive-OracleCorporation/projects/drop` is absent from the synced filesystem. A read-only listing of the connected OneDrive `projects` folder returned 16 immediate children and none named `drop`; no deletion was performed because the target is already absent. The separate `letter` folder was left unchanged.
- `.env.local` is already present in `/Users/arjeetanand/projects/drop`, has mode 600, is ignored by Git, and is not tracked. No copy was needed because the OneDrive source directory is absent. Its values were not displayed or committed; the configured Supabase URL was checked as loopback-only.

## Change inventory
- Added a recipient-only route summary RPC and mailbox card for in-transit relays. It shows carrier count, latest carrier/neighborhood/note, and a collection action without revealing drop content or media.
- Added repeat-safe recipient collection. Dispatched rows remain sealed across letter, media, and reaction reads until collection; the sender journey refreshes after delivery. Legacy dispatched rows are normalized to relay on collection.
- Added migration compatibility for historical media paths: drop the old check before backfill and validate only inserts or changed media paths so existing rows can still transition.
- Relay token acceptance stores the exact pending attempt in tab-scoped session storage under a SHA-256 fingerprint of the invite and active local account. Refresh restores the same request ID and form details, locks them for an identical retry, expires the attempt after 24 hours, and clears it after the carrier pass is saved in account-scoped local storage.

- Removed third-party reverse geocoding from the relay handoff flow. QR and manual PIN flows ask before accessing current device location; manual neighborhood entry remains available, and location stays in local route history after a successful handoff.
- Removed the location suggestion action from secure token invites, which now use manual neighborhood entry and do not request device location.
- Added a screen-reader status announcement for handoff completion and whether the current device location was saved.
- Disclosed that legacy QR URLs contain the previous carrier's coordinates and send that URL to Drop when opened. This change does not migrate existing QR payloads.
- Configured local Supabase Auth redirects for Drop's 4004, 5004, and 6004 ports while preserving the old 3000 callback. Added a regression test and updated setup notes.
- Added visible route refresh to sender relay and journey screens: immediate read, 15-second polling while visible, refresh on tab return, manual retry, new-handoff announcements, and stale-route/error status. Empty journeys now wait for their first carrier in the copy; expired carrier invites hide QR/copy actions, announce expiry once, and offer a replacement.
- New server-issued carrier invites from Relay, Journey, and Pass On now put the bearer token in the URL fragment, outside the initial HTTP request. Previously issued query-token links still resolve and are rewritten to fragment form when opened.
- Restricted authenticated reads from `public.relay_handoffs` to route columns, excluding `source_token` and `request_id`. Added a disposable-database regression for sender/recipient access, outsider exclusion, and denied sensitive columns.
- Added a live incoming-drop cue for Home and Mailbox. Supabase Broadcast sends only the drop ID to the recipient's private topic; the client reloads through the existing row-level-security query. The visible tab retries every 60 seconds, and signals that overlap an inbox fetch queue one follow-up read.
- Home reuses the featured incoming-drop card for the “Just landed” label; Mailbox has a dismissible direct-open cue. Burst arrivals get a count; only dispatched or delivered received drops are eligible.
- Added sender reaction cues on Home and Mailbox and live reaction refresh on open sent-drop pages. A private sender-scoped Broadcast contains only the drop ID; reaction content is reloaded through participant RLS. Reconnect and visible-tab refresh recover missed signals, baseline and duplicate reactions are suppressed, and accessible status text names the reaction. A database guard rejects moving a reaction to a different drop.
- Reordered the composer so account readiness and recipient confirmation appear before note, photo, GIF, and styling controls. Existing recipient checks, draft persistence, invite flow, and send handling are reused.
- Added filter-specific mailbox empty states for All, Samples, On a journey, Received, Sent, and Drafts. Received points to handle setup; in-transit drops point to the relay composer. Empty-search feedback is announced accessibly, and clearing it preserves the selected filter.
- Mailbox search clear actions now return focus to the search input and preserve the selected filter. The native WebKit search cancel control is hidden so the accessible custom clear button is the only visible clear affordance.
- Invite outcomes (shared, copied, cancelled, unavailable) persist with the owning draft, including whether a manual invite link remains available after a cancelled retry. Older local invite reminders are migrated, async results are scoped to their account/draft/handle, and the mailbox card offers a matching next step.
- Send receipts now apply to the exact submitted composition. A different active draft is preserved, and edits made to the submitted draft in another tab are not marked sent.

## Verification

- Recipient collection slice `75f8a89`: `npm test` passed 145/145; lint, TypeScript, local Supabase smoke, script syntax, `bash -n run.sh`, and diff checks passed. `/` and `/mailbox` returned HTTP 200 on port 4004. A fresh production-build attempt is pending an environment with checkout write access and Google Fonts resolution; a previous isolated build passed.

- For commit 429e555, `npm test` passed 86/86, `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. `.env.local` remained ignored and was not staged.
- For commits bc21947 and 21f8120, `npm test` passed 93/93, `npm run lint`, `npx tsc --noEmit --incremental false`, and `npm run build -- --webpack` passed. The relay column-privilege SQL regression passed against a throwaway local PostgreSQL cluster in `/private/tmp`; the hosted Supabase project was not touched.
- Live inbox slice: `npm test` passed 101/101, `npm run lint`, `npx tsc --noEmit --incremental false`, `git diff --check`, and `npm run build -- --webpack` passed. Focused regressions cover a signaled drop during the first inbox response and a broadcast arriving during an in-flight read. The build emitted only the existing Browserslist freshness and ambiguous Tailwind easing warnings. Home and Mailbox each returned HTTP 200 on the local app at port 4004.
- Live sender reaction slice `9c375a1`: `npm test` passed 107/107, `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`, `git diff --check`, and `bash -n run.sh` passed. Five routes (`/`, `/mailbox`, `/letter/incoming-1`, `/compose`, `/journey`) returned HTTP 200 from the local app on port 4004. The feature commit is pushed to `origin/feat/live-reaction-feedback`; a separate documentation commit follows it on the same branch.
- Recipient-first composer `a9049cf`: `npm test` passed 107/107, lint, typecheck, Webpack production build, and `git diff --check` passed. Home, Compose, and Mailbox returned HTTP 200 on port 4004. Rendered viewport, keyboard, and safe-area checks remain open because browser automation is unavailable. The disposable PostgreSQL reaction-broadcast fixture also remains unverified; the isolated server failed with `shmget: Operation not permitted` in this sandbox. Build output included the existing Browserslist freshness and Tailwind easing warnings.
- Relay token URL slice `fd5a327`: `npm test` passed 109/109, lint, `npx tsc --noEmit --incremental false`, Webpack production build, and `git diff --cached --check` passed. `/relay/scan` returned HTTP 200 on the local app at port 4004. Browser interaction with a real fragment invite remains unverified because browser automation is unavailable. The build reported the existing Browserslist freshness and Tailwind easing warnings.
- Relay acceptance retry recovery a3a2ca9: focused tests pass 4/4, full npm test passes 113/113, lint, typecheck, Webpack production build, bash -n run.sh, and diff check pass. Home and relay routes return HTTP 200 on port 4004. The rendered lost-response refresh flow remains unverified.
- Mailbox filter empty states `10efead`: `npm test` passes 118/118, lint, typecheck, Webpack production build, `bash -n run.sh`, and `git diff --check` pass. `/`, `/mailbox`, `/profile`, and `/compose?new=1&mode=relay` return HTTP 200 on port 4004. Isolated Chrome verified filter/search behavior and no horizontal overflow at 360px, 390px, and 430px; screen-reader and real-device verification remain open.
- The SQL fixture `tests/db/drop_reaction_broadcast.sql` is written but was not run: Docker was unavailable and a temporary PostgreSQL startup failed in this environment. Hosted cross-account delivery and rendered browser/screen-reader checks remain unverified.
- The inbox unit tests mock Supabase Realtime; the new broadcast policy and trigger have not been applied to local or hosted Supabase. Account-to-account delivery is not verified.
- The live inbox feature is committed and pushed to its task branch; main/default branch was not changed.
- The local Supabase config was not loaded by a running stack and email-link sign-in was not verified; no local Supabase service was running.
- Playwright/Chrome at 390px checked QR handoff with location unchecked, opted in, and denied; manual PIN with location opted in; and a secure token invite with a manual neighborhood. The checks saw zero geocoder requests and no page runtime errors. Fixtures used synthetic data; this is not a hosted or cross-device handoff test.
- The prior production build completed. Next emitted non-fatal Browserslist freshness and ambiguous Tailwind class warnings.
- The mailbox empty-state update was rendered in isolated headless Chrome at 360px, 390px, and 430px with no horizontal overflow. The Received search-empty state retained an H2 with polite live announcement, clearing search retained the filter, and the transit action opened the relay composer. Real screen-reader and device checks remain open.
- Search-focus refinement `bbf9df8`: 118/118 unit tests, lint, TypeScript, and `git diff --check` passed. A Webpack production build passed in an isolated copy with Google Fonts responses mocked; live font downloads were unavailable because DNS could not resolve `fonts.googleapis.com`. The built CSS contains the native search-cancel suppression rule. Local `/` and `/mailbox` return HTTP 200. The interaction was previously verified in Chrome, but a fresh screenshot after the CSS fix remains pending because the isolated Chrome launch exited with code 134.
- Invite recovery `c1d57e0`: `npm test` passed 126/126; lint, `npx tsc --noEmit --incremental false`, `npm run build -- --webpack`, `bash -n run.sh`, and diff checks passed. The build reports only the existing Browserslist freshness and ambiguous Tailwind easing warnings. `/compose?new=1` returned HTTP 200 on port 4004. The local dev-server start required the approved loopback permission; it is left running. No rendered browser interaction, screen-reader, real-device, or hosted two-account send was verified.
- `./run.sh` serves the local clone at `http://localhost:4004`; the app is left running. `/relay/scan` returned HTTP 200 after the relay URL change.
- `.env.local` is present in the active checkout, mode 600, ignored by Git, and untracked. Its values were not displayed or staged.
- The earlier route-security work remains on `feat/relay-route-live-refresh`, is not merged, and has no pull request.

## Remaining work

- Apply the media-claim migration and configure the cleanup Edge Function plus Vault secrets on the approved Free project; verify photo/GIF claims, sender status, reissue, and actual Storage deletion across two disposable accounts.
- Add reconciliation for finalized orphan objects when both cleanup-queue attempts fail, then test the claim/issue/queue/lease ordering with concurrent database sessions.
- Verify media claim, reissue, and retry behavior in a rendered mobile/desktop browser with keyboard and screen-reader checks. Browser automation is unavailable in this environment.
- Verify recipient relay collection in a rendered browser at mobile and desktop widths, including keyboard and screen-reader behavior.
- Apply `20261023000000_relay_recipient_collection.sql` and `20261023010000_legacy_dispatched_relay_compatibility.sql` to the approved Free Drop Supabase project after it is provisioned, then verify two-account collection and sender journey updates.
- Re-run the production build in an environment that can write the active checkout's `.next` directory and resolve or mock Google Fonts.

- Legacy `?d=` QR links still put previous-carrier coordinates in the URL and send them to Drop when opened. Use a new server-issued invite for future handoffs; old payloads are not safely convertible.
- Verify a valid carrier-issued handoff across accounts/devices and against hosted Supabase. No hosted Drop project has been created.
- Verify refresh recovery after a server-accepted relay request loses its response, using a rendered browser and local Supabase when those tools are available.
- Apply `20261022100000_drop_inbox_broadcast.sql` to the Free Drop Supabase project and verify real recipient notifications between two disposable accounts.
- Apply `20261022110000_drop_reaction_broadcast.sql` after the inbox broadcast migration and verify real sender reaction cues between two disposable accounts.
- Apply `20261022000000_restrict_relay_handoff_column_select.sql` to the Free Drop Supabase project when that project is available; only the disposable local PostgreSQL regression has been run so far.
- Restart local Supabase after its runtime is available, then verify email-link return to port 4004.
- Verify Home/Mailbox arrival rendering at phone and desktop sizes, keyboard behavior, and screen-reader status announcements when browser automation is available; check real-device keyboard/safe-area behavior.
- Verify the recipient-first composer in a rendered browser at 360px, 390px, and 430px, including the account-ready and signed-out states, invite return, keyboard, and safe-area behavior.
- Verify invite sharing, cancel-and-reopen recovery, and concurrent send edits in a rendered browser and with a screen reader/real device; hosted two-account delivery remains open until the Free Drop Supabase project is available.
- Continue to keep /letter read-only and do all new Drop work in /Users/arjeetanand/projects/drop.

## Run locally

From /Users/arjeetanand/projects/drop, run npm ci, then ./run.sh. Drop uses http://localhost:4004; ./run.sh stop stops the project-owned process. The local Supabase smoke environment uses port 5004 and browser QA is reserved port 6004. Code commit `88f9b11` is pushed to `origin/feat/media-orphan-reconciliation`; this handoff and learning update are committed separately on that branch. The branch is not merged and has no pull request.
