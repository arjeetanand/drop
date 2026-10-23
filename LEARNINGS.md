# Drop learning log

Append one dated entry for every completed code-change or issue-resolution slice. Keep the record evidence-based: issue, cause, resolution, verification, Git checkpoint, and remaining gaps. Do not store credentials or private content here.

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
