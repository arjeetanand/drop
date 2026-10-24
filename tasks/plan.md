# Implementation Plan: Drop Mobile Sharing Experience

## Overview

Build Drop as a mobile-first private sharing app where a person can send a photo, GIF, meme, or text letter as a “drop.” Use the three mobile concept directions already reviewed as visual references: bold cobalt and warm paper, oversized media previews, playful stamps, and expressive but quick send/open moments. Drop is the product brand and a “drop” is the item shared. Sending stays one-to-one in the first release; delivery is instant by default, with the existing human relay as an optional slower journey. There will be no public discovery feed in this release.

The app keeps its current Next.js, React, Tailwind, Supabase, local draft, mailbox, and relay foundations. Existing letters continue to work as text drops, and their routes and saved content remain readable. The build covers the end-to-end mobile flow: choose content, attach an image or GIF, choose a recipient, send, open, react, and optionally follow a relay.

## Implementation Status — 2026-10-24

### Latest checkpoint — Share-to-Drop PWA import and replay safety (2026-10-24)

- Added an installed web share target for JPEG, PNG, WebP, and GIF files up to 8 MB. The service worker stores an opaque one-hour IndexedDB handoff; Compose imports it as an unsent local draft.
- Replay finds the matching account-scoped draft by stable media ID, preserves edits and the saved attachment, and excludes completed drops. Import state disables form actions and guarded navigation, including the claim-pending view.
- Verification: 267/267 unit tests, targeted ESLint, no-incremental TypeScript, worker/smoke syntax, `git diff --check`, and production build passed. Home, manifest, and worker returned HTTP 200 on port 4004. Chrome did not publish `DevToolsActivePort`, so the share-target browser flow and OS share sheet remain unverified.
- Code commit `6d2ed9d` is pushed to `feat/demo-relay-preview`; the project-note commit follows separately. Hosted Supabase was not changed, `.env.local` was excluded, and `/letter` was untouched.
- Remaining: verify installed-PWA and share-sheet behavior in a real browser/phone; complete screen-reader and physical-device checks; complete hosted two-account delivery and media cleanup when a Free project is available.

### Latest checkpoint — fictional Relay demo preview (2026-10-24)

- `/demo` now includes an interactive, fictional three-carrier journey with explicit collection. Its distinct blue-hour illustration and sample text render only after collection; the visible photo/GIF chooser does not reveal this preview's content.
- The route identifies upcoming, current, and completed steps to assistive technology. The preview is state-only and does not use location, account, backend, send, or persistence flows.
- Verification: `npm test` passed 251/251; lint, no-incremental TypeScript, production build, and `git diff --check` passed. Isolated Chrome at 360, 390, and 430 CSS pixels checked keyboard/touch progression, focus retention, accessible state, hidden-before-collection content, no overflow, no page errors, and no external requests. Product/accessibility review found no concrete issue.
- Code commit `d218721` (`feat: add sealed Relay preview to demo`) is pushed to `origin/feat/demo-relay-preview`. No PR or merge was created. No Supabase project or hosted service changed; the local CLI is installed but its project-list request returns `AccessTokenRequiredError`.
- Remaining: real screen-reader and physical-device checks, plus hosted account-to-account delivery and physical Storage cleanup after the approved Free project is available.

### Latest checkpoint — local cleanup migration and media claim recovery (2026-10-24)

- Removed the reconciliation index from `storage.objects` after the local Supabase migration role rejected it. The cleanup RPC still walks ordered cursor pages; database scan/sort cost may grow with the bucket.
- Applied `20261023160000_reconcile_orphan_drop_media.sql` and `20261023170000_drop_pending_media_retention.sql` to the local database. Both are recorded as applied, and no custom index exists on the managed Storage table.
- Sender detail reads now use the shared eligibility check for text, image, and GIF claim status. Corrected the SQL fixture's stale claimed-drop count and recipient expectations.
- Verification: `npm test` passed 249/249; lint and no-incremental TypeScript passed. The rollback-only SQL claim/media fixture passed in a fresh disposable local database, which was then dropped. Browser, hosted two-account delivery, cleanup scheduling, and physical Storage deletion were not exercised in this slice.
- Code commits `8605dbf` and `2807ea4` are pushed to `origin/fix/storage-objects-index-role`. No PR or merge was created.
- Next: verify the Free hosted project and run two-account send/claim plus worker/Storage deletion checks; finish screen-reader and physical-device validation.

### Latest checkpoint — saved private-claim recovery browser assertions (2026-10-24)

- The isolated browser smoke seeds a synthetic pending claim, reloads Compose, checks the durable saved-drop message without exposing the lost in-memory copy link, and verifies the encoded detail route plus an enabled **Share a fresh private link** button.
- `npm test` passed 245/245; lint, no-incremental TypeScript, browser-script syntax, and `git diff --check` passed. A disposable Chrome context passed at 360×844 by touch and 390×844, 430×844, and 1440×900 by keyboard; there was no horizontal overflow, cross-origin traffic, Auth/REST/Storage request, console error, or JavaScript exception.
- The repository runner's standalone Chrome timed out on DevTools `Page.navigate` in this environment. The same flow passed in a new isolated context on the existing QA Chrome process. This fixture does not exercise the OS share sheet, real account-to-account delivery, or physical deletion.
- Code commit `b064dab` (`test: verify saved claim recovery in browser`) is pushed on `fix-private-claim-share-cancel-copy`; this checkpoint's learning and project notes are recorded in a separate documentation commit. No PR or merge was created.
- Next: verify real photo/GIF claims and actual 30-day Storage cleanup against the isolated local or approved Free Supabase backend; then test screen-reader output and a physical device.

### Latest checkpoint — accessible reaction names (2026-10-24)

- Reaction buttons expose the shared natural-language names already used by live reaction announcements, so assistive technology receives labels such as “React with heart hands.” The browser smoke asserts all five labels.
- Verification: `npm test` passed 245/245; lint, no-incremental TypeScript, `node --check scripts/browser-demo-smoke.mjs`, and `git diff --check` passed. Isolated Chrome passed the photo and GIF demo flows at 360, 390, and 430px plus 1440px, including keyboard navigation, reaction save/reload, and sender copy. No cross-origin, Auth, RPC, or Storage-write request occurred.
- The main checkout returned HTTP 200 on port 4004. No screen reader, physical device, hosted two-account claim, or real Storage deletion was verified. The rollback PostgreSQL fixture did not start: PostgreSQL 16.15 `initdb` failed with `shmget` “No space left on device” even when initialized with mmap options; no SQL assertions ran.
- Code commits `7823b41` (`fix: give reaction controls spoken names`) and `783bc52` (`fix: make reaction labels read naturally`) are pushed on `fix-private-claim-share-cancel-copy`; this checkpoint is recorded in a separate documentation commit. No PR or merge was created.
- Next: complete the first-friend photo/GIF claim journey with disposable accounts and verify the real cleanup worker when an isolated local or approved Free Supabase backend is available.

### Latest checkpoint — private claim share recovery (2026-10-24)

- The composer now distinguishes a prepared-but-unshared private link from a recovered claim-pending drop, without claiming the recipient is already waiting. The in-memory link remains copyable after share cancellation; after reload, **Open saved drop** routes to the exact encoded drop ID and its existing status/fresh-link controls.
- Added regressions for both copy states and for encoding the detail route as one path segment. Independent review found no concrete issue.
- `npm test` passed 243/243; `npm run lint`, `npx tsc --noEmit --incremental false`, and `git diff --check` passed for the original share-recovery change. The recovery/detail route has since been verified in a rendered isolated browser context. The full signed-in send and operating-system share-sheet cancellation remain unverified.
- Code commit `53cbb82` (`fix: make private claim recovery truthful`) is pushed on `fix-private-claim-share-cancel-copy`; this checkpoint is recorded in a separate documentation commit on the same branch. No PR or merge was created. The 30-day automatic deletion rule for valid abandoned staging media remains confirmed and unchanged.
- Next: test operating-system share cancellation in a real browser, then complete the two-account media claim and actual Storage deletion checks against the approved Free or disposable local Supabase runtime.

### Latest checkpoint — private claim send receipt (2026-10-24)

- Private claim receipts now distinguish a finished share sheet from a clipboard copy. Legacy or invalid outcome query values get neutral copy, while the receipt avoids claiming the recipient received or opened the link.
- The waiting state comes from the sender-owned pending drop row; “Claimed” requires the sender-only claimed-ID RPC. Status refreshes on focus, visibility, and account changes, is scoped to both drop and account, and is announced to screen readers. A missing explicit receipt ID cannot substitute another local draft.
- The user reconfirmed automatic deletion of valid abandoned staging uploads after 30 days. Existing cleanup policy already matches; no cleanup code or hosted resource changed in this slice.
- `npm test` passed 237/237; lint, no-incremental TypeScript, and `git diff --check` passed. Home and Sent returned HTTP 200 on local port 4004. The production build stopped with `EPERM` opening `.next/trace`; no browser-rendered or hosted two-account check ran.
- Code commit `ac0396f` is pushed on `fix/private-claim-receipt-outcome`; no PR or merge was created.
- Next: run rendered share/copy and claim-status checks with browser tooling, then verify the unknown-handle photo/GIF claim journey and actual cleanup against an isolated local or approved Free Supabase runtime.

### Latest checkpoint — PKCE callback effect replay (2026-10-24)

- The auth callback now shares one pending Supabase PKCE code exchange across React effect replay. Disposed effect runs cannot update callback state or navigate after a newer run starts.
- Added regression coverage for same-code deduplication, distinct codes, stale callback suppression, and the combined replay-to-claim route. Independent frontend review found no concrete findings.
- `npm test` passed 224/224; lint, no-incremental TypeScript, and `git diff --check` passed. `npm run build` stopped with `EPERM` opening `.next/trace` in the active checkout. No rendered sign-in, hosted OAuth, or two-account claim was verified.
- Code commit `7afdf3b` is pushed on `fix/auth-callback-effect-replay`; no PR or merge was created.
- Next: verify the rendered callback and account-to-account claim with an isolated browser and Supabase runtime, then complete the unknown-handle photo/GIF and actual Storage cleanup checks.

### Latest checkpoint — unknown-handle text claim smoke coverage (2026-10-24)

- Extended the authenticated local Supabase smoke to use a fifth disposable account that is initially unprofiled. It now covers the unknown-handle text invite, unreadable/unclaimable pre-profile state, explicit profile setup and claim, link rotation, idempotent same-account retry, outsider/replay denial, participant-only reads, and sender status/reaction recovery.
- Denial assertions require SQLSTATE `42501` and no returned drop ID, so an unrelated backend failure cannot count as a privacy pass.
- `npm test` passed 220/220; lint, no-incremental TypeScript, smoke-script syntax, and `git diff --check` passed. The authenticated smoke and rollback-only claim SQL fixture were not run: the local Supabase API port is owned by an SSH listener, and a disposable PostgreSQL server could not start because host shared-memory allocation failed.
- Code commit `e5b7b43` is pushed on `test/unknown-handle-claim-smoke`. No PR or merge was created. Browser-rendered and hosted behavior remain unverified.
- Next: run the expanded smoke and SQL fixture against a confirmed disposable local stack, then verify rendered claim behavior and unknown-handle photo/GIF access and cleanup using the approved Free project when available.

### Latest checkpoint — mobile claim-first return (2026-10-23)

- Profile setup returns to the sanitized invite handoff only after the remote account profile sync succeeds. Device-only saves and failed/conflicted syncs remain on the profile screen.
- The claim page is shorter on mobile: a compact semantic progress bar and concise privacy/expiry disclosures leave the explicit **Claim this drop** action earlier in the flow. The action receives focus when the account is ready and after a retryable claim failure; it is never activated automatically.
- When neither browser storage mechanism can preserve the invite, the page blocks profile navigation and gives recovery guidance. Bearer tokens remain in fragments, session storage, or opaque local handoffs; no token is added to a route.
- `npm test` passed 220/220; lint, no-incremental TypeScript, diff check, and local HTTP checks for `/`, `/claim`, claim-aware `/profile`, and `/auth/callback` passed. Commits `23240ea` and `9f188ee` are pushed on `feat/claim-first-mobile-flow`.
- Rendered browser, screen-reader, storage-blocked interaction, hosted auth, and two-account claim checks remain open. The local Supabase API port 54321 is occupied by an SSH listener; no local stack was started. A production build was not run for this slice.

### Latest checkpoint — relay draft private-claim fallback (2026-10-23)

- Relay mode now offers a clear switch to Instant for a checked unknown recipient, enabling the existing private claim-link path without weakening its instant-only authorization boundary.
- Switching preserves the draft and saved attachment, focuses the existing private-link action, and does not share until the sender explicitly selects that action. The switch is guarded during active invite, send, and delete work.
- `npm test` passed 219/219; lint, `npx tsc --noEmit --incremental false`, and `git diff --check` passed. Code commit `56dc3f2` is pushed on `feat/relay-claim-fallback`.
- The production build, rendered browser/keyboard checks, hosted two-account claim, and actual Storage deletion were not verified. The prior build attempt was blocked by Google Fonts DNS; no hosted Supabase project is configured.

### Latest checkpoint — local account-to-account verification and card contrast (2026-10-23)

- The authenticated local Supabase smoke passed with four disposable accounts: known-recipient text access, outsider denial, recipient reaction visibility, GIF finalize and lost-response retry, relay privacy/collection, and legacy relay normalization. The process exited successfully after cleanup.
- Updated small white text on the home, sent, and relay cobalt cards. Against `#2b45f7`, white at 70% and 75% opacity measures 3.88:1 and 4.26:1; the new 80% text measures 4.63:1.
- `npm test` passed 175/175; lint, no-incremental TypeScript, production build, and `git diff --check` passed. These checks ran locally; browser rendering and hosted behavior remain open.
- This smoke uses a known recipient. It does not verify the unknown-handle photo/GIF claim journey, claim replay UI, or hosted cleanup worker.

### 2026-10-23 relay recipient collection

- Recipient relay cards show only sender and carrier route details while a drop is dispatched; the recipient explicitly collects it before letter content, attachments, events, and reactions become available.
- Collection updates the sender Journey and Relay passport from durable sender-side `delivered` relay status and its activity time. The route map, recipient stop, and custody timeline reach a terminal state together, and carrier invites are hidden after collection. A failed first status read remains unknown so it cannot enable an invite. Legacy dispatched rows whose `delivery_mode` says `instant` remain covered by the compatibility migration.
- Unit, local Supabase smoke, and route refresh coverage are in place, but rendered collected-state acceptance remains open: the temporary browser fixture did not hydrate a valid sender row. Hosted two-account verification also waits on the approved Free project.

### Implemented slice — private photo/GIF claim links (2026-10-23)

- The composer can send an instant photo or GIF claim link to an unknown handle after the attachment is saved locally. The recipient must authenticate and explicitly claim before reading the media. Relay claim links remain out of scope.
- Claim links last up to 7 days. An unclaimed media claim and its access expire 30 days after the first send; rotating the link does not extend the cutoff. An hourly worker revokes expired claims and retries object deletion through the Supabase Storage API. Physical deletion can be delayed when the Free project is paused or the worker/Storage service is unavailable.
- Ambiguous finalization and issue responses use a delayed cleanup queue, same-path locks, and revalidation before deletion. The composer keeps the attachment for retry and only rotates its upload path after cleanup is confirmed.
- Verification: unit tests, the disposable PostgreSQL policy/transition fixture, lint, TypeScript, production build, and local route smoke checks pass. A real local account-to-account smoke passed for known-recipient text/GIF and relay flows; the unknown-handle private claim journey, hosted migration/worker, and rendered browser flow remain unverified.
- Orphan reconciliation now covers finalized unlinked media when both enqueue attempts fail. Its scan reads managed Storage metadata in ordered cursor pages without creating an index on `storage.objects`; large-bucket scan cost and concurrent database interleavings remain unmeasured.

### Reliability follow-up — orphan media reconciliation (2026-10-23)

- Added a service-role-only cursor scan for valid finalized objects in the private `drop-media` bucket that are unlinked and older than 30 days. It queues jobs into the existing Storage API deletion worker, with a 25-object page and cursor reset after each pass.
- The worker treats discovery as best-effort: a reconciliation error is reported after it continues leasing and processing already-queued jobs, so the optional scan cannot pause existing cleanup.
- Unit and disposable PostgreSQL coverage exercise worker ordering/error recovery, grants, invalid batch sizes, 25+1 pages, cursor wrap, an object inserted behind the cursor, near-cutoff eligibility, exclusions, and duplicate prevention.
- Remaining verification: local migrations now apply, but the hosted worker schedule, real Storage deletion, and rendered browser behavior have not been verified. Supabase restricts index creation on existing managed-schema tables, so the scan has no custom `storage.objects` index; query cost at production scale and concurrent database interleavings remain untested.

- Task 1 is complete. The mixed-payload model, default text behavior for older drafts, and compatible recipient routes are in place.
- The core mobile sharing, receive, reaction, and optional relay flows have local implementations. Relay remains in progress until the acceptance checks in `todo.md` are verified.
- Same-device text, photo, and GIF demos have been checked through recipient reveal/open, reaction, sender copy, and reload. This verifies local media persistence and reaction presentation, not authenticated account-to-account delivery.
- Authenticated local browser checks cover a text drop (including the sender mailbox reaction) and PNG/GIF drops sent through the composer at a 390px viewport, opened by the recipient, and reacted to. The two disposable local accounts, drops, reactions, media objects, and exact Mailpit sign-in messages were removed; local sent-copy history remains in the browser. Google OAuth and hosted account behavior remain unverified.
- Seeded demo reactions now persist on this device and appear on the mailbox card; they are clearly marked as local and do not notify a sender.
- Signed-in mailbox cards now show participant-visible reactions on sent drops; hosted account-to-account verification remains open.
- Legacy seeded inbox examples (photo, GIF, and archival text) are labeled as samples, kept out of real counts, and available through an explicit Samples filter; the editable starter draft remains a draft. Sample reactions stay on this device.
- First-use profile setup preserves customized local identity, suggests an editable account-specific handle, and only creates a sender profile after confirmed absence. Per-account unsynced edits survive lookup recovery, and handle conflicts stay recoverable on-device. The local smoke test verifies rejected updates and duplicate first-use inserts leave existing profiles unchanged. Authenticated browser onboarding remains unverified.
- Local drafts and related notes, attachments, reactions, relay state, and location data are now partitioned by authenticated user ID. Existing unscoped data stays in the guest/device bucket; a root auth gate resolves the session before private local views render and profile supports sign-out. A local signed-out browser check passed; switching between two active accounts in-browser remains open.
- Hosted Supabase account-to-account behavior, storage privacy, and relay still need verification because no hosted project exists. The local CLI smoke test covers Auth, row/reaction policies, private GIF finalization (including a sequential retry with a fresh staging path), participant-only storage reads, and handle uniqueness; authenticated browser passes cover text, photo, and GIF send/open/react locally. Google OAuth and real-device safe-area, keyboard, and reduced-motion checks remain open. A focused route regression now verifies that an existing-drop lookup error returns a retryable 503 before final upload; simultaneous sends remain untested.
- Relay scan and manual PIN handoffs no longer reverse-geocode device coordinates. Current device GPS is unchecked by default, requested only after opt-in, and saved locally after successful acceptance. Legacy QR links still carry the previous carrier's coordinates in their URL, so opening those links sends the URL to the Drop server.

## Workspace and Delivery

- The active app checkout is /Users/arjeetanand/projects/drop and is the only Drop write target. The previous OneDrive path is absent locally and the connected OneDrive projects folder has no Drop folder. Keep /letter read-only.
- The active checkout is linked to the existing private GitHub repository arjeetanand/drop; .env.local stays in the active checkout, is ignored by Git, and must never be committed.
- Work on a dedicated task branch; verify, commit, and push each passing slice to its branch. Ask for approval before merging to the default branch.
- Keep the established visual direction: warm paper, cobalt actions, expressive media, small postmark details, and thumb-first navigation.

## Product Scope and Decisions

- **Core payloads:** text/letter, photo or meme image, and GIF. A meme is an image with an optional caption. Upload from the device first; defer a searchable third-party GIF catalog until a provider is selected.
- **Sharing:** one recipient per drop for v1. Keep the interface ready for groups, but defer group data and permissions until the one-to-one flow is solid.
- **Delivery:** instant is the default. Human relay is an explicit choice for a drop that should travel hand to hand. Map and route details appear only in relay mode.
- **Privacy:** drops are private to sender and recipient. Media uses private storage and recipient-aware access. Do not expose public asset URLs or precise location in the normal sharing flow.
- **Local demo:** seeded examples can demonstrate image/GIF cards when clearly labeled as samples, separate from real mailbox counts, and opened by choice. Real media delivery requires the configured Supabase account and private storage; drafts should clearly show if a file has not uploaded yet.
- **Out of scope for v1:** public feed, likes/follows, group chats, video/audio recording, and a GIF search provider.

## Architecture Decisions

- Use Drop as the visible brand while keeping existing routes, components, and `dear-exe:` storage keys compatible; update the interface language to “drops” while retaining `/letter/[id]` links and the current relay routes for saved content and shared links.
- Add an explicit payload kind and delivery mode to the existing draft/letter model. Treat records without a payload kind as text so local drafts, seeded examples, and existing Supabase rows remain compatible.
- Store only private storage paths and media metadata with a drop. Upload files to a private Supabase Storage bucket and return short-lived authorized URLs only when sender or recipient opens the drop. Validate file type and size at the upload boundary.
- Reuse the current local draft store and Supabase client. Do not add a client state or animation dependency for this redesign.
- Build mobile first with a thumb-friendly bottom navigation, safe-area spacing, large media previews, and concise screens. Keep a responsive desktop layout using the same information hierarchy.
- Use short, clear CSS transitions for send/open feedback and honor `prefers-reduced-motion`. Keep relay maps, tracking events, and handoff flows behind the explicit relay choice.
- Before the first source-code change, follow the project’s `AGENTS.md` instruction and read the relevant installed Next.js guide from `node_modules/next/dist/docs/`.
- Preserve the current uncommitted prompt and seal changes in `app/page.tsx`, `app/compose/*`, and `data/mockData.ts` when integrating the new flow.
- Commit each completed code change separately with a descriptive message, then push it to `origin` at `https://github.com/arjeetanand/drop.git`. Keep unrelated pre-existing changes out of each commit.

## Task List

### Phase 1: Data and Media Foundation

- [x] Task 1: Add the mixed-payload model with backward-compatible text defaults.
- [x] Task 2: Add private image/GIF upload and recipient-authorized reads.

### Checkpoint: Foundation

- [ ] Existing local and Supabase letters still load as text drops.
- [ ] An authenticated sender can upload an allowed image/GIF and only the sender or recipient can retrieve it.
- [ ] No existing stored letter or draft is overwritten by the new fields.

### Phase 2: Mobile Sharing Flow

- [x] Task 3: Rework the mobile home, mailbox, and navigation around drops.
- [x] Task 4: Turn the composer into a single mobile-first drop flow.

### Checkpoint: Sending

- [ ] A person can create and send a text, image/meme, or GIF drop to one recipient.
- [ ] Instant delivery works without showing a map; relay is an intentional choice.
- [ ] Current writing prompts and seal choices still work where they apply to text drops.

### Phase 3: Receiving and Relay

- [x] Task 5: Make received drops open in the right media format and support a private reaction.
- [ ] Task 6: Keep the existing human relay as an optional mode for any supported drop.

### Checkpoint: End-to-End

- [ ] Sender and recipient can complete the send, open, and react flow on a phone-sized viewport.
- [ ] Existing letter links and relay history still open correctly.

### Phase 4: Mobile Polish

- [ ] Task 7: Tune accessibility, motion, responsive behavior, and release checks.

### Checkpoint: Complete

- [ ] Lint, typecheck, and production build pass.
- [ ] Manual mobile checks pass at 360px, 390px, and 430px widths, including keyboard and safe-area behavior.
- [ ] Reduced-motion mode and desktop layout remain usable.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Existing data and links are letter-specific. | Old drafts, mailbox cards, or shared links could disappear. | Make payload fields additive, default old records to text, and retain current routes and hydration behavior. |
| Supabase currently stores letter text but has no media bucket. | Uploads could be inaccessible or leak through public URLs. | Add a private bucket and explicit storage policies for sender/recipient access; verify policies with two different accounts. |
| Large or unsupported uploads can break mobile composition. | Slow uploads, storage waste, or failed sends. | Accept only image formats and GIF for v1, enforce a documented size cap, show upload progress/failure, and keep the draft recoverable. |
| Large GIF still capture can allocate excessive canvas memory on phones. | Reduced-motion previews may fail on lower-memory devices. | Cap still frames at 1600px on the longest side and verify the reduced-motion path on a phone. |
| The current local demo has no durable media backend. | A local preview could look sent but vanish after reload. | Mark unuploaded media as local preview, offer seeded media in demo mode, and only report success after a persistent upload and drop save. |
| Existing relay screens and their map/location model are more elaborate than instant sharing needs. | The default flow could feel slow or expose unnecessary location. | Keep relay optional and preserve map details only in that mode; request location only when the user starts a relay action. |
| Existing user changes overlap the home and composer. | The redesign could erase current writing prompts or seal choices. | Integrate with the current working tree and inspect the diff before editing those files. |

## Open Questions

- Revisit group sharing and GIF search after the one-to-one image/GIF flow is working.
- Confirm the upload size cap against the configured Supabase plan during implementation; the initial design should surface the limit before upload.

## Accountless private claim invite — text-first vertical slice

### Objective
Let a sender share a private text drop with a person who does not yet have a Drop account. The recipient signs in or creates an account, sets up a Drop profile, and explicitly claims the drop. Until that claim succeeds, only the sender can read the letter; the claim URL contains no content or recipient details.

### Scope and boundaries
- First release supports instant text, photo, and GIF claim drops. Human relay remains an explicit delivery choice; relay claim links follow only after the instant claim path passes hosted privacy and retry checks.
- The link is a high-entropy bearer capability: anyone who receives the forwarded link can claim it. Tell the sender this before sharing.
- Store only a SHA-256 token digest, sender/letter binding, expiry, and claim state. Return the raw token only at issue time, put it in the URL fragment, and require an explicit authenticated claim action. GET/page load must not consume it.
- Require an authenticated Drop profile before claim. Never expose letter, event, reaction, or Storage content to anon or an unclaimed account.
- Claim atomically binds the letter to the authenticated profile and releases it through existing participant RLS. Same-account retry is idempotent; other accounts, expired/revoked links, and replay after another account claimed fail closed.
- Show a clear “Waiting for them to claim” state in Sent. Never infer this state from a null recipient ID.

### Success criteria
1. A sender can create and share a generic link for a text, photo, or GIF draft addressed to a not-found handle; cancellation and clipboard fallback preserve a recoverable draft/link state.
2. Share title/text and the public page reveal no draft content, subject, handle, or media metadata.
3. The recipient can authenticate, create a Drop profile, return to the invite without placing the token in query parameters, and explicitly claim.
4. Before claim, anon and unrelated authenticated accounts cannot read the letter or its dependent data. After claim, the recipient can read it through existing RLS.
5. Concurrent or repeated claims cannot bind the letter to two users; same-user retries return the same result.
6. Expired/revoked tokens fail closed, and sender-owned pending state is distinct from drafts and delivered drops.
7. Unit and disposable-local-PostgreSQL checks cover token URL handling, privacy, valid claim, expiry, wrong account, replay, and retry behavior.

### Build order
1. [x] Define and test safe fragment handling, generic share copy, and claim URL parsing.
2. [x] Add the claim table and narrowly scoped issue/reissue/claim RPCs; verify RLS and transition behavior in disposable local PostgreSQL.
3. [x] Add sender claim-pending state and composer action for instant text, photo, and GIF drops.
4. [x] Add the claim landing, auth/profile continuation, and explicit claim action.
5. [x] Run regression, lint, typecheck, build, and local database smoke; [ ] complete rendered browser and hosted claim acceptance before release.

### Remaining follow-ups
- Verify the rendered sender reissue and recipient claim flows at phone and desktop widths, including profile setup, link cancellation/copy fallback, and accessibility.
- Apply the media-claim migration and configure the cleanup worker on the approved Free Supabase project; verify two-account photo/GIF claiming, scheduled Storage deletion, and reissue after deployment.
- Exercise claim/issue/queue/lease ordering with concurrent database sessions before production.
- Extend the verified claim path to relay only after hosted media-claim acceptance is complete.
- Configure and verify the explicitly approved Free hosted Supabase organization/project when secure management access is available. No hosted resources are created by this local slice.
