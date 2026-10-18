# Implementation Tasks: Mobile Drop Experience

Tasks are ordered by dependency. Progress is recorded at each tested and pushed checkpoint.

## Current Checkpoint — 2026-10-18

- The foundation, mobile drop flow, draft handoff, secure relay, and reduced-motion GIF work are pushed separately: `04cc01f`, `047c6b9`, `b062dbe`, `6b43271`, and `4f38e0e`.
- Follow-up commits are pushed: `27db56c` restricts letter update/delete access to unsent rows and uses insert-once sends; `0190b7d` routes relay invites through the secure passport; `59988d0` adds a local recipient preview.
- Verification now passes `npm test` (24/24), lint, typecheck, and the default Next.js/Turbopack production build. Browser checks confirmed no horizontal overflow at 360px, 390px, and 430px on the desk, profile, and mailbox; the composer preview was checked at 390px. A photo draft survived the account-options detour and reload, and a GIF preview loaded at 390px.
- The new recipient preview was checked in-browser for text, recipient handle, sign-off, and return-to-edit persistence. Local PNG and GIF attachments saved in IndexedDB and appeared in the recipient view; the GIF remained available after a page reload. Unsupported and over-8 MB fixtures showed visible errors while the draft text remained. The home prompt, note sign-off choices, and seeded `/letter/1` reveal flow remain reachable. The relay send CTA was checked through to the passport, including its sign-in requirement without Supabase credentials. A local PostgreSQL transaction confirmed sent letters cannot be changed or deleted by the sender, while an unsent draft can still be sent; the transaction rolled back. The latest scratch production build includes `/compose/preview`.
- Relay handoffs now use short-lived server-issued capabilities; the migration keeps carrier access to route details and excludes message text/media. The Supabase migration is not deployed here, and there is no Supabase configuration in this environment, so OAuth, real account-to-account send/media/reaction, and cross-device handoff still need a configured project. The local PostgreSQL policy smoke test does not verify the migration or storage policies in Supabase. The browser setup also could not emulate `prefers-reduced-motion`; that branch was reviewed but not exercised in-browser.
- A disposable local PostgreSQL smoke test now applies the sent-letter, media, and integrity migrations together. It confirms draft edits remain available, sender updates cannot promote or change sent drops, linked media cannot be deleted, unlinked upload cleanup still works, and sender/recipient media reads stay allowed while unrelated reads are denied. The SQL changes are not yet applied to a hosted Supabase project.
- A second disposable PostgreSQL smoke test now covers relay pass issuance, sender authorization, one-time handoff and exact retry recovery, carrier-pass rotation and revocation, coordinate-free and coordinate-bearing handoffs, participant-only route reads, and private token-table denial. The script and repeatable command are documented in `SUPABASE_SETUP.md`; hosted RPC behavior remains unverified.
- The relay regression check now hands off a private GIF drop without coordinates and confirms the carrier RPC result omits message text and media metadata. The browser QR/manual flow and hosted RPC behavior still need verification.
- A signed-out recipient opening a shared drop now gets a sign-in action that returns to the same drop. The local browser check verified the encoded return URL, the account section link, and the return link label/navigation. Google OAuth itself remains unverified without the configured Supabase project.
- Recipient preview now uses the saved text size and alignment and shows the local sender name. A browser check set 20px/right alignment and confirmed both styles, the sender/recipient line, and the not-sent preview notice. The temporary note content was cleared and the seeded draft restored.
- Recipient handles now show local format feedback, expose `aria-invalid`/help text, and only satisfy the send completeness check when the existing handle validator accepts them. An isolated browser check confirmed a one-character handle errors and a valid handle clears the error; no recipient lookup runs while typing.
- Received drops with a known sender handle now offer an optional “Drop back” action that opens a fresh, addressed draft. The local seeded sender-to-composer flow was checked in-browser; no message was copied or sent. The Supabase profile join for sender handles still needs verification against a configured project.
- Mailbox filters are now exposed as a labeled group of toggle buttons instead of an incomplete tab pattern. Browser checks confirmed the pressed state changes for Sent and Drafts and that Tab plus Return operates the filters.
- Reactions on seeded demo drops now persist in this browser and appear on the mailbox card after leaving the detail view or reloading. Browser check selected 🫶, observed the “Saved on this device” disclosure, then confirmed “Reacted 🫶” on the mailbox card after navigation and reload; it does not notify a sender.
- Signed-in mailbox loading now fetches participant-visible reaction rows and shows “They reacted {emoji}” on sent cards. A focused mapping test covers matching and non-matching drops; the local policy smoke test verifies only the recipient can write/change a reaction while both participants can read it and an unrelated user can neither read nor write it. Hosted account behavior remains unverified.
- The recipient route now consistently calls the shared item a drop, including loading, reveal, and detail copy. A browser check opened a seeded received drop and confirmed the revised labels; route URLs and internal letter IDs are unchanged.
- Sending now reconciles an existing draft ID before retrying and after ambiguous insert failures. It only recovers a saved drop when sender, recipient, content, subject, seal, mode, status, and media bytes match, then reuses the original media path and send time. Pure matching and binary comparison tests cover exact retries and changed drafts; live Supabase timeout recovery remains unverified without project credentials.
- Media captions are now prompted as descriptions, and visible captions serve as the text alternative without being announced twice; uncaptained media keeps a fallback image label. A local photo draft was checked in the composer and recipient preview with and without a caption.
- Browser checks confirmed the desk, mailbox, composer, recipient preview, and opened received drop have no horizontal overflow at exact 360px, 390px, and 430px CSS widths. Composer typography and seal-color controls measure 44px. Exact mobile keyboard/safe-area behavior, reduced-motion browser behavior, and real-device accessibility remain unverified; preview mode still blocks real cloud sending until remote persistence is configured.
- A same-device instant demo now completes text preview → recipient reveal → reaction → sender copy. The reaction remains after reload, the mailbox card says “Demo · not sent” and “On this device,” and the Sent filter/count exclude it. This does not verify photo/GIF demo rendering or any hosted delivery. The smoke test used an isolated local browser profile at its default viewport.
- The composer’s Desk link now saves immediately before navigation, and rejecting an invalid replacement file preserves the existing attachment. A fast browser edit → Desk → reopen check retained the edit. The native file picker did not open reliably, so replacement preservation was reviewed in code but not exercised in-browser; unit tests (24/24), lint, build, and typecheck pass.

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
- [ ] Storage policies allow the sender and addressed recipient to read the attachment, while unrelated users cannot.
- [ ] A failed upload leaves the draft intact and does not report the drop as sent.

**Verification:**
- [ ] Test upload and read with the sender account, then verify access with an unrelated account is denied.
- [x] Unsupported type and over-limit files show validation errors while preserving the draft. Remote upload failure recovery still needs a configured Supabase project.

**Dependencies:** Task 1.

**Files likely touched:** `lib/letterBackend.ts`, a small media upload helper if needed, a new Supabase migration, `SUPABASE_SETUP.md`.

**Estimated scope:** Medium.

### Checkpoint: Foundation

- [ ] `npm run typecheck` passes.
- [ ] Legacy text data and routes still work.
- [ ] Private media access works for sender/recipient only.

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

**Verification:**
- [ ] Complete one send for each payload kind with Supabase configured.
- [ ] Confirm a failed upload or save returns the person to a recoverable draft.

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
- [ ] Media is fetched only after authorization and has an accessible text fallback.
- [ ] A recipient can add or change a reaction, and the sender can see it.

**Verification:**
- [ ] Open a text, image, and GIF drop as the recipient and verify the sender sees the reaction.
- [ ] Verify an unrelated account cannot open protected content or react.

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
- [ ] Review the final diff and verify no existing user changes were lost.

**Dependencies:** Tasks 1–6.

**Files likely touched:** `app/globals.css`, shared drop/card components, affected routes and shell components.

**Estimated scope:** Small to medium.

### Checkpoint: Complete

- [ ] All acceptance criteria above pass.
- [ ] Mobile send, receive, reaction, and optional relay paths are reviewable end to end.
