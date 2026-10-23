# Drop learning log

Append one dated entry for every completed code-change or issue-resolution slice. Keep the record evidence-based: issue, cause, resolution, a reusable learning, verification, Git checkpoint, and remaining gaps. Tie statements to the actual diff, commit history, and test output. Do not store credentials or private content here.

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
