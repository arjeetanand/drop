# Drop learning log

Append one dated entry for every completed code-change or issue-resolution slice. Keep the record evidence-based: issue, cause, resolution, a reusable learning, verification, Git checkpoint, and remaining gaps. Tie statements to the actual diff, commit history, and test output. Do not store credentials or private content here.

## 2026-10-24 — Strengthen saved-claim recovery browser assertions

### Issue

The browser smoke's compound wait could accept only its first text condition because `|| false` was interpolated without parentheses. The detail assertion also accepted visible “Share a fresh private link” text even if no enabled button was present.

### Cause

JavaScript evaluates `&&` before `||`, so an unparenthesized helper expression such as `text.includes(expected) || false` could bypass the remaining route and text checks. The detail check inspected body text but did not inspect the control's semantic element or disabled state. CSS text transforms also render some control labels in uppercase.

### Resolution

- Parenthesize the normalized text predicate so each combined wait checks all requested phrases and the expected route.
- Add a credential-free pending-claim fixture that verifies reload recovery, hides the lost in-memory copy action, checks the exact encoded detail link, and requires an enabled fresh-link button.
- Add `--claim-recovery-only` so this saved-state flow can run without the signed-in demo prerequisites. Keep the backend request gate enabled.

### Learning

Treat a rendered smoke assertion as a boolean expression whose full grouping is explicit. Normalize text for CSS transforms, and verify the actual element type and enabled state when a sentence is meant to be an action.

### Verification

- `npm test`: 245/245 passed. `npm run lint`, `./node_modules/.bin/tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed.
- An isolated Chrome context passed saved-claim recovery after reload at 360×844 by touch and 390×844, 430×844, and 1440×900 by keyboard. It verified the saved state, exact detail route, enabled fresh-link button, no horizontal overflow, no Auth/REST/Storage or cross-origin requests, and no console or JavaScript errors.
- The repository smoke runner's newly launched standalone Chrome timed out on DevTools `Page.navigate` in this host. The equivalent flow was run in a disposable browser context on the existing QA Chrome process. This did not simulate the native OS share sheet.

### Git and remaining gaps

Code commit `b064dab` (`test: verify saved claim recovery in browser`) is pushed to `origin/fix-private-claim-share-cancel-copy`; this entry and project notes are committed separately. The user-approved 30-day deletion policy for valid abandoned staging uploads remains unchanged. Real two-account photo/GIF delivery, actual Storage deletion, screen-reader output, and physical-device behavior remain open. `/letter`, `.env.local`, and hosted resources were not changed.

## 2026-10-24 — Give reaction controls natural-language names

### Issue

The five emoji-only reaction buttons used labels such as `React 🔥`. Assistive technology therefore had to infer the emoji’s meaning, which can vary by screen reader and voice.

### Cause

The UI already had readable reaction names for live announcements, but that mapping lived in a presentation component and the buttons supplied raw emoji instead.

### Resolution

- Extract the reaction-name mapping into a shared helper used by both the reaction buttons and live announcements.
- Label each button as “React with [reaction name]” and cover all supported reactions plus the unknown-reaction fallback in unit tests.
- Extend the isolated Chrome smoke to assert the five rendered accessible names before activating a reaction.

### Learning

Do not rely on emoji pronunciation for an icon-only control. Reuse a stable natural-language name in the control and any related announcement so the same reaction has one spoken meaning across the app.

### Verification

- `npm test`: 245/245 passed. `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed.
- Isolated Chrome passed GIF reaction flows at 360×844, 390×844, 430×844, and 1440×900, and a photo flow at 390×844. The smoke checked touch at 360px, keyboard activation at the other sizes, all five accessible names, saved reaction after reload, sender copy, no horizontal overflow, and no cross-origin/Auth/RPC/Storage-write requests.
- The smoke used a temporary source copy without `.env.local`. The main checkout returned HTTP 200 at `http://localhost:4004` and was left running.

### Git and remaining gaps

Code commits `7823b41` (`fix: give reaction controls spoken names`) and `783bc52` (`fix: make reaction labels read naturally`) are pushed to `origin/fix-private-claim-share-cancel-copy`; the learning entry and project notes are in a separate documentation commit on the same branch. No screen reader or physical device was tested. The real two-account photo/GIF claim journey and physical Storage deletion remain open. The rollback SQL fixture did not run because PostgreSQL 16.15 `initdb` failed to allocate SysV shared memory (`shmget`, “No space left on device”) despite mmap options; no SQL assertions ran.

## 2026-10-23 — Align the sender journey after relay collection

### Issue

After a recipient collected a relayed drop, the sender header showed “Drop collected,” but the route chain still labeled the recipient as “Next stop” and the custody timeline still said the recipient was waiting. The event also used the route-step creation time instead of the recorded collection time.

### Cause

Collection is persisted on the drop as delivered status and an activity timestamp. The route handoff still has its original `next` flag, and the sender journey's route and event projections were reading that flag without the drop's durable collection status.

### Resolution

- Derived a recipient-collection presentation from the loaded delivered journey drop and passed it to both the route chain and custody timeline.
- Used one pure presentation helper so the chain and timeline agree that the recipient stop is collected. The timeline uses the persisted collection activity time; the saved handoff state remains unchanged.
- Added a regression covering the waiting state, collected label and note, collection date, repeat-safe projection, and unchanged route state.

### Learning

- When a journey's underlying drop lifecycle advances, every related projection must reconcile against the durable lifecycle state; a route-step flag can remain stale by design.
- Keep UI projections pure and test both sides of the transition, including that rendering the new state does not rewrite the historical route.

### Verification

- `npm test`: 159/159 passed.
- `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check`: passed.
- `npm run build -- --webpack`: attempted in an isolated source copy; Next.js could not resolve `fonts.googleapis.com` (`ENOTFOUND`) for the existing Google Fonts in `app/layout.tsx`. No font or app configuration was changed.
- Browser QA at 390×844 received HTTP 200 for `/` and local Next layout assets, but the page remained at “Checking your account…”. No rendered interaction, screenshot, screen-reader, or device behavior was verified.

### Git and remaining gaps

Code commit `d9eeadb` (`fix: reflect relay collection in sender journey`) is pushed to `origin/feat/journey-collection-receipt`. This learning entry, checklist, README, plan, and handoff update are being committed separately. Authenticated browser, screen-reader, real-device, and hosted two-account checks remain open; retry the production build when Google Fonts are reachable.

## 2026-10-23 — Persist sender claim status

### Issue

After a private text drop was claimed, the sender saw the updated status only while the detail page remained open. Reopening the page returned to a generic “Sent” label, and the Mailbox card could not distinguish a claimed invite from an ordinary delivered note.

### Cause

The durable claim lived in the private `drop_claim_invites` table, while the client relied on the temporary Realtime transition. The sender had no durable, narrowly scoped status read.

### Resolution

- Added an authenticated sender-only RPC that returns claimed drop IDs without exposing invite tokens or recipient account IDs.
- Added the “Claimed by [name]” label in Sent and sender detail; ordinary delivered text notes continue to show “Delivered.”
- Bounded the optional status read to five seconds. A cold sender detail retries failed hydration after ten seconds, then every 60 seconds while visible; it updates the badge without replaying the live announcement.
- Moved SQL exclusion assertions until after ordinary, pending, and revoked fixture rows exist. This fixed a vacuous check that previously named rows before they had been inserted.
- Corrected a unit-test fixture that did not set the delivery mode and payload kind required for a valid claimed text drop.

### Learning

- Treat Realtime as a prompt to refresh state, not as the only record of a completed action. The durable claim record is the source of truth after reload.
- Expiry prevents a new claim with an old link; it does not erase a claim that already succeeded. Durable status should depend on the recorded claim, not whether the token is still usable.
- Keep optional status reads bounded so a secondary badge cannot hold the main mailbox or detail screen indefinitely, and retry only the unresolved read.
- Database tests must create and transition fixtures before checking exclusions; otherwise an assertion can pass without testing the intended state.

### Verification

- `npm test`: 158/158 passed.
- `npm run lint` and `npx tsc --noEmit --incremental false`: passed.
- `tests/db/drop_claim_invites.sql`: passed in a disposable local PostgreSQL cluster; it covers sender-only status, expiry durability, ordinary/pending/revoked exclusion, anonymous denial, and unrelated-account denial.
- `npm run build -- --webpack`: passed in a disposable source copy. Existing Browserslist freshness and Tailwind easing warnings remain.
- `/`, `/mailbox`, `/claim`, and `/letter/incoming-1?view=sender`: HTTP 200 on local port 4004.

### Git and remaining gap

Code commit `84e5ba2` and documentation commit `0b11a73` were pushed on `feat/persistent-claim-status`. The hosted migration, two-account behavior, rendered browser, and screen-reader flow are not verified yet.

## 2026-10-23 — Make development learnings persistent

### Issue

Useful causes, fixes, test evidence, and follow-up gaps were recorded across chat and handoff notes, but there was no single append-only place for the user to review what each completed change taught us.

### Resolution

- Created this journal and linked it from the README.
- Added a repository instruction to append a dated issue/cause/fix/verification/Git entry after each completed code or issue-resolution slice.
- Based the initial entries on the committed sender claim-status change and its actual test output. Future entries should be checked against the Git diff and commit log.

### Verification and Git

The Markdown changes pass `git diff --check`; no application tests were run because this change only adds documentation. This work is on branch `docs/drop-learning-log`, based on pushed commit `0b11a73`.

## 2026-10-23 — Keep relay collection terminal across sender views

### Issue

After the recipient collected a relay drop, some sender views could still describe it as in progress. The Journey chain and timeline showed collection, while the route map could keep the recipient as the next stop and the Relay passport could still offer another carrier invite. With zero carriers, Journey copy also said the collected drop was waiting for its first carrier.

### Cause

Each view derived progress from a different source. The route chain used the collection projection, the map followed immutable handoff flags, and the Relay passport only refreshed carrier handoffs. Treating a failed initial status read as “not collected” could also re-enable an invite.

### Resolution

- Centralized the sender collection projection and require all three facts: the row belongs to the sender, uses relay delivery, and has durable `delivered` status. The displayed collection time comes from the saved activity timestamp.
- Updated Journey and Relay to show the collected headline and status, complete the route map and recipient stop, and make the final custody event non-current. Hide carrier invite controls after collection and guard invite responses that race with a collection refresh.
- Refresh the Relay passport's sender status alongside the existing route refresh. Preserve a known collection across unavailable reads; if the first read is unavailable, keep the status unknown and do not enable the invite action.
- Added regressions for strict projection, saved collection time, failed-read preservation, and terminal timeline state.

### Learning

- A durable lifecycle transition should drive every view of the same entity; route history can remain unchanged while its progress presentation becomes terminal.
- “Could not read status” is not the same as “status is negative.” Keep state unknown and disable dependent actions until the server confirms the state.
- Browser fixtures need a valid sender-owned row to verify private sender screens; synthetic route access alone can only verify the unavailable state.

### Verification

- `npm test`: 161/161 passed.
- `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check`: passed.
- The guarded `./run.sh start` serves port 4004; `/`, `/journey?letter=drop-fixture`, and `/relay?letter=drop-fixture` returned HTTP 200.
- Isolated Chrome at 390×844 and 1440×900 did not hydrate the synthetic sender row. Journey rendered its unavailable state at both sizes; Relay at 390×844 remained in the waiting state with an invite. The collected-state rendering, browser console, desktop Relay, carrier mode, screen reader, and real device remain unverified.
- No local database rows or hosted resources changed. A production build was not run for this slice; the previous isolated build was blocked fetching the existing Google Fonts host.

### Git

Code commit `3ee659a` (`fix: complete relay collection views`) is pushed to `origin/fix/relay-collection-terminal-state`. This entry and the README, plan, checklist, and handoff update are committed separately on the same branch. No PR or merge was created.

## 2026-10-23 — Make reusable lessons explicit in every entry

### Issue

The repository already kept an append-only issue log, and the user asked that every solved issue also leave a useful learning they can return to, with the record saved alongside the Git work.

### Cause

The previous instruction listed the issue, cause, fix, and verification, but did not require a distinct reusable takeaway. That could leave future entries as changelog notes rather than lessons.

### Resolution

- Clarified that every entry must include a plain-language `Learning` section with a reusable takeaway.
- Required each entry to be checked against the actual diff, Git branch/commit history, and test output, and to preserve older entries.

### Learning

- A useful engineering record explains both what changed and the principle that should guide the next similar change.
- Git and test evidence keep the lesson accurate as the project evolves.

### Verification

- `git diff --check`: passed. This documentation-only update did not require application tests.

### Git and remaining gaps

This entry is on branch `feat/private-media-claims`, based on `9dd8ccc`. No application behavior changed.

## 2026-10-23 — Add private photo/GIF claim links and expiry cleanup

### Issue

The unknown-handle claim flow supported text only. Extending it to private photo/GIF drops also required a durable 30-day access cutoff, cleanup that does not race with a claim or resend, and a useful retry path when upload finalization or the claim RPC has an ambiguous result.

### Cause

The claim database transaction and Storage object operations are separate services. A successful file upload does not prove a drop row was created, a timed-out issue call may already have committed, and deleting Storage metadata rows directly would bypass the Storage API. The first local SQL run also exposed two worker details: a PL/pgSQL output named `media_path` made `ON CONFLICT (media_path)` ambiguous, and a cleanup job inserted a few microseconds after the worker's captured timestamp could miss the current lease batch.

### Resolution

- Added instant image/GIF claim links for unknown handles. The recipient signs in and explicitly claims before media is released; the sender's durable status includes claimed media after reload.
- Set claim links to at most 7 days and the immutable media claim/access cutoff to 30 days after first send. Reissuing a media link does not extend the cutoff.
- Added an hourly cleanup worker that revokes expired claims, queues deletion through the Supabase Storage API, and retries failures. Path advisory locks, tombstones, and revalidation protect same-path recovery and deletion.
- Kept the selected file available after an ambiguous send. The composer saves a new upload ID only after the server confirms cleanup is queued or already cleaning.
- Fixed the ambiguous SQL conflict target by naming the unique constraint. Set newly expired jobs' `available_at` to the same captured `v_now` used by the current worker batch.
- Documented the Free-project pause and worker/Storage delay caveat in the setup notes and user-facing copy.

### Learning

- Link expiry, access expiry, and physical object deletion are separate lifecycle events. State the access cutoff clearly, then make physical deletion a durable, retryable job through the provider API.
- When a worker compares queued work to one captured timestamp, insert the work using that same timestamp if it should run in the current batch; a fresh default clock value can be fractionally later and defer it to the next schedule.
- When a cross-service result is ambiguous, keep the user's source file and retry identity until the server confirms a safe next step. Do not infer that an object is unlinked from a failed read.

### Verification

- `npm test`: 171/171 passed. `npm run lint`, `npx tsc --noEmit --incremental false`, `git diff --check`, and `bash -n run.sh` passed.
- The rollback-only `tests/db/drop_claim_invites.sql` fixture passed against a disposable local PostgreSQL 16 cluster; it covers privacy, claim/reissue, media sender status, orphan queueing, same-path recovery, cleanup leasing, and retry behavior.
- `npm run build -- --webpack` passed with the existing Browserslist freshness and Tailwind easing warnings.
- `/`, `/compose`, `/claim`, `/mailbox`, and `/letter/drop-fixture?view=sender` returned HTTP 200 on local port 4004.
- Rendered browser/device interactions and hosted Supabase behavior were not verified. Browser automation is unavailable; no browser dependency was installed.

### Git and remaining gaps

Code commit `2d578ca` (`feat: add private photo and GIF claim drops`) is pushed to `origin/feat/private-media-claims`. The README/setup notes, plan, checklist, handoff, and this entry are in the separate documentation commit. `.env.local` remained ignored and unstaged; no hosted resources were changed.

If both attempts to enqueue a finalized orphan fail during an outage, that object can remain until the sender retries. The SQL fixture exercises lock behavior sequentially, not with concurrent sessions. Apply the migration and configure the Edge Function/Vault secrets on the approved Free project, then verify two-account claiming and actual Storage deletion before production.

## 2026-10-23 — Scope Realtime fixture reads to the subscribed topic

### Issue

The disposable reaction-broadcast fixture failed while checking that a sender could not read a reaction signal on a different topic.

### Cause

The fixture granted direct `SELECT` on its in-memory `realtime.messages` table and queried all rows after setting a mock channel topic. Supabase checks authorization for the requested channel topic, and channel broadcasts are delivered only to subscribers on that topic; the global fixture query incorrectly combined rows from separate channels.

### Resolution

- Filtered every simulated Realtime message read by the currently requested channel topic.
- Left the production inbox and reaction authorization policies unchanged.
- Confirmed the interpretation against the [Supabase Realtime Authorization docs](https://supabase.com/docs/guides/realtime/authorization).

### Learning

When a test fixture models a channel subscription with a table of recorded events, filter the returned events to the subscribed topic. A channel-join policy and a global SQL table scan answer different questions.

### Verification

- `tests/db/drop_reaction_broadcast.sql`: passed against a disposable PostgreSQL 16 cluster.
- `git diff --check`: passed before the code commit.

### Git and remaining gaps

Code commit `88f9b11` (`test: scope Realtime fixture reads by channel topic`) is pushed to `origin/feat/media-orphan-reconciliation`. Hosted Realtime delivery and the rendered two-account flow remain unverified.

## 2026-10-23 — Reconcile unlinked media after the retention window

### Issue

If both sender-side attempts to enqueue cleanup fail after a finalized photo/GIF upload, the Storage object can remain without a cleanup job. The hourly worker previously processed only rows already present in its queue, so this orphan had no automatic deletion path.

### Cause

The upload and cleanup queue are separate services. A Storage upload can succeed while the app's finalization/queue response fails, leaving no linked drop and no durable cleanup row. The worker cannot recover the object by polling the queue alone.

### Resolution

- Added a service-only cursor RPC that scans up to 25 old private-bucket objects per invocation and queues only validated finalized paths with supported image/GIF metadata, no linked letter, and no existing cleanup job.
- Set orphan retention to 30 days from the Storage object's creation time. The scanner uses the existing claim-then-media-path lock order and rechecks eligibility before queueing; deletion continues through the Supabase Storage API.
- Made orphan discovery best-effort in the Edge worker. An unavailable new scan no longer stops it from leasing and processing already-queued cleanup jobs; the worker reports the scan failure after processing.
- Updated the ordered migration and worker deployment instructions. Apply migration `20261023160000_reconcile_orphan_drop_media.sql` before deploying this worker version.

### Learning

- Cross-service cleanup needs reconciliation for the gap where one service commits work but the follow-up queue write fails.
- Keep optional discovery from blocking the established retry path. Report partial failure after processing durable work so the existing cleanup keeps making progress.
- A paged cursor must advance over skipped records and wrap after exhaustion; verify that an older record inserted behind the saved cursor is found after the wrap.

### Verification

- `npm test`: 175/175 passed. `npm run lint`, `npx tsc --noEmit --incremental false`, `git diff --check`, and `bash -n run.sh` passed.
- The rollback-only `tests/db/drop_claim_invites.sql` fixture passed against disposable local PostgreSQL 16. It checks service-role grants, invalid batch sizes, 25+1 pagination, cursor reset/wrap, backfilled old media, near-cutoff eligibility, linked/pending/malformed/recent/wrong-bucket exclusions, and duplicate prevention.
- Local route smoke checks returned HTTP 200 for `/`, `/compose`, and `/claim` on port 4004. This was an HTTP check, not a rendered browser test.

### Git and remaining gaps

Code commit `ae33ab2` (`feat: reconcile orphaned media cleanup`) is pushed to `origin/feat/media-orphan-reconciliation`. The handoff, checklist, plan, README/setup notes, and this entry are committed separately. No PR or merge was created. The existing local app remains available at `http://localhost:4004`.

No hosted migration, Edge Function runtime, two-account claim, or actual Storage removal was verified; Deno is unavailable and the hosted Free project is not provisioned. The migration adds a custom partial index on the managed `storage.objects` table. Validate compatibility and its query plan against the approved project before rollout; Supabase recommends treating the Storage schema as read-only and documents custom indexes for RLS policy performance ([Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design)). Concurrent database interleavings also remain untested.

## 2026-10-23 — Verify local account privacy and improve cobalt card contrast

### Issue

A UI review found small secondary text on Drop’s cobalt cards below the normal-text contrast target. The local account-to-account foundation also needed a real integration run beyond unit and SQL policy tests.

### Cause

The cards use `#2b45f7` with white text at 70% or 75% opacity. After compositing, these pairs measure 3.88:1 and 4.26:1, below 4.5:1. Source and unit checks alone did not prove the current local Supabase configuration would support separate signed-in accounts and private reads.

### Resolution

- Raised the low-opacity labels on Home, Sent, and Relay cards to `text-white/80`, which measures 4.63:1 against the cobalt surface.
- Ran the existing local Supabase smoke harness with four uniquely named disposable accounts. It checks sender/recipient access, outsider denial, reaction visibility, GIF finalization after a lost response, relay privacy/collection, and legacy relay normalization. The script's `finally` cleanup completed successfully.

### Learning

- Calculate contrast from the composited foreground color against the actual rendered surface; opacity percentages can miss the threshold even when the text looks bright.
- A local multi-account smoke run proves behavior against the current local migrations and services, not the hosted project or a rendered browser flow. Keep those acceptance states separate in the plan.

### Verification

- `npm run test:local-supabase`: six PASS checks; four disposable accounts and their test media were cleaned successfully.
- `npm test`: 175/175 passed. `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build -- --webpack`, and `git diff --check` passed.
- Contrast calculation against `#2b45f7`: white/70 = 3.88:1; white/75 = 4.26:1; white/80 = 4.63:1.
- `./run.sh start` served the app on port 4004; `/`, `/sent`, `/relay`, `/claim`, and `/compose` returned HTTP 200. No rendered browser/device or screen-reader check was available.

### Git and remaining gaps

Code commit `d842811` (`fix: improve contrast on Drop blue cards`) is pushed to `origin/fix/drop-card-contrast`. The checklist, product plan, README, handoff, and learning entry are included in a separate documentation commit on the same branch. `/letter` and hosted resources were not changed.

The local smoke covers known-recipient flows, not the unknown-handle photo/GIF claim journey. Hosted migrations, the cleanup schedule and actual Storage deletion, the managed Storage index/query plan, concurrent database interleavings, rendered browser/device behavior, and screen-reader acceptance remain open.

## 2026-10-23 — Confirm 30-day retention for unclaimed media

### Issue

The retention period for unclaimed private photo/GIF drops needed a product decision. The invite link and the stored media have separate lifetimes.

### Cause

The invite is a bearer capability that expires after at most 7 days. The media access cutoff and automated cleanup window are separate controls, and reissuing an invite must not extend the data-retention deadline.

### Resolution

- The user confirmed automatic deletion of unclaimed photo/GIF drops after 30 days.
- Existing code already implements this decision: the media invite RPC sets an immutable 30-day cutoff at initial issue, caps each claim link at 7 days, and routes expired media through the Storage cleanup worker. Reissue does not extend the original cutoff, so no feature code change was needed for this decision.

### Learning

Keep the capability lifetime shorter than the data-retention window, and enforce the data cutoff independently so a fresh link cannot extend retention. A paused free project or unavailable worker/Storage service can delay physical deletion; access must still be denied at the cutoff.

### Verification

- Source inspection confirmed the 30-day assignment and 7-day invite cap in `supabase/migrations/20261023150000_private_media_claim_invites.sql`.
- The rollback-only `tests/db/drop_claim_invites.sql` fixture contains assertions for the immutable cutoff, reissue behavior, expired access denial, and cleanup worker transitions. Project handoff notes record this fixture passing against disposable PostgreSQL; it was not rerun during this decision update.
- No live Storage deletion or hosted schedule was verified. Local Supabase and the app were not listening during this turn; no hosted resources were accessed.

### Git and remaining gaps

This is a product-decision and documentation update, not a feature-code change. It confirms the behavior from code commit `2d578ca` (`feat: add private photo and GIF claim drops`) and the cleanup follow-up `ae33ab2` (`feat: reconcile orphaned media cleanup`). The unknown-handle cross-account claim flow, real Storage deletion, hosted schedule, and rendered sign-in/claim journey remain open.

## 2026-10-23 — Preserve claim links through auth returns

### Issue

When a private claim link led to passwordless sign-in in another tab, the recipient could lose the invite on return. A stale tab return could override the current email link, Google OAuth omitted the claim destination, and a failed handoff lookup could reuse a different invite token already stored in that tab.

### Cause

The return destination depended on per-tab session storage, even though email and OAuth may finish in a new tab. The shared localStorage bearer record was reusable and not consumed when copied into the receiving tab, and the generic session token had no identity tying it to the requested handoff UUID.

### Resolution

- Put only a sanitized internal `next` path in email and Google auth callback URLs, and prefer that current callback value over stale tab storage.
- Copy the bearer into the receiving tab's session storage before removing the shared record. Bind the session token to the opaque handoff UUID; reject fallback when the requested handoff is missing, malformed, or mismatched.
- Schedule 10-minute shared-record cleanup while the source tab stays open and prune expired/corrupt records on claim-page load. Keep explicit claim as the final action and show recovery guidance for another browser/device.
- Keep claim profile and callback copy specific to the private-drop flow, and hide the unrelated send-your-handle-back step.

### Learning

Treat the auth callback URL as the source of truth for the current return destination; session storage belongs to a tab and may be stale. When a bearer moves through browser storage, bind it to the intended invite and consume the shared copy after the destination tab has safely saved it.

### Verification

- `npm test`: 184/184 passed, including return-path precedence, safe email/OAuth callback paths, handoff consumption, expiry, session-token/handoff matching, and mismatched-invite rejection.
- `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. Home, Claim, claim-aware Profile, and Auth callback returned HTTP 200 on port 4004.
- An earlier isolated production build attempt could not fetch the existing Google Font host (`fonts.googleapis.com`, `ENOTFOUND`); a production build was not rerun after this frontend-only fix. Rendered email/OAuth and actual multi-tab behavior remain unverified because browser automation is unavailable.

### Git and remaining gaps

Code commit `b7483df` (`fix: preserve private claim across auth returns`) is pushed to `origin/fix/claim-email-return`. This learning entry and the checklist, README, and handoff update are included in a separate documentation commit. If the source tab/browser closes before the 10-minute timer runs, an expired localStorage entry may remain until a later Drop claim page prunes it; expiry blocks retrieval meanwhile. Hosted auth, two-account claim, and cross-device behavior remain unverified. `/letter` and hosted resources were not changed.

## 2026-10-23 — Test cleanup endpoint authorization boundary

### Issue

The public-platform cleanup Edge Function owns a service-role client and can reconcile jobs, lease deletions, and remove private Storage objects, but the existing tests covered helper logic rather than its HTTP and authorization boundary.

### Cause

The handler read Deno environment variables and created the privileged Supabase client inside `Deno.serve`, which made its early rejection behavior difficult to exercise from the repository's Node test runner.

### Resolution

- Extract the request handler behind injected environment lookup and client creation while keeping `index.ts` as the thin Deno adapter.
- Test method/configuration/secret/content-length rejection and assert those paths create no client and make no RPC or Storage calls. Also test the authorized cleanup order and a retryable 503 when finishing a job fails.
- Preserve the existing secret checks, 25-job bound, cleanup RPC order, Storage path validation, and retry semantics.

### Learning

For a privileged serverless endpoint, inject configuration and the service client at the boundary. This lets local tests prove rejected requests never reach privileged operations without needing production credentials or a hosted project.

### Verification

- The endpoint test passed 12/12; `npm test` passed 196/196; lint, `npx tsc --noEmit --incremental false`, and `git diff --check` passed.
- Home and Claim returned HTTP 200 on local port 4004. An independent QA review found no required code changes.
- Deno/Supabase Edge bundling was not verified because the Deno CLI is unavailable. These fake-client tests do not prove hosted secrets/schedule configuration or real Storage deletion.

### Git and remaining gaps

Code commit `30e3190` (`test: cover private media cleanup endpoint boundary`) is pushed to `origin/fix/cleanup-endpoint-boundary`. The checklist, README, handoff, and this learning entry are committed separately on the same branch. Unknown-handle two-account claims, sender status, replay/reissue, hosted deployment, and actual 30-day Storage deletion remain open. `/letter` and hosted resources were not changed.

## 2026-10-23 — Keep temporary claim verification failures retryable

### Issue

A claim verification failure returned the same message as an expired or already-claimed invite. This could send a recipient looking for a fresh link during a temporary service outage.

### Cause

The client grouped every structured RPC error with empty successful results. The database also uses SQLSTATE `42501` for terminal or unavailable invite states, so treating every error as temporary would be misleading too.

### Resolution

- Classify SQLSTATE `42501` as a generic unavailable invite and keep successful empty/invalid results on that same privacy-preserving path.
- Show retry guidance for other RPC errors and thrown service/auth failures. Do not include the backend message or bearer token in the UI.
- Keep the invite token until a successful claim; the existing page clears the session and cross-tab handoff only on success.

### Learning

When a backend error can represent either a terminal business result or an infrastructure fault, classify only known terminal codes. Use generic copy to preserve privacy, and keep retryable capabilities available when the operation did not succeed.

### Verification

- Focused claim tests pass 8/8, including `42501`, transient and unknown errors, raw-error/token exclusion, empty results, and successful claim IDs.
- `npm test` passes 200/200; lint, no-incremental TypeScript, and `git diff --check` pass. Home and Claim return HTTP 200 on port 4004.
- Independent QA review identified the `42501` terminal case and approved the corrected classification. Rendered browser and screen-reader behavior were not checked.

### Git and remaining gaps

Code commit `e2e8db7` (`fix: keep claim service failures retryable`) is pushed to `origin/fix/claim-rpc-retry-copy`. The checklist, README, handoff, and this learning entry are committed separately on the same branch. Hosted two-account photo/GIF claim behavior, claim replay/reissue, and actual Storage deletion remain unverified. `/letter` and hosted resources were not changed.

## 2026-10-23 — Recover guest drafts safely after sign-in

### Issue

When sign-in returned to a guest draft, a failed or unverifiable transfer could leave the recovery link pointing at `/compose?letter=<guest-id>`. Compose can then fall back to a different account draft. A session change during an async media copy or retry could also leave the callback using a stale account ID.

### Cause

The callback trusted the requested URL ID after copy failure, and the general draft lookup can include seeded/default fallback data. The transfer spans async Storage work, while a mounted callback can outlive the account session that started it.

### Resolution

- Keep failed or missing draft transfers on the safe profile recovery route and add an explicit retry/check-again action.
- Add an account-scoped draft lookup that returns only saved account drafts. Resume Compose only after persisted readback, using the returned remapped ID after a collision.
- Recheck that the active Supabase session matches the intended account before and after async transfer/retry. On mismatch, preserve the recovery state.
- Keep the guest draft and attachment available through the existing copy/rollback path; never treat an unverified return URL as proof of an account copy.

### Learning

An authenticated redirect is a data boundary. Treat its path as a request, confirm the requested object exists in the current account's storage scope, and recheck identity after every asynchronous operation that can outlive a session change.

### Verification

- The focused guest-draft and store tests pass 26/26. `npm test` passes 206/206; `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build -- --webpack`, and `git diff --check` pass.
- Home and Auth callback returned HTTP 200 on local port 4004. Independent QA found and verified fixes for missing guest/account copies and account changes before and after retry.
- The build emitted a Browserslist freshness warning and an ambiguous Tailwind `ease-[cubic-bezier(...)]` warning. No rendered browser, keyboard, screen-reader, hosted, or real two-account media-transfer check was available; the transfer-failure regression uses a mocked attachment copy.

### Git and remaining gaps

Code commit `67095bc` (`fix: preserve safe guest draft auth recovery`) is pushed to `origin/fix/guest-draft-return-recovery`. The README, checklist, handoff, and this entry are recorded in a separate documentation commit on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Rendered retry behavior and real cross-account photo/GIF attachment transfer remain open.

## 2026-10-23 — Expire abandoned staged media after 30 days

### Issue

Photo/GIF uploads that were staged while composing but never linked to a sent drop could remain in private Storage indefinitely. The existing cleanup handled expired claims and finalized orphans, but did not scan abandoned `/pending/` upload paths.

### Cause

Staging and finalized media use different path shapes and cleanup states. A staging object can be left behind when a send or invite flow is abandoned, while deleting a queued path through Storage can race a retry that reuses the same key.

### Resolution

- Add a service-role-only scan for valid, unlinked pending objects whose Storage creation time is at least 30 days old; enqueue up to 25 per pass for removal through the Storage API.
- Keep failed removals retryable, reserve queued paths against same-key uploads while cleanup is pending, and retain a successful tombstone for at least 24 hours. Support both the legacy four-segment and current five-segment staging keys.
- Keep the finalized-media ID stable for a logical draft while each staging attempt uses a fresh ID. Backfill and verify that stable ID on restored legacy media drafts before issuing a private claim invite.
- Extend the SQL fixture to verify authenticated acceptance of five-segment staging paths along with scan and cleanup transitions.

### Learning

Treat the saved media ID as the identity of the final object and the staging suffix as one upload attempt. Retention should separately cover abandoned staging and finalized unlinked objects, and a cleanup worker must coordinate deletion with writes before a path can be reused.

### Verification

- `npm test` passed 217/217 for the retention commit and 218/218 after the restored-draft retry fix; lint, no-incremental TypeScript, and `git diff --check` passed.
- `tests/db/drop_claim_invites.sql` passed against isolated PostgreSQL 16, including the added authenticated five-segment insert case. The fixture rolled back; the temporary test server was stopped.
- The production build was attempted but could not resolve the existing Google Fonts host `fonts.googleapis.com`. No Deno Edge bundle, hosted Storage deletion, or browser interaction was verified.

### Git and remaining gaps

Code commits `d71c4e3`, `41247b6`, and `5bf4df3` are pushed to `origin/feat/claim-invite-journey`. This entry and the setup/checklist/handoff updates will be committed separately. The approved Free Supabase project is not configured yet. Apply migrations `20261023150000`, `20261023160000`, and `20261023170000` before deploying the worker; then verify actual two-account claims and Storage deletion, inspect the custom Storage index, and test concurrent database interleavings. `/letter` and hosted resources were not changed.

## 2026-10-23 — Persist media identity before private-claim retries

### Issue

A restored legacy draft could have a saved photo or GIF attachment but no `mediaUploadId`. The regular send path backfilled that ID, while the private claim-invite path did not; a retry after a cleanup failure could therefore finalize to a different object path.

### Cause

`mediaUploadId` is optional for older saved drafts. Hydration preserves the missing field, and the claim handler passed the draft to the backend without first persisting the stable finalized-media ID.

### Resolution

- Add an account-scoped helper that assigns a media ID only to the persisted active image/GIF draft, writes it, and verifies the saved copy.
- Call it before private claim invite issuance for a restored attachment. If the ID cannot be persisted and read back, keep the draft and stop before sharing the link.
- Add a regression test proving the ID persists and remains the same across retry preparation.

### Learning

Persist logical identity before retryable external work. A new request may use a fresh staging path, but it should keep the finalized object identity stable so retries can reconcile the same media.

### Verification

- The new regression failed before the helper existed and passed after implementation. `npm test` passed 218/218; lint, no-incremental TypeScript, and `git diff --check` passed.
- No browser or hosted two-account claim was run for this fix. The production build was not rerun after the change because the prior build attempt was blocked by Google Fonts DNS resolution.

### Git and remaining gaps

Code commit `41247b6` (`fix: persist media ID for legacy claim retries`) is pushed to `origin/feat/claim-invite-journey`; fixture coverage is in `5bf4df3`. This entry is committed separately with the Drop setup/checklist/handoff update. Hosted Supabase and actual cleanup remain unverified. `/letter` and hosted resources were not changed.

## 2026-10-23 — Preserve relay drafts when offering private claims

### Issue

A sender who picked Relay for an unknown handle could not reach the private claim-link flow, even when they wanted the recipient to claim the drop directly. Switching modes must not discard the text or a saved photo/GIF, and must not accidentally share it.

### Cause

Private claim links are intentionally limited to Instant mode. The composer only exposed the claim action when already in Instant, leaving relay drafts without a clear route to the supported flow.

### Resolution

- Offer an explicit Relay-to-Instant switch only for a connected account and a current, checked, not-found recipient lookup with a valid draft or fully saved attachment.
- Persist the current draft with Instant as its delivery mode, preserving its attachment and upload identity; then focus the existing private-link action.
- Keep sharing as a separate explicit action and guard the switch during invite sharing, sending, and deletion. Leave the instant-only claim authorization unchanged.
- Add regression coverage for eligible text/photo/GIF drafts and the blocked states.

### Learning

When a user needs to change a mode to reach a supported action, make the transition explicit, preserve the in-progress work, and move focus to the next available action. Keep irreversible or externally visible actions behind their existing confirmation step.

### Verification

- `npm test` passed 219/219; lint, no-incremental TypeScript, and `git diff --check` passed.
- The eligibility helper is covered, but the rendered composer, keyboard/screen-reader behavior, and browser viewport interaction were not tested. The production build and route HTTP response were not verified; the existing Google Fonts DNS failure remains, and the local port probe returned HTTP 000.
- No hosted or account-to-account private claim test ran because no hosted Supabase project is configured.

### Git and remaining gaps

Code commit `56dc3f2` (`feat: offer instant claims for relay drafts`) is pushed to `origin/feat/relay-claim-fallback`; this entry and checklist/plan/README/handoff updates are being committed separately on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Next, verify rendered interaction and the unknown-handle photo/GIF claim flow with two disposable accounts against local or approved Free Supabase.

## 2026-10-23 — Return recipients directly to their private claim

### Issue

After setting up a Drop handle for a private invite, recipients landed on an extra profile confirmation screen before returning to the claim. The claim page also placed a large hero and separate privacy/expiry cards before the primary action, which increased mobile scrolling.

### Cause

Profile setup exposed a manual continue link even after successful remote sync. The claim screen repeated its progress, privacy, expiry, and deletion information across tall stacked cards, rather than keeping the essential facts beside a compact progress cue.

### Resolution

- Return to the sanitized claim handoff only after the remote account profile sync succeeds. Device-only saves, conflicts, and sync failures remain on profile; the claim action is still a deliberate user click.
- Condense the claim header and privacy/expiry summary, preserve the 7-day link and 30-day unclaimed-media cutoff, and retain physical-deletion caveat details in a disclosure.
- Use a compact semantic progress indicator and focus the claim button when the verified account is ready or a failed claim can be retried.
- If both browser storage paths fail, keep the invite on the claim page and tell the recipient to enable storage or reopen the original link; never move the bearer token into a query parameter.
- Add regression coverage for safe claim-return routing after sync succeeds and for failure, unrelated routes, and unsafe paths.

### Learning

An authentication return and a sensitive action are separate states: return only after durable account setup succeeds, then keep the final claim explicit. When a required bearer token cannot survive navigation, block that navigation and explain recovery rather than silently discarding the in-memory invite.

### Verification

- `npm test`: 220/220 passed.
- `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check`: passed.
- `/`, `/claim`, claim-aware `/profile`, and `/auth/callback` returned HTTP 200 on local port 4004. These are route checks only; no authenticated rendered interaction was verified.
- A production build was not run for this slice. Prior project attempts could not resolve the existing Google Fonts host.

### Git and remaining gaps

Code commits `23240ea` (`fix: return to claim after profile sync`) and `9f188ee` (`feat: streamline private claim return flow`) are pushed to `origin/feat/claim-first-mobile-flow`. This learning entry, README, plan, checklist, and handoff are committed separately. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Rendered mobile/desktop focus and scroll, screen-reader behavior, storage-blocked interaction, OAuth/email sign-in, cross-tab transfer, and two-account claim remain unverified; browser automation is unavailable and local Supabase port 54321 is occupied by an SSH listener.

## 2026-10-24 — Cover unknown-handle text claims in the local Supabase smoke

### Issue

The authenticated smoke covered known-recipient sends, reactions, media finalization, and relay collection, but did not exercise a recipient who started without a Drop profile and then explicitly claimed an unknown-handle text invite.

### Cause

The smoke created four accounts and never called the claim issue, reissue, and claim RPCs across the profile-setup boundary. Existing unit coverage could not prove the complete account-to-account database path.

### Resolution

- Add a fifth disposable claimant account whose handle is absent when the sender creates the invite.
- Cover unreadable pending content, denial before profile setup, sender self-claim denial, profile creation, reissue invalidation, outsider denial, explicit claim, same-account retry, replay denial, participant-only reads, sender status restoration, and recipient reaction visibility.
- Require denied RPC calls to return SQLSTATE `42501` and no drop ID, so an unrelated failure cannot masquerade as an authorization pass.

### Learning

For a privacy-boundary smoke, assert the precise authorization result and the absence of returned data. Exercise the account's state transition too: a signed-in account without a product profile is not yet the intended recipient.

### Verification

- `npm test` passed 220/220; `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/local-supabase-smoke.mjs`, and `git diff --check` passed.
- The expanded authenticated Supabase smoke was not run. Port 54321 is owned by an SSH listener, so the configured local endpoint was not exercised. The rollback-only claim SQL fixture was also not run because disposable PostgreSQL startup failed at shared-memory allocation (`shmget`: no space left on device).
- No browser-rendered, hosted two-account, photo/GIF claim, or actual Storage deletion check ran. The approved retention policy for valid abandoned staging uploads remains 30 days; no cleanup resource was changed in this slice.

### Git and remaining gaps

Code commit `e5b7b43` (`test: cover unknown-handle text claim smoke`) is pushed to `origin/test/unknown-handle-claim-smoke`. The README, Supabase setup guide, plan, checklist, handoff, and this learning entry are committed separately on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Next: run the smoke and SQL fixture against a confirmed disposable local stack, then verify rendered claims and photo/GIF access plus scheduled Storage deletion with the approved Free project.

## 2026-10-24 — Prevent duplicate PKCE callback exchanges

### Issue

React effect replay could exchange the same one-time Supabase PKCE code twice. A stale effect could also route to an error/profile page after a newer callback run had taken over.

### Cause

The callback effect started the code exchange independently on every setup. Its active flag guarded some state updates but did not guard error or success navigation, and Supabase consumes the PKCE verifier during exchange.

### Resolution

- Keep the in-flight exchange in a component ref keyed by the one-time code so an effect replay reuses the same promise.
- Mark each effect run active/disposed and allow only active runs to consume the exchange result, update callback state, or navigate.
- Add regression tests for same-code reuse, a new code, disposed callbacks, and a replay where only the active run reaches the private claim route.

### Learning

For one-time asynchronous operations, deduplicate the operation itself and gate every result side effect by the lifecycle that initiated it. A stale caller may share the result, but it must not own later UI or navigation changes.

### Verification

- `npm test` passed 224/224. `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. Independent frontend review found no concrete findings.
- `npm run build` stopped with `EPERM` opening `.next/trace` in the active checkout. Browser-rendered sign-in, hosted OAuth, and two-account claim behavior were not verified.

### Git and remaining gaps

Code commit `7afdf3b` (`fix: guard auth callback effect replay`) is pushed to `origin/fix/auth-callback-effect-replay`. This learning entry, README, plan, checklist, and handoff are in a separate documentation commit. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Next: verify sign-in callback rendering and account-to-account private claims when isolated browser and Supabase runtimes are available.

## 2026-10-24 — Make private-claim receipts accurate

### Issue

The private claim flow sent both native share-sheet completion and clipboard copy to the same receipt. The page said the link was sent and showed “Waiting to be claimed” without checking durable sender state. A stale explicit drop ID could also fall back to the current local draft.

### Cause

The receipt treated a client-side sharing action as delivery evidence and used the URL's `claim=1` flag as claim status. Its status state was not keyed to the drop or signed-in account, so a claimed badge could carry over after route or account changes.

### Resolution

- Use a typed receipt-path builder to preserve `shared` and `copied` outcomes; older, missing, invalid, or duplicate outcome flags receive neutral copy. Keep the bearer token and message content out of the receipt URL, and avoid claiming the recipient received or opened the link.
- Read “Waiting” from an owner-filtered pending drop row and “Claimed” only from the sender-scoped claimed-ID RPC. Refresh on focus, visibility, and auth changes; discard stale reads, key state by drop and account, and announce updates to assistive technology.
- Honor an explicit receipt ID even when its local draft is missing. Do not display a different active draft as a substitute.
- The user confirmed automatic deletion of valid abandoned staging uploads after 30 days. The existing policy already matches; this slice did not change cleanup code or hosted resources.

### Learning

Keep the outcome of a client action separate from durable server state. Scope asynchronous UI state by both the object and the account, and treat unknown results as unknown rather than success or delivery.

### Verification

- `npm test` passed 237/237; `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. The focused receipt suite passed 13/13.
- Home and `/sent?letter=missing&claim=1&share=copied` returned HTTP 200 on local port 4004. No rendered browser interaction was available.
- `npm run build -- --webpack` stopped with `EPERM` opening `/Users/arjeetanand/projects/drop/.next/trace`. No hosted two-account claim or actual Storage deletion was verified.

### Git and remaining gaps

Code commit `ac0396f` (`fix: clarify private claim receipts`) is pushed to `origin/fix/private-claim-receipt-outcome`. This learning entry, README, plan, checklist, and handoff are in a separate documentation commit. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Next: verify rendered share/copy and status behavior with browser tooling, then validate unknown-handle photo/GIF claims and 30-day cleanup in an isolated local or approved Free Supabase runtime.

## 2026-10-24 — Cover unknown-handle photo and GIF claims

### Issue

The local smoke covered unknown-handle text claims and finalized media for a known recipient, but did not verify that an unknown-handle photo or GIF stays private through profile setup until an explicit claim.

### Cause

The two paths were tested separately: the text smoke exercised account eligibility and invite claiming, while the media smoke exercised upload/finalization and participant Storage access. Neither crossed the unknown-handle/profile/claim boundary for both media types.

### Resolution

- Add PNG and GIF invites to the five-account local smoke using authenticated staging upload and the existing media-finalize route.
- Verify that row reads, downloads, signed URLs, and claim attempts remain denied before profile setup; repeat the row/media denial after profile setup and before explicit claim.
- Claim each invite, verify retry safety, sender/claimant access, outsider denial, and durable sender status. Extend the rollback-only SQL fixture for both payload types and the same profile boundary.
- Keep the user-approved 30-day deadline and cleanup-worker gate unchanged.

### Learning

Profile creation makes an account eligible to claim; it must not itself unlock a private drop. Test the state after profile setup and before the explicit claim, as well as the states before profile setup and after claim.

### Verification

- `npm test` passed 237/237; `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/local-supabase-smoke.mjs`, and `git diff --check` passed.
- The local Auth/Storage smoke was not run because loopback port 54321 is owned by an SSH listener and port 54322 has no PostgreSQL service.
- The rollback-only SQL fixture was not run. Disposable PostgreSQL 16.15 failed to allocate System V shared memory at `shmget`; this is an environment allocation failure, not evidence of a fixture failure.
- Home returned HTTP 200 on port 4004. No browser-rendered claim flow, hosted account-to-account test, or actual Storage deletion was verified.

### Git and remaining gaps

Code commit `adc648b` (`test: cover unknown-handle photo and GIF claims`) is pushed to `origin/test/unknown-handle-media-claim-smoke`. Documentation, checklist, handoff, README, plan, and this learning entry are committed separately on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Next: rerun both Supabase checks on an isolated project with the required cleanup schedule and Vault values, then complete browser and actual 30-day cleanup verification.

## 2026-10-24 — Add a discoverable on-device photo/GIF demo

### Issue

The richer recipient/reaction/sender-copy demo was behind the composer preview, so a first-time visitor had to start composing and enter a handle even though the sample never sends. Account switching during the sample load also needed to remain isolated from attachment storage.

### Cause

The demo entry was not available from Home. The attachment helper captured whichever account was active when it was called, while the demo flow had already captured its intended account before awaiting the bundled media fetch.

### Resolution

- Add a direct Home link and a chooser for bundled photo and GIF samples. Reuse recipient reveal, local reaction, and sender-copy behavior, with clear on-device/no-send copy.
- Save a separate local demo record without replacing the active draft. Pass the account captured before the fetch through the media write and demo creation; reject stale writes and remove any partial attachment only from that captured account.
- Add regression coverage for active-draft preservation, account isolation, a switch during sample fetch, and switches during the IndexedDB write. Add an isolated Chrome smoke for keyboard navigation, responsive overflow, GIF reveal/reaction/reload/sender copy, and prohibited backend writes.

### Learning

For an account-scoped async file flow, capture the account before the first `await` and pass it through every storage write, final record creation, and rollback. Browser checks should compare rendered text without assuming CSS letter casing and wait for real scrolling behavior before judging whether a control is reachable.

### Verification

- `npm test` passed 241/241; `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build -- --webpack`, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed.
- Isolated Chrome completed Home keyboard navigation, GIF recipient reveal/open, reaction, reload persistence, and sender copy at 390×844. Home and chooser had no horizontal overflow at 360, 390, and 430px. The request gate observed no Auth, RPC, or Storage-write requests and no cross-origin requests.
- The build emitted the existing Browserslist freshness and ambiguous Tailwind easing warnings.

### Git and remaining gaps

Code commits `8c44f1c` (`feat: add local photo and GIF demo`) and `74db67a` (`test: cover account-scoped demo rollback`) are pushed to `origin/feat/home-demo-drop`; project notes are committed separately on the same branch. The approved 30-day deletion for valid abandoned staging uploads is already in the existing migration; no retention code changed. Hosted account-to-account sends, actual Storage cleanup, screen-reader behavior, and physical-device keyboard/safe-area checks remain open. `/letter` and `.env.local` were not changed or staged; no PR or merge was created.

## 2026-10-24 — Expand rendered demo viewport verification

### Issue

The browser smoke checked Home and the chooser at three phone widths but ran the complete GIF journey only at 390px. It did not cover the bundled photo flow or a desktop path. Its exact button-label and viewport-width checks also failed against CSS text casing and a desktop scrollbar.

### Cause

The smoke encoded a single end-to-end viewport, exact visible labels, and `documentElement.clientWidth` as the requested browser width. A separate Chrome touch-emulation command timed out at 430px; that does not prove an app touch failure.

### Resolution

- Extend the isolated Chrome smoke to complete GIF flows at 360×844, 390×844, 430×844, and 1440×900, plus the bundled photo flow at 390×844. Verify focus-visible semantics and keyboard activation along the 390, 430, and desktop flows; use touch at 360px.
- Match current chooser labels by their visible text, compare rendered Photo/GIF labels without assuming CSS casing, and compare requested viewport size with `window.innerWidth` while checking overflow against the layout width.
- Allow optional screenshots under a new folder outside the repository. Record that the user confirmed valid abandoned staging uploads should be deleted after 30 days; the existing cleanup migration already implements the cutoff, so no retention code or hosted resource changed.

### Learning

Rendered browser checks should use the browser viewport for breakpoint assertions and the document layout width for overflow checks. Text transforms can change rendered casing, and native button activation should be exercised with a real keyboard key. If CDP touch input times out at one viewport, use another verified input path there and record the specific gap instead of calling the app broken.

### Verification

- `npm test` passed 241/241; `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed. `npm run typecheck` hit a sandbox EPERM while writing ignored `tsconfig.tsbuildinfo`; the no-incremental TypeScript check passed. A production build was not rerun because this slice changed only the browser test script; the previous demo checkpoint build passed.
- Isolated Chrome passed GIF reveal/open/reaction/reload/sender-copy at 360×844 by touch and 390×844, 430×844, and 1440×900 by keyboard. The photo flow passed at 390×844 by keyboard. Home and chooser had no horizontal overflow at all four widths; the page-scoped gate observed no cross-origin, Auth, RPC, or Storage-write requests. Chrome touch input at 430px timed out, so that width uses keyboard in the smoke.
- Optional screenshots were captured outside the repository. This local same-device demo does not prove hosted account-to-account delivery, real Storage deletion, screen-reader behavior, or physical-device input.

### Git and remaining gaps

Code commit `81a5646` (`test: expand demo browser viewport coverage`) is pushed to `origin/test/demo-accessible-viewports`. The README, plan, checklist, handoff, and this learning entry are committed separately on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Next: validate the real two-account photo/GIF claim flow and physical Storage cleanup only against the approved Free project, then complete screen-reader and device checks.

## 2026-10-24 — Recover a saved private claim after share cancellation

### Issue

The composer issues and saves a private claim drop before opening the native share sheet. When the sender cancels, the link remains available to copy, but the screen said “Private drop sent” and “Waiting for them to claim.” After reload, the in-memory link is gone and the recovery copy pointed to `/sent` without the per-drop claim parameters or a path to the detail-page fresh-link control.

### Cause

The UI conflated a persisted claim-pending record with a successful share outcome. Those are separate facts: the database row exists before sharing, while the share/copy outcome may not be durable after reload.

### Resolution

- While the link is still in memory, label it “not shared yet” and retain the direct copy action. After recovery, use neutral saved-drop copy and open the specific encoded `/letter/[id]` detail route for status and fresh-link controls.
- Add tests for both copy states and single-segment URL encoding. The independent reviewer found no concrete regression.
- The user reconfirmed that valid abandoned staging uploads should be deleted after 30 days; the existing cleanup policy matches, so this slice changes no retention code or hosted resource.

### Learning

A successful database write does not mean an operating-system share sheet completed. Keep the immediate retry state explicit, but after reload show only durable facts and route the user to the exact saved entity so recovery actions remain reachable.

### Verification

- `npm test` passed 243/243; `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed.
- Independent review confirmed the detail route accepts the saved claim drop ID and exposes the sender fresh-link controls.
- The isolated Chrome smoke did not complete its Home flow: its page-level origin gate blocked the configured Supabase auth request, and the rendered page stayed at “Checking your account…”. This gate did not cover server-side activity. Share-cancel/detail rendering remains unverified.

### Git and remaining gaps

Code commit `53cbb82` (`fix: make private claim recovery truthful`) is pushed to `origin/fix-private-claim-share-cancel-copy`. The README, plan, checklist, handoff, and this learning entry are recorded in a separate documentation commit on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. Next: render the recovery route with isolated local/approved Free Supabase auth, then validate the two-account photo/GIF flow and actual 30-day Storage cleanup.

## 2026-10-24 — Share a drop without knowing a handle

### Issue

Senders had to check a Drop handle before the composer would offer a private claim link. That blocked sharing with a new friend whose handle was not known yet. The sender-side detail page could also imply that a pending link had already been shared, and switching to a handleless route could make an already-saved blank draft appear unsaved.

### Cause

The invite UI eligibility was tied to a checked “not found” handle even though the backend claim path can create a `claim_pending` drop with no recipient account. Local send completion rejected a blank recipient, and Sent projections had no generic label. Detail copy treated a saved claim record as proof that the share sheet completed. The route selection also changed only view state, so it should not dirty an unchanged draft.

### Resolution

- Add an explicit **Share without a handle** route for Instant claims. Show that anyone holding the bearer link can claim, preserve the connected-account and saved-payload gates, and let the sender return to handle entry.
- Allow only this explicit route to persist a recipientless `claim_pending` receipt. Keep normal delivered sends gated on a confirmed recipient and render a generic recipient label in local and remote Sent projections.
- Use neutral detail-page wording for claim-pending drops. Restore focus when switching recipient routes, reset route state when loading another draft, and keep an already-saved blank draft marked saved.
- Add eligibility, persistence, and copy checks plus isolated Chrome assertions for account readiness, link disclosure, focus, saved state, and recovery. Use keyboard activation for this route across viewports after CDP touch dispatch intermittently timed out; the 360px GIF journey still exercises touch.

### Learning

Model the saved claim record and the share-sheet outcome as separate states: `claim_pending` proves a claim exists, while only the share/copy result proves how the sender received or shared its link. A UI-only route choice should not flip a saved indicator unless the persisted draft changed. Persistence tests should use the complete address shape that draft hydration writes, rather than a sparse fixture that normalizes differently.

### Verification

- `npm test` passed 247/247; `npm run lint`, `./node_modules/.bin/tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed.
- The full isolated Chrome smoke passed GIF at 360×844 by touch and 390×844, 430×844, and 1440×900 by keyboard; photo at 390×844; and the handleless and saved-claim recovery flows at all four viewports by keyboard. There was no horizontal overflow, cross-origin request, Auth/RPC/Storage write, browser console error, or JavaScript exception. The handleless disclosure and saved indicator were also verified after the final state fix.
- A production build was not rerun for this slice. Prior attempts were blocked by write permission on `.next/trace` in the checkout and DNS resolution of the existing Google Fonts host in a scratch build. No hosted account-to-account send or actual Storage deletion was verified.

### Git and remaining gaps

Code commit `a6f8de7` (`feat: add handleless private claim route`) is pushed to `origin/fix-private-claim-share-cancel-copy`. The README, plan, checklist, handoff, and learning entry are committed separately on the same branch. No PR or merge was created. The user's 30-day abandoned-staging deletion choice matches the existing migration; this slice changed no retention code. `/letter`, `.env.local`, and hosted resources were not changed. Next: verify two-account claims and actual Storage cleanup against the approved Free project, then complete screen-reader and physical-device checks.


## 2026-10-24 — Supabase project provisioning blocked by token permissions

### Issue

The user approved one distinct Free Supabase organization and one Free Drop project, with no paid add-ons, for hosted account-to-account and Storage verification. The supplied token created an organization but could not read its plan or create the project.

### Cause

The Management API returned 403 for organization details and project creation. The read-only CLI organization list was empty, while project listing succeeded and showed only the existing `arjeetanand's Project`. Supabase documents `organization_admin_read` for organization detail reads and `organization_projects_create` for project creation. The available evidence points to missing fine-grained permissions, but the 403 does not rule out another account or billing restriction.

### Resolution

- Created the distinct organization `Drop App Free` (ref `sofucwhjqdyfensxlltl`) through the Supabase CLI. The create response did not expose its plan, and the plan check was denied; Free status is still unverified.
- Attempted exactly one `Drop` project in `ap-south-1`, without a compute-size override or paid add-on. The API returned 403; the follow-up project list confirmed no Drop project was created.
- Left `.env.local` and the existing project untouched, removed the generated database password for the rejected request, and documented the required scoped token permissions and dashboard fallback.

### Learning

A successful organization-create response is not proof that the token can inspect or provision projects in that organization, and it does not verify the billing plan. Check read and create permissions before configuring an app or applying migrations; treat a 403 as unresolved until the account and token scopes are confirmed.

### Verification

- Supabase CLI organization creation returned the new organization reference. The organization-details request returned HTTP 403.
- Project creation returned `ProjectsCreateUnexpectedStatusError` with `Forbidden`. The read-only project list contained the existing project only; no Drop project appeared.
- `.env.local` remained unchanged and ignored; the temporary database-password file was removed. No migrations, Edge Functions, Vault values, or project API keys were changed.

### Git and remaining gaps

This is a hosted-setup and documentation checkpoint; no application code changed. The 30-day cleanup policy remains unchanged. A new scoped PAT or a manually created, verified Free project is needed before applying migrations, configuring cleanup, testing two-account claims, and verifying actual Storage deletion. Screen-reader, physical-device, and production-build checks remain open.

### Follow-up verification — 2026-10-24

- `npm run build -- --webpack` passed, including TypeScript and static page generation. The only warnings were outdated Browserslist data and the existing ambiguous Tailwind easing class.
- `./run.sh` restarted Drop on its owned port 4004; the listener was in the local checkout and the Home route returned HTTP 200.
- This resolves the production-build and local startup checks listed in the preceding handoff. Hosted project provisioning, two-account/Storage checks, screen-reader use, and physical-device checks remain open.

## 2026-10-24 — Start a fresh drop from a Home writing prompt

### Issue

The Home writing spark showed a prompt, but choosing **Use this thought** navigated to an empty composer. Reusing the current blank draft could also make the new writing activity collide with an unfinished media draft.

### Cause

The Home action did not seed a new draft before navigation. The store intentionally reuses a blank active draft during React development remounts, so the prompt path needed an explicit fresh-draft option and a stable route identifier.

### Resolution

- Create a separate draft ID, seed its editable content with the currently displayed prompt, and navigate with that ID; keep prompt text out of the URL.
- Preserve the previous draft and its attachment under the original ID, with a store regression test for recovery.
- Add a focused browser-smoke mode and document the feature and invocation in README, plan, checklist, and handoff.
- The user reports being signed in to Supabase. This task has no authenticated dashboard control, so no project or billing change was made. Keep the approved Free project and plan verification as a separate pending item.

### Learning

When an action starts a new writing flow from existing context, persist that context into a new entity before routing. Carry an opaque stable ID in navigation and keep the source text in the editable draft; this preserves both the user's work and the app's privacy boundary.

### Verification

- `npm test` passed 248/248; `npm run lint`, `./node_modules/.bin/tsc --noEmit --incremental false`, and `node --check scripts/browser-demo-smoke.mjs` passed.
- Isolated Chrome passed the prompt-to-editable-draft flow at 360×844, 390×844, 430×844, and 1440×900. It verified the prompt is absent from the route, the prior photo draft and attachment remain recoverable, and no cross-origin request was made.
- Chrome could not publish its DevTools port in the default sandbox run. The authorized local run started Chrome and completed the full viewport matrix.
- The production build passed after the code change in the preceding verification. The user-approved 30-day cutoff remains encoded in the existing cleanup migration; this slice changed no retention logic, and hosted deletion is not verified.

### Git and remaining gaps

Code commit `2a29ffa` (`fix: seed home thought into fresh drop draft`) is pushed to `origin/fix-private-claim-share-cancel-copy`; the accompanying plan, README, checklist, handoff, and learning update are committed separately on the same branch. No PR or merge was created. `/letter`, `.env.local`, and hosted Supabase resources were not changed. The user reports an active Supabase login, but no dashboard control is available in this task; the approved Free plan/project, hosted two-account sends, and physical Storage cleanup remain unverified. Screen-reader and physical-device checks also remain open.

## 2026-10-24 — Correct relay carrier stats and mobile layout

### Issue

The seeded relay stat counted the sender as a carrier, and the Relay page called the count “People” while Journey called it “Carriers.” The small-screen buttons also read more clearly as a vertical action group.

### Cause

The count excluded only recipient handoffs, so sender handoffs were included. The initial phone screenshot was a 390-pixel image rendered from a 492-pixel CSS viewport because Chrome applied macOS scaling; its apparent clipping was not evidence of app overflow.

### Resolution

- Count only handoffs with the `carrier` role and use the same “Carriers” label on Relay and Journey.
- Stack Relay view controls on narrow screens, wrap the passport identifier, and constrain the headline for a readable mobile line break.
- Check the actual CSS viewport and document width before diagnosing overflow from a screenshot’s pixel dimensions.

### Learning

Use the domain role as the source of truth for a product metric, and keep the label specific enough to explain what is counted. For responsive QA, compare CSS viewport and document widths; a raster image’s dimensions alone can hide device-scale conversion.

### Verification

- Relay regression checks passed for the seeded route (2 carriers), a sender-only route (0), and a route with one carrier (1). `npm test` passed 249/249; `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`, and `git diff --check` passed.
- A disposable Chrome route check measured matching document/client widths at 390 CSS pixels and 1432 CSS pixels on desktop; no elements extended beyond those viewports. The mobile and desktop captures showed the consistent “Carriers” metric. The repo browser smoke still timed out on its initial `Page.navigate`, so this turn did not verify the complete demo journey.

### Git and remaining gaps

Code commit `4f8d512` (`fix: correct relay carrier count and mobile layout`) is pushed to `origin/fix/relay-carrier-count`. No PR or merge was created. The `Drop App Free` organization and project were not changed; the read-only Supabase CLI call reported that no CLI access token is available, and `.env.local` was not changed or displayed. Hosted account-to-account sends, the actual 30-day Storage deletion, screen-reader use, and physical-device behavior remain unverified. Next: finish the sender-copy to fresh-draft product slice, then resume hosted setup once CLI or dashboard access is available.

## 2026-10-24 — Start a fresh drop from the demo

### Issue

Finishing the local demo showed the sender copy and reaction, but did not offer a direct next step into composing a real drop.

### Cause

The demo correctly stays on-device and does not send its sample. Its sender view only linked back to the recipient demo, leaving people to find the separate compose action themselves.

### Resolution

- Add **Make one for a friend** to the local demo sender-copy view. Keep the same-device “nothing was sent or shared” notice and explain that the sample message, reaction, and media stay in the demo.
- Start a forced-new blank text draft and route by its ID. Preserve the prior active draft, including its IndexedDB photo attachment; keep the demo record in local history. Existing sign-in and recipient gates still control sending.
- Add a focused keyboard browser mode that checks the sender-copy CTA, blank editable composer, top-of-page landing, old draft/blob recovery, and no cross-origin requests.

### Learning

When a safe product demo is meant to lead into real use, put the next action where the demo ends. Create a separate editable object and keep sample content, identity, and reactions out of it; preserve in-progress work before changing routes.

### Verification

- `npm test` passed 249/249; `npm run lint`, `npx tsc --noEmit --incremental false`, `node --check scripts/browser-demo-smoke.mjs`, `git diff --check`, and `npm run build` passed. The production build only warned about outdated Browserslist data.
- Isolated Chrome passed `--friend-draft-only` at 390×844. It verified the same-device unsent notice, a new route ID matching an empty editable text draft, no copied demo identity/reaction/media, scroll position at the top, and preservation of the original image draft and actual IndexedDB blob. The passing run observed no cross-origin requests, console errors, or JavaScript exceptions. Screenshots were saved outside the repo at `/private/tmp/drop-browser-fresh-qa-20261024d/`.
- A run against the configured `.env.local` stayed at “Checking your account…” because the isolated browser blocks cross-origin auth. One no-env startup also timed out at that placeholder; a fresh no-env retry passed. Hosted sending, screen readers, and physical-device behavior were not tested.

### Git and remaining gaps

Code commit `df710fd` (`feat: start a fresh drop from the demo`) is pushed to `origin/feat/demo-to-first-drop`; the project notes are committed separately on the same branch. No PR or merge was created. `/letter` and `.env.local` were not changed. The user reports being signed in to Supabase, but this task has no authenticated dashboard control. The read-only CLI attempt stopped before a Supabase API request because the sandbox blocked its telemetry-file write under `~/.supabase`; no project or billing change was made. Verify the approved Free project before hosted migrations, two-account delivery, or physical 30-day Storage cleanup. First-use usability, screen-reader, and physical-device checks also remain open.

## 2026-10-24 — Fix local cleanup migration and sender claim recovery

### Issue

The orphan-media migration could not apply to the local Supabase database. The SQL regression fixture also stopped on stale expectations, and opening a claimed photo/GIF detail page did not restore the sender's durable claim status.

### Cause

The migration attempted to create an index on Supabase-managed `storage.objects`, whose ownership and schema restrictions reject that change. The fixture had not accounted for an additional previously claimed text drop and still expected the recipient account instead of the unprofiled account that claimed the media. The detail loader duplicated an eligibility check that only allowed text drops.

### Resolution

- Removed the custom index from `20261023160000_reconcile_orphan_drop_media.sql` and documented the resulting large-bucket scan/sort risk. The cleanup still uses ordered cursor pages and deletes through the Storage API.
- Changed sender detail hydration to use the shared eligibility helper, aligning text/photo/GIF detail pages with mailbox status hydration.
- Corrected the fixture to count the already-claimed expired text invite and to expect the actual unprofiled media claimant.
- Applied the finalized orphan and staging-retention migrations to the existing local Supabase database. No hosted project or resources changed.

### Learning

Treat managed Supabase schemas as platform-owned. When a migration fails, verify ownership and use the supported app schema or API instead of escalating ownership. When a regression assertion fails, check test setup and event order before changing a secure RPC; the stored media-claim RPC already returned all supported kinds.

### Verification

- `npm test` passed 249/249; lint, no-incremental TypeScript, and `git diff --check` passed.
- Local `supabase migration up --local` applied `20261023160000` and `20261023170000`; the ledger recorded both, and a read-only query confirmed no index was created on `storage.objects`.
- The rollback-only claim/media SQL fixture passed in a fresh disposable database inside the local Supabase Postgres container, then that database was dropped. Its role declarations were omitted from the temporary input because the container already provides those cluster roles. Hosted worker scheduling and physical Storage deletion were not tested.

### Git and remaining gaps

Code commits `8605dbf` (`fix: avoid indexing managed storage metadata`) and `2807ea4` (`fix: restore media claim status on detail pages`) are pushed to `origin/fix/storage-objects-index-role`. The project-note update is committed separately. No PR or merge was created. `/letter`, `.env.local`, and hosted resources were not changed. No Supabase CLI access token or authenticated dashboard control is available in this task; hosted Free-plan verification, two-account delivery, cleanup scheduling, actual Storage deletion, screen-reader use, and physical-device behavior remain open. Large-bucket scan cost and concurrent database interleavings are also unmeasured.

### Follow-up — hosted Supabase session reachability (2026-10-24)

The user reports being signed in to Supabase in a browser. This task has no connected dashboard control, and a read-only `supabase projects list` check could not run because the Supabase CLI executable is not installed. No hosted project or billing resource was inspected or changed. A browser login alone does not provide an authenticated session to task tools; continue only when a dashboard control or scoped CLI session is available. The local Drop app was restarted through `run.sh` and returned HTTP 200 on port 4004.

## 2026-10-24 — Seal and clarify the Relay demo journey

### Issue

The demo chooser already showed `/demo-cat.png`, and the Relay reveal reused that same image. The promise that the sample stayed sealed until collection was therefore visually false. The route's current and completed states were also conveyed only by styling and decorative icons.

### Cause

The chooser and Relay preview shared one fixture image. The ordered list had visual progress, but its numbers and checks were hidden from assistive technology and its list items exposed no current step.

### Resolution

- Added a distinct blue-hour illustration and render it only after **Collect this drop**.
- Marked the active route item with `aria-current="step"` and added screen-reader-only upcoming, current, and completed labels.
- Kept the preview fictional and local-state-only; it does not use location, sign-in, backend services, persistence, or sharing.

### Learning

Check the entire visible page for reused sample content before calling a reveal sealed. A live announcement is helpful, but route progress also needs state attached to each step so someone navigating the list can tell what is done, current, or ahead.

### Verification

- `npm test` passed 251/251; lint, `npx tsc --noEmit --incremental false`, `git diff --check`, and `npm run build -- --webpack` passed. The build reports the existing outdated Browserslist database and ambiguous Tailwind easing-class warnings.
- Isolated Chrome passed at 360×844, 390×844, and 430×844. Keyboard and touch advanced the preview, keyboard focus stayed on the primary action, the separate illustration was absent before collection and loaded after, route state was present in the DOM, and there was no overflow, failed request, browser error, or external request. Screenshot: `/private/tmp/drop-relay-demo-browser-smoke.png`.
- This was a rendered browser check, not a screen-reader or physical-device check. It used the existing QA Chrome target; its temporary CDP script is `/private/tmp/drop-relay-demo-browser-smoke.mjs`.

### Git and remaining gaps

Code commit `d218721` (`feat: add sealed Relay preview to demo`) is pushed to `origin/feat/demo-relay-preview`. Project notes are in a separate documentation commit on the same branch; no PR or merge was created. `/letter`, `.env.local`, and hosted Supabase were not changed in this slice. The checkout's local Supabase CLI dependency exists, but the project-list request returns `AccessTokenRequiredError`; the user's browser login does not authenticate the CLI. No hosted Drop project was created. Screen-reader use, physical-device behavior, hosted delivery, and actual Storage cleanup remain open.

### Issue

Drop needed a mobile-friendly way to begin a photo/GIF draft from another app's system share sheet. A PWA share target posts a multipart body to the app, so a controlled client service worker must intercept and retain the media before routing to Compose. A fallback route cannot promise that the browser did not already submit the body to the website.

### Cause

There was no PWA manifest share target or handoff store. The composer also needed protection against retries, async navigation, and a currently active claim-pending screen: a repeated handoff could otherwise overwrite user edits, restore a completed drop, or navigate away before the import result appeared.

### Resolution

- Added the manifest share target and a same-origin service worker handler for one supported image up to 8 MB. It validates media, stores a one-hour IndexedDB handoff, and routes using an opaque UUID; the URL does not contain captions or media.
- Compose restores a handoff into an unsent local draft. The stable ID makes retries reuse the account-scoped draft and saved attachment; sent/claimed records are excluded, and existing text/recipient edits are preserved.
- Disabled composer submission and guarded navigation for the duration of the async import. The claim-pending view also announces progress and guards its saved-drop link.
- Kept fallback copy accurate: if the page is not controlled by the worker, use the in-app picker when avoiding the browser's POST to the site matters.

### Learning

For a PWA share target, test the full worker-controlled POST path and state the fallback's actual data flow plainly. Use one opaque id across browser handoff and draft identity so retries can be safe, then guard every route exit while asynchronous persistence is incomplete, including special states that replace the main form.

### Verification

- `npm test` passed 267/267; targeted `npx eslint app/compose/page.tsx`, `npx tsc --noEmit --incremental false`, `node --check public/service-worker.js`, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed.
- `npm run build -- --webpack` passed and generated 22 routes. It reported the existing outdated Browserslist data and ambiguous Tailwind easing warnings.
- Home, `/manifest.webmanifest`, and `/service-worker.js` returned HTTP 200 at port 4004. Review confirmed all Composer navigation links are guarded during import.
- The focused browser smoke did not run: Chrome failed to publish `DevToolsActivePort` within 15 seconds. The installed PWA, OS share sheet, actual screen-reader speech, and physical-device behavior remain unverified.

### Git and remaining gaps

Code commit `6d2ed9d` (`feat: add installed web share target`) is pushed to `origin/feat/demo-relay-preview`; project notes are committed and pushed separately. No merge to `main` was made. The current candidate was 120 commits ahead and 0 behind `origin/main` before the separate notes commit; use `git log -1 --oneline --decorate` and `git rev-list --left-right --count origin/main...HEAD` after fetch to see the latest tip and divergence. `.env.local` was excluded and unchanged, `/letter` was untouched, and no hosted Supabase project was created. Next verify the worker-controlled share flow in a working browser and test installation/share-sheet behavior on a phone; hosted two-account delivery, storage cleanup, screen-reader use, and physical-device accessibility remain open.
