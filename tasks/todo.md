# Implementation Tasks: Mobile Drop Experience

Tasks are ordered by dependency. Progress is recorded at each tested and pushed checkpoint.

## Current Checkpoint — 2026-10-19

- The foundation, mobile drop flow, draft handoff, secure relay, and reduced-motion GIF work are pushed separately: `04cc01f`, `047c6b9`, `b062dbe`, `6b43271`, and `4f38e0e`.
- Follow-up commits are pushed: `27db56c` restricts letter update/delete access to unsent rows and uses insert-once sends; `0190b7d` routes relay invites through the secure passport; `59988d0` adds a local recipient preview.
- Verification passes `npm test` (47/47), lint, typecheck, and an isolated scratch Next.js/Webpack production build after the account-isolation fixes. Browser checks confirmed no horizontal overflow at 360px, 390px, and 430px on the desk, profile, and mailbox; the composer preview was checked at 390px. A photo draft survived the account-options detour and reload, and a GIF preview loaded at 390px.
- The new recipient preview was checked in-browser for text, recipient handle, sign-off, and return-to-edit persistence. Local PNG and GIF attachments saved in IndexedDB and appeared in the recipient view; the GIF remained available after a page reload. Unsupported and over-8 MB fixtures showed visible errors while the draft text remained. The home prompt, note sign-off choices, and seeded `/letter/1` reveal flow remain reachable. The relay send CTA was checked through to the passport, including its sign-in requirement without Supabase credentials. A local PostgreSQL transaction confirmed sent letters cannot be changed or deleted by the sender, while an unsent draft can still be sent; the transaction rolled back. The latest scratch production build includes `/compose/preview`.
- Relay handoffs now use short-lived server-issued capabilities; the migration keeps carrier access to route details and excludes message text/media. The migrations are not deployed because no hosted Supabase project exists, so hosted OAuth, account-to-account send/media/reaction, and cross-device handoff remain unverified. The local PostgreSQL policy smoke test does not verify hosted Storage policies. The browser setup also could not emulate `prefers-reduced-motion`; that branch was reviewed but not exercised in-browser.
- A pinned Supabase CLI and local-only config now reproduce the Supabase stack. The first reset exposed duplicate migration version prefixes; after assigning unique ordered versions, `npm run supabase:reset` applied every migration cleanly. Local authenticated text send/open/react now passes in the browser; Google OAuth, media UI delivery, and hosted behavior remain open.
- A disposable local three-account smoke test now covers authenticated text insert/read, recipient-only reaction writes, outsider denial, validated GIF staging/finalization, exact finalize retries that reuse the linked file and remove duplicate staging data, sender/recipient-only media downloads and signed URLs, unique-handle conflicts, and duplicate first-use inserts that leave existing profiles unchanged. It cleans up its accounts/media and refuses non-loopback projects. Hosted OAuth and hosted project behavior remain open.
- A local authenticated browser pass sent a text drop to a confirmed handle, revealed and opened it as a second account, saved a 🫶 reaction, and confirmed it on the sender mailbox card. Both disposable local accounts and the database drop/reaction were removed afterward; the browser keeps a local sent-copy history item. Google OAuth and hosted delivery remain unverified.
- A separate local browser pass received admin-seeded PNG/GIF drops as the recipient, opened both, confirmed each image rendered with descriptive alt text, saved 🫶/🥹 reactions, and confirmed both on the sender mailbox. The disposable accounts, rows, reactions, and media files were removed. The in-app browser file chooser did not open, so composer media upload remains unverified; its viewport bottomed out at 471 CSS px, leaving the 390px check open. The browser retains a local test draft, “Tiny cat test”; the app has no draft-delete control.
- First-use profile onboarding now preserves customized local identity, avoids importing another account’s profile, suggests an editable per-account handle, and retains unsynced edits per account across lookup recovery. Account-scoped local copies preserve signed-out edits through account switches, including target-profile lookup failures; the switch stops if the old copy cannot be saved. Concurrent first-use writes cannot replace a profile that appeared in another tab. The local profile page was checked while signed out; authenticated browser onboarding and conflict resolution remain open.
- A disposable local PostgreSQL smoke test now applies the sent-letter, media, and integrity migrations together. It confirms draft edits remain available, sender updates cannot promote or change sent drops, linked media cannot be deleted, unlinked upload cleanup still works, and sender/recipient media reads stay allowed while unrelated reads are denied. The SQL changes are not yet applied to a hosted Supabase project.
- A second disposable PostgreSQL smoke test now covers relay pass issuance, sender authorization, one-time handoff and exact retry recovery, carrier-pass rotation and revocation, coordinate-free and coordinate-bearing handoffs, participant-only route reads, and private token-table denial. The script and repeatable command are documented in `SUPABASE_SETUP.md`; hosted RPC behavior remains unverified.
- The relay regression check now hands off a private GIF drop without coordinates and confirms the carrier RPC result omits message text and media metadata. The browser QR/manual flow and hosted RPC behavior still need verification.
- A signed-out recipient opening a shared drop now gets a sign-in action that returns to the same drop. The local browser check verified the encoded return URL, the account section link, and the return link label/navigation. Google OAuth itself remains unverified without the configured Supabase project.
- Recipient preview now uses the saved text size and alignment and shows the local sender name. A browser check set 20px/right alignment and confirmed both styles, the sender/recipient line, and the not-sent preview notice. The temporary note content was cleared and the seeded draft restored.
- Recipient handles now show local format feedback, expose `aria-invalid`/help text, and only satisfy the send completeness check when the existing handle validator accepts them. An isolated browser check confirmed a one-character handle errors and a valid handle clears the error; no recipient lookup runs while typing.
- The composer now requires an explicit handle check, shows the matched display name and handle, distinguishes not-found from lookup failure, and binds confirmation to the normalized handle and recipient ID. Sending rechecks the recipient before media upload and before insert. Unit tests (36/36), lint, typecheck, production build, local Supabase identity lookup, send/media smoke checks, and the authenticated text browser flow pass. Google OAuth and hosted two-account send remain unverified because no hosted Supabase project is configured.
- A new database check ties payload kind to media type and presence: text rows have no media, image rows use static image MIME types, and GIF rows use `image/gif`. The transactional PostgreSQL smoke test rejects mismatched text, image, and GIF rows as well as image/GIF rows missing MIME types before they can be stored.
- Received drops with a known sender handle now offer an optional “Drop back” action that opens a fresh, addressed draft. The local seeded sender-to-composer flow was checked in-browser; no message was copied or sent. The Supabase profile join for sender handles still needs verification against a configured project.
- Mailbox filters are now exposed as a labeled group of toggle buttons instead of an incomplete tab pattern. Browser checks confirmed the pressed state changes for Sent and Drafts and that Tab plus Return operates the filters.
- Reactions on seeded demo drops now persist in this browser and appear on the mailbox card after leaving the detail view or reloading. Browser check selected 🫶, observed the “Saved on this device” disclosure, then confirmed “Reacted 🫶” on the mailbox card after navigation and reload; it does not notify a sender.
- Signed-in mailbox loading now fetches participant-visible reaction rows and shows “They reacted {emoji}” on sent cards. A focused mapping test covers matching and non-matching drops; the local policy smoke test verifies only the recipient can write/change a reaction while both participants can read it and an unrelated user can neither read nor write it. Hosted account behavior remains unverified.
- The recipient route now consistently calls the shared item a drop, including loading, reveal, and detail copy. A browser check opened a seeded received drop and confirmed the revised labels; route URLs and internal letter IDs are unchanged.
- Sending reconciles an existing draft ID before retrying and after ambiguous insert failures. Text recovery checks sender, recipient, content, subject, seal, mode, and status before reusing the original send time. Local smoke verifies that a sequential media retry with a fresh staging path reuses the committed object. A focused route regression verifies a failed existing-drop lookup returns a retryable 503 without uploading a final object; simultaneous sends and live Supabase timeout behavior remain open.
- Media captions are now prompted as descriptions, and visible captions serve as the text alternative without being announced twice; uncaptained media keeps a fallback image label. A local photo draft was checked in the composer and recipient preview with and without a caption.
- Browser checks confirmed the desk, mailbox, composer, recipient preview, and opened received drop have no horizontal overflow at exact 360px, 390px, and 430px CSS widths. Composer typography and seal-color controls measure 44px. Exact mobile keyboard/safe-area behavior, reduced-motion browser behavior, and real-device accessibility remain unverified; preview mode still blocks real cloud sending until remote persistence is configured.
- Same-device instant demos now complete note, photo, and GIF preview → recipient reveal/open → reaction → sender copy. Photo/GIF fixtures stayed visible after reload, and reactions remained on sender copies. The UI clearly says the demos stay on this device and nothing was sent. This does not verify authenticated account-to-account UI or hosted delivery. Photo/GIF checks used the isolated in-app browser at 855px; narrow viewports and reduced-motion mode were not exercised in that session.
- Reduced-motion GIF stills now cap their longest edge at 1600px to keep canvas and PNG data-URL memory bounded for large accepted GIFs. Dimension math has a unit test; reduced-motion browser behavior and lower-memory device performance still need verification.
- The composer’s Desk link now saves immediately before navigation, and rejecting an invalid replacement file preserves the existing attachment. A fast browser edit → Desk → reopen check retained the edit. The native file picker did not open reliably, so replacement preservation was reviewed in code but not exercised in-browser; unit tests (24/24), lint, build, and typecheck pass.
- Local account data now uses per-user storage keys for drafts, sent copies, notes, relay/location state, reactions, and media attachment IDs. The root waits for Supabase session resolution and reloads on account changes; Profile includes sign-out and signed-out views hide account-owned profile identity. Legacy unscoped data remains in the guest/device bucket, and the composer sign-in return transfers only its selected draft after a required attachment copy succeeds, remaps ID collisions, refreshes the preserved destination draft, restores missing attachments on retry without replacing existing account media, and rolls back only newly copied media when draft persistence fails. IndexedDB operations, send completion, and GPS handoffs stay pinned to the account scope that started them; replay markers are account-scoped. Unit tests (47/47), lint, typecheck, isolated production build, and local Supabase smoke pass; the local browser confirmed sign-out and retained the guest “Tiny cat test” draft. A→B→A local content/media switching and hosted OAuth remain unverified.
- `/journey` now opens a sent-relay index with a useful empty state; it excludes samples and instant drops, keeps legacy dispatched relays, sorts by activity time, and loads sender-scoped remote rows in pages. Deep links to unavailable drops show an unavailable state. The runnable suite passes 52/52 and touched TypeScript transpiles; the full suite still lacks `sharp`, and lint, typecheck, production build, and browser UI checks remain open because `/drop/node_modules` is absent.

## Git Delivery

Commit each completed code change separately with a descriptive message and push it to `https://github.com/arjeetanand/drop.git`. Keep unrelated pre-existing changes out of each commit.

## Task 1: Add the mixed-payload model with backward-compatible text defaults

**Description:** Extend the existing letter/draft model so each item can represent a text letter, image/meme, or GIF, plus its delivery mode and optional private media metadata. Keep old localStorage drafts and existing database rows readable as text.

**Acceptance criteria:**
- [x] Existing seeded letters, local drafts, and Supabase rows without a payload kind render as text drops.
- [x] New model fields are additive and existing letter content and IDs remain intact.
- [x] Mock examples cover a text drop, an image/meme, and a GIF.

**Verification:**
- [x] Run `npm run typecheck` and inspect migrated mock/local draft output.
- [x] Confirm an existing seeded letter still opens through `/letter/[id]` and retains its reveal flow.

**Dependencies:** None.

**Files likely touched:** `data/mockData.ts`, `lib/letterStore.ts`, `lib/letterBackend.ts`, a new additive SQL migration under `supabase/migrations/`.

**Estimated scope:** Medium.

## Task 2: Add private image/GIF upload and recipient-authorized reads

**Description:** Add the smallest Supabase Storage path for private image and GIF assets. Keep only the storage path and basic metadata on the drop, validate files before upload, and fetch a short-lived URL for an authorized sender or recipient.

**Acceptance criteria:**
- [x] Only the chosen image formats and GIF are accepted, with a visible size limit and upload error state.
- [x] Storage policies allow the sender and addressed recipient to read the attachment, while unrelated users cannot.
- [ ] A failed upload leaves the draft intact and does not report the drop as sent.

**Verification:**
- [x] Test upload and read with sender and recipient accounts, then verify access with an unrelated account is denied.
- [x] Local smoke confirms an exact media-finalize retry reuses the linked file and removes the duplicate staging object.
- [x] Unsupported type and over-limit files show validation errors while preserving the draft. Remote upload failure recovery still needs a configured Supabase project.

**Dependencies:** Task 1.

**Files likely touched:** `lib/letterBackend.ts`, a small media upload helper if needed, a new Supabase migration, `SUPABASE_SETUP.md`.

**Estimated scope:** Medium.

### Checkpoint: Foundation

- [x] `npm run typecheck` passes.
- [x] Legacy text data and routes still work.
- [x] Private media access works for sender/recipient only.

## Task 3: Rework mobile home, mailbox, and navigation around drops

**Description:** Reframe the core shell around sharing and receiving any supported drop. Use a mobile-first bottom bar, a clear “Make a drop” action, incoming/recent drop cards, and simple filters for inbox, sent, and drafts. Keep the optional Journey destination available without centering every send around a map.

**Acceptance criteria:**
- [x] Home and mailbox labels, cards, and empty states make sense for text and media drops.
- [x] Navigation and primary actions fit phone widths.
- [ ] Confirm bottom safe-area insets on a real device.
- [x] The existing desktop sidebar and profile access remain available at larger widths.

**Verification:**
- [x] Check home and mailbox at 360px, 390px, and 430px widths.
- [x] Confirm current prompt cards and seal-related entry points remain reachable.

**Dependencies:** Task 1.

**Files likely touched:** `app/page.tsx`, `app/mailbox/page.tsx`, `components/Sidebar.tsx`, `components/LetterCard.tsx`, `app/globals.css`.

**Estimated scope:** Medium.

## Task 4: Turn the composer into a mobile-first drop flow

**Description:** Let the sender choose a text note, image/meme, or GIF; preview it with an optional caption; choose one recipient; then send instantly by default or explicitly choose relay. Preserve existing text prompts and optional seals for letter-style drops.

**Acceptance criteria:**
- [x] The composer supports text, image/meme, and GIF previews without requiring multiple desktop-style steps on mobile.
- [x] A local draft survives navigation, and media is clearly marked as uploaded or local-only until upload succeeds.
- [x] Sending gives clear progress, success, and recovery states; instant is the default and relay is opt-in.
- [x] The sender explicitly checks the recipient handle, sees the matched account, and must reconfirm if the normalized handle changes; failed lookups leave the local draft and attachment intact.

**Verification:**
- [ ] Complete one send for each payload kind with Supabase configured.
- [ ] Confirm a failed upload or save returns the person to a recoverable draft.
- [x] Local authenticated browser flow sent a text drop to a confirmed recipient; Google OAuth and hosted behavior remain open.
- [x] Unit coverage verifies confirmation only matches the current normalized handle; local Supabase smoke verifies exact and missing handle lookup results.
- [x] Authenticated browser check confirmed a recipient handle, then verified changing it clears confirmation and disables sending.

**Dependencies:** Tasks 1–3.

**Files likely touched:** `app/compose/page.tsx`, `app/compose/address/page.tsx`, `app/compose/dispatch/page.tsx`, `lib/letterStore.ts`, media helper from Task 2.

**Estimated scope:** Medium.

### Checkpoint: Sending

- [ ] Text, image/meme, and GIF drops can be sent to one recipient.
- [ ] Instant sharing does not require location or relay setup.
- [ ] Existing prompt and seal work remains present.

## Task 5: Make received drops open in the right format and support a private reaction

**Description:** Update the existing arrival route so it renders text, image/meme, and GIF drops with the same private recipient access. Add a small set of one-tap reactions and persist the recipient’s reaction without changing the sender’s message.

**Acceptance criteria:**
- [x] Existing letter URLs continue to open and text still uses its current reveal behavior.
- [x] Media is fetched only after authorization and has an accessible text fallback.
- [x] A recipient can add or change a reaction, and the sender can see it.

**Verification:**
- [x] Opened text, image, and GIF drops as the recipient and verified the sender sees each reaction in local authenticated browser checks.
- [x] Local authenticated browser flow opened a text drop as its recipient, saved a reaction, and showed it on the sender mailbox card.
- [x] Same-device text, photo, and GIF demos render, accept a reaction, and retain the media and reaction on the sender copy after reload.
- [x] Verify an unrelated account cannot open protected content or react.

**Dependencies:** Tasks 1–4.

**Files likely touched:** `app/letter/[id]/page.tsx`, `components/LetterCard.tsx`, `lib/letterBackend.ts`, a focused migration/policy update if required.

**Estimated scope:** Medium.

## Task 6: Keep human relay optional for supported drops

**Description:** Reuse the existing relay events, maps, and handoff routes after the sender explicitly chooses “make it a journey.” Update copy and previews to support a sealed payload of any v1 kind while preserving message privacy during handoffs.

**Acceptance criteria:**
- [ ] Instant drops bypass relay screens and location requests.
- [ ] Relay-mode drops retain existing handoff and journey history behavior.
- [ ] Carriers see route/handoff information but not private message text or media.

**Verification:**
- [ ] Test an existing letter relay and a new media relay through one handoff.
- [ ] Confirm permission denial or unavailable location still allows relay handoff without precise coordinates.

**Dependencies:** Tasks 1, 4, and 5.

**Files likely touched:** `app/journey/page.tsx`, `app/relay/page.tsx`, `app/relay/carry/page.tsx`, `app/relay/handoff/page.tsx`, `app/relay/scan/page.tsx`, `components/RelayChain.tsx`, `components/TrackingTimeline.tsx`.

**Estimated scope:** Medium.

### Checkpoint: End-to-End

- [ ] Sender can create, send, and track both instant and relay-mode drops.
- [ ] Recipient can open and react to a drop on a phone-sized viewport.
- [ ] Old letter routes, saved content, and relay events remain available.

## Task 7: Tune mobile accessibility, motion, and release checks

**Description:** Polish the interaction details against the reviewed concepts: thumb-sized controls, expressive send/open feedback, readable contrast, safe-area handling, and reduced-motion support. Keep the same flow usable on desktop.

**Acceptance criteria:**
- [ ] Core controls are keyboard reachable, labeled, and at least 44px high; media has useful alt text or fallback copy.
- [ ] Motion respects `prefers-reduced-motion`, and no content is hidden behind the bottom navigation or keyboard.
- [x] Lint, typecheck, and production build all pass without removing unrelated working-tree changes.

**Verification:**
- [ ] Run `npm run lint`, `npm run typecheck`, and `npm run build`.
- [ ] Manually test 360px, 390px, and 430px mobile widths, reduced-motion mode, and one desktop width.
- [ ] Verify large-GIF reduced-motion capture on a lower-memory phone; browser testing is still needed for the actual preference branch.
- [ ] Review the final diff and verify no existing user changes were lost.

**Dependencies:** Tasks 1–6.

**Files likely touched:** `app/globals.css`, shared drop/card components, affected routes and shell components.

**Estimated scope:** Small to medium.

## Task 8: Isolate local data when accounts change

**Description:** Partition browser-local drafts and related private data by the authenticated account. Keep existing unscoped data recoverable in the guest/device bucket, wait for auth state before reading private local content, and let people sign out.

**Acceptance criteria:**
- [x] Signed-in local drafts, sent copies, journey notes, relay/location data, reactions, and attachments use account-specific storage.
- [x] Existing unscoped data stays available as guest/device data and is not shown to another signed-in account.
- [x] Signing in from the composer copies only the selected guest draft and its attachment into the new account scope.
- [x] Auth state is resolved before private routes render, and account changes reload the app under the new scope.
- [x] Profile provides sign-out and signed-out views do not display the prior account's profile identity.

**Verification:**
- [x] Unit tests cover stable, separate account namespaces and preserve the guest reaction copy.
- [x] Unit test confirms a selected guest draft copies into one account while remaining recoverable in the guest bucket.
- [x] Unit tests cover starter draft precedence, destination draft preservation, draft ID collisions, missing-attachment transfer retry and rollback, IndexedDB remapping/preservation, account changes during media operations, failed attachment transfer, collision rollback, and signed-out profile ownership.
- [x] Local browser sign-out returns to the signed-out profile.
- [ ] Switch A→B→A and verify active drafts, sent history, notes, and attachments restore only for their owner.

**Dependencies:** Tasks 1–7.

**Estimated scope:** Small.

### Checkpoint: Complete

- [ ] All acceptance criteria above pass.
- [ ] Mobile send, receive, reaction, and optional relay paths are reviewable end to end.

## Current follow-up — 2026-10-19

- [x] Mark legacy seeded inbox examples as samples, exclude them from real counts and normal mailbox filters, keep sample reactions device-only, and feature the newest real inbox drop on Home when one exists. Unit coverage and a local browser pass confirm the photo/GIF examples remain openable.
- [ ] Verify the photo/GIF send-open-react flow at a phone viewport with two disposable local accounts; hosted account verification is unavailable until a hosted Supabase project is configured.
- [x] Verify photo/GIF retry recovery with a fresh staging path; the server reuses the committed object only when its MIME type, size, and bytes match.
- [x] Verify existing-drop lookup failures stop media finalization with a retryable response before writing the final object.
- [x] Sending feedback names the selected note, photo, or GIF and announces the in-progress label through a polite live region.
