# Implementation Tasks: Mobile Drop Experience

Tasks are ordered by dependency. Progress is recorded at each tested and pushed checkpoint.

## Current Checkpoint — 2026-10-18

- The foundation, mobile drop flow, draft handoff, secure relay, and reduced-motion GIF work are pushed separately: `04cc01f`, `047c6b9`, `b062dbe`, `6b43271`, and `4f38e0e`.
- Follow-up commits are pushed: `27db56c` restricts letter update/delete access to unsent rows and uses insert-once sends; `0190b7d` routes relay invites through the secure passport; `59988d0` adds a local recipient preview.
- Verification now passes `npm test` (11/11), lint, typecheck, and the default Next.js/Turbopack production build in an isolated scratch copy. Browser checks confirmed no horizontal overflow at 360px, 390px, and 430px on the desk, profile, and mailbox; the composer preview was checked at 390px. A photo draft survived the account-options detour and reload, and a GIF preview loaded at 390px.
- The new recipient preview was checked in-browser for text, recipient handle, sign-off, and return-to-edit persistence. Local PNG and GIF attachments saved in IndexedDB and appeared in the recipient view; the GIF remained available after a page reload. Unsupported and over-8 MB fixtures showed visible errors while the draft text remained. The home prompt, note sign-off choices, and seeded `/letter/1` reveal flow remain reachable. The relay send CTA was checked through to the passport, including its sign-in requirement without Supabase credentials. A local PostgreSQL transaction confirmed sent letters cannot be changed or deleted by the sender, while an unsent draft can still be sent; the transaction rolled back. The latest scratch production build includes `/compose/preview`.
- Relay handoffs now use short-lived server-issued capabilities; the migration keeps carrier access to route details and excludes message text/media. The Supabase migration is not deployed here, and there is no Supabase configuration in this environment, so OAuth, real account-to-account send/media/reaction, and cross-device handoff still need a configured project. The local PostgreSQL policy smoke test does not verify the migration or storage policies in Supabase. The browser setup also could not emulate `prefers-reduced-motion`; that branch was reviewed but not exercised in-browser.
- The in-app browser ignored viewport overrides and remained at 765 CSS pixels, so the recipient preview route still needs checks at exact 360px, 390px, and 430px widths. Exact mobile keyboard/safe-area behavior, reduced-motion browser behavior, and real-device accessibility remain unverified. The preview correctly keeps sending unavailable until remote persistence is configured.

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
