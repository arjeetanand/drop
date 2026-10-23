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
