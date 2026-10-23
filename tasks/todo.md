# Implementation Tasks: Mobile Drop Experience

Tasks are ordered by dependency. Progress is recorded at each tested and pushed checkpoint.

## Checkpoint notes through — 2026-10-19

- Added passwordless email-link sign-in alongside Google. Both disposable accounts signed in and synced profiles through local Supabase/Inbucket. `npm test` passes 70/70, lint passes, and a clean Next.js 16.3 production build passes. The two-account photo/GIF composer send-open-react flow remains unverified because the in-app browser did not open its file chooser; Edge's ChatGPT extension needs “Allow access to file URLs” enabled for this local test. No hosted Supabase project or SMTP is configured.
- At 390px in Edge, the composer selected the bundled PNG and GIF fixtures through the normal file picker, previewed each as the recipient, opened each same-device demo, saved a reaction, and showed it on the sender copy. This verifies local draft/demo behavior only; the two sent demo records remain in browser storage because sent demos cannot be deleted in the UI. Hosted account-to-account delivery remains unverified.
- Generic user-facing relay, fallback, route-map, and accessible-label copy now uses “drop.” Internal schema names, query parameters, and `/letter` routes remain unchanged for compatibility. `npm test` passes 70/70, lint and typecheck pass, and the isolated Webpack production build passes.
- The composer suggests up to five unique people from the latest 100 sent drops and rechecks a handle when selected. Unit tests pass (70/70), lint, typecheck, the local Supabase recipient-query smoke check, and the Webpack production build. Browser checks found no horizontal overflow at 360px, 375px, 390px, or 430px; the signed-in suggestions row and hosted OAuth remain unverified without a connected account or hosted project.
- The foundation, mobile drop flow, draft handoff, secure relay, and reduced-motion GIF work are pushed separately: `04cc01f`, `047c6b9`, `b062dbe`, `6b43271`, and `4f38e0e`.
- Follow-up commits are pushed: `27db56c` restricts letter update/delete access to unsent rows and uses insert-once sends; `0190b7d` routes relay invites through the secure passport; `59988d0` adds a local recipient preview.
- Verification passes `npm test` (47/47), lint, typecheck, and an isolated scratch Next.js/Webpack production build after the account-isolation fixes. Browser checks confirmed no horizontal overflow at 360px, 390px, and 430px on the desk, profile, and mailbox; the composer preview was checked at 390px. A photo draft survived the account-options detour and reload, and a GIF preview loaded at 390px.
- The new recipient preview was checked in-browser for text, recipient handle, sign-off, and return-to-edit persistence. Local PNG and GIF attachments saved in IndexedDB and appeared in the recipient view; the GIF remained available after a page reload. Unsupported and over-8 MB fixtures showed visible errors while the draft text remained. The home prompt, note sign-off choices, and seeded `/letter/1` reveal flow remain reachable. The relay send CTA was checked through to the passport, including its sign-in requirement without Supabase credentials. A local PostgreSQL transaction confirmed sent letters cannot be changed or deleted by the sender, while an unsent draft can still be sent; the transaction rolled back. The latest scratch production build includes `/compose/preview`.
- Relay handoffs now use short-lived server-issued capabilities; the migration keeps carrier access to route details and excludes message text/media. The migrations are not deployed because no hosted Supabase project exists, so hosted OAuth, account-to-account send/media/reaction, and cross-device handoff remain unverified. The local PostgreSQL policy smoke test does not verify hosted Storage policies. The browser setup also could not emulate `prefers-reduced-motion`; that branch was reviewed but not exercised in-browser.
- A pinned Supabase CLI and local-only config now reproduce the Supabase stack. The first reset exposed duplicate migration version prefixes; after assigning unique ordered versions, `npm run supabase:reset` applied every migration cleanly. Local authenticated text send/open/react now passes in the browser; Google OAuth, media UI delivery, and hosted behavior remain open.
- A disposable local three-account smoke test now covers authenticated text insert/read, recipient-only reaction writes, outsider denial, validated GIF staging/finalization, exact finalize retries that reuse the linked file and remove duplicate staging data, sender/recipient-only media downloads and signed URLs, unique-handle conflicts, and duplicate first-use inserts that leave existing profiles unchanged. It cleans up its accounts/media and refuses non-loopback projects. Hosted OAuth and hosted project behavior remain open.
- A local authenticated browser pass sent a text drop to a confirmed handle, revealed and opened it as a second account, saved a 🫶 reaction, and confirmed it on the sender mailbox card. Both disposable local accounts and the database drop/reaction were removed afterward; the browser keeps a local sent-copy history item. Google OAuth and hosted delivery remain unverified.
- A separate local browser pass received admin-seeded PNG/GIF drops as the recipient, opened both, confirmed each image rendered with descriptive alt text, saved 🫶/🥹 reactions, and confirmed both on the sender mailbox. The disposable accounts, rows, reactions, and media files were removed. The in-app browser file chooser did not open in that pass, so composer media upload remained unverified then; its viewport bottomed out at 471 CSS px, leaving the 390px check open. The browser retains the local test draft “Tiny cat test”; the app’s delete action applies only to eligible unsent drafts, not sent demos.
- Mobile navigation now remains in the shared shell on compose, letter detail, and relay routes; active tabs map to the nearest clear section, while ambiguous letter details stay neutral. Route tests pass (2/2). Brave rendered the composer at 433 CSS px with all five navigation destinations and the photo/GIF controls visible; document and body widths (425/426px) stayed within the viewport. Exact 390px, keyboard, opened-drop/relay browser, and real-device safe-area checks remain open.
- A missing recipient now has a privacy-safe invite path to `/invite`; it explains that the sender still needs the recipient’s handle and never includes the draft in the shared URL or text. The composer saves first and reports shared, copied, cancelled, or unavailable outcomes. Share tests pass (5/5), syntax checks pass, and the runnable suite passes (64/64) excluding the existing `sharp`-dependent media-validation test. Browser share-sheet, unknown-handle, and attachment-preservation checks remain open.
- Store-level A→B→A tests now confirm account-scoped drafts, sent copies, journey notes, and attachments restore only for their owner; the runnable suite passes (66/66) excluding the existing `sharp`-dependent media-validation test. A real authenticated browser account-switch check remains open.
- Drop dependencies now install using an isolated npm cache. Fixed nullable guest-account attachment deletion and narrowed the active-draft fallback; full tests pass (69/69), lint, typecheck, and production build pass. Edge opened `/compose`, but its debugger did not attach and a fresh-tab navigation timed out; Edge-specific browser checks remain open, and no Edge permissions were changed.
- The fresh Brave QA tab reported no console logs; an earlier tab surfaced an invalid refresh-token error. The browser file-chooser event timed out before a fixture could be selected. The ChatGPT extension’s Edge file-URL permission change was blocked by browser safety review; one blank, unsent photo draft created for this test remains local, and the pre-existing draft was left untouched. A later Edge pass succeeded through the normal file picker at 390px.
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
- [x] Bottom navigation remains available through compose, opened-drop, and relay routes with an accurate current-tab indication.
- [ ] Confirm bottom safe-area insets on a real device.
- [x] The existing desktop sidebar and profile access remain available at larger widths.

**Verification:**
- [x] Check home and mailbox at 360px, 390px, and 430px widths.
- [x] At 360px, 390px, and 430px, confirm the bottom navigation stays visible on compose, an opened sample drop, and relay; Desk and Journey receive the expected current-page state, drop detail stays neutral, and there is no horizontal overflow or console warning/error.
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
- [x] Choosing an incompatible format preserves the saved attachment and explains how to remove it; the photo flow and reload recovery pass in the local browser.
- [x] The sender explicitly checks the recipient handle, sees the matched account, and must reconfirm if the normalized handle changes; failed lookups leave the local draft and attachment intact.
- [x] A confirmed not-found result offers a generic `/invite` link without draft content; the composer saves before sharing and does not mark the drop sent.
- [x] The composer surfaces account readiness and asks who receives the drop before showing payload and styling controls; draft/send behavior stays in the existing flow.

**Verification:**
- [ ] Complete one send for each payload kind with Supabase configured.
- [ ] Confirm a failed upload or save returns the person to a recoverable draft.
- [ ] At phone width, test unknown-handle invite, native-share cancel, copy fallback, and draft/media recovery.
- [x] Local authenticated browser flow sent a text drop to a confirmed recipient; Google OAuth and hosted behavior remain open.
- [x] Unit coverage verifies confirmation only matches the current normalized handle; local Supabase smoke verifies exact and missing handle lookup results.
- [x] Authenticated browser check confirmed a recipient handle, then verified changing it clears confirmation and disables sending.
- [ ] Recheck the recipient-first composer in a rendered browser at 360px, 390px, and 430px; browser automation is unavailable in this environment.

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
- [x] Active carriers see their route/handoff history without private message, media, or exact location data.
- [x] QR and manual PIN handoffs request current device location only after a clear, unchecked-by-default opt-in; manual neighborhood entry remains available.
- [x] Remove third-party reverse geocoding from the relay handoff flow; successful-handoff location outcomes are announced to screen readers.
- [x] New server-issued carrier invite links keep the bearer token in the URL fragment; previously issued query-token links remain compatible and are cleaned from the address bar when opened.

**Verification:**
- [ ] Test an existing letter relay and a new media relay through one handoff.
- [x] Unit coverage verifies denied/unavailable location and confirms manual and QR handoffs do not invent coordinates.
- [x] A capability-gated route RPC returns only names, neighborhoods, carrier notes, and timestamps; SQL coverage checks active, consumed, and invalid tokens plus private-data exclusions.
- [x] Playwright/Chrome on a 390px viewport verified QR with location unchecked, opted in, and denied; manual PIN with location opted in; and token invite with a manual neighborhood. It observed zero geocoder requests and no page runtime errors. The fixture used synthetic handoff data.
- [x] Focused URL tests confirm newly issued carrier tokens are outside the query string and old query-token invites still resolve.
- [ ] Legacy `?d=` QR links still contain the previous carrier's coordinates and send them to Drop when opened. Existing payloads cannot be safely converted without their original server-issued credential; issue a fresh secure invite for future handoffs.
- [ ] Browser end-to-end check: complete a valid carrier-issued handoff with location denied or unavailable.

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
- [x] At the bottom of the opened sample drop, its content ends 34px above the fixed navigation at 360px, 390px, and 430px; phone-keyboard and real-device safe-area behavior remain open.
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
- [x] Store-level A→B→A tests verify active drafts, sent history, notes, and attachments restore only for their owner.
- [ ] In an authenticated browser session, switch A→B→A and verify those records restore only for their owner.

**Dependencies:** Tasks 1–7.

**Estimated scope:** Small.

### Checkpoint: Complete

- [ ] All acceptance criteria above pass.
- [ ] Mobile send, receive, reaction, and optional relay paths are reviewable end to end.

## Current follow-up — 2026-10-19

- [x] The global skip link now moves keyboard focus to its content target. Browser check confirmed Tab → Enter changes focus to `#main-content`; W3C technique G1 calls for this behavior: https://www.w3.org/WAI/WCAG21/Techniques/general/G1.
- [x] Tailwind now defines the `min-h-9/11/12` utilities used by existing controls; Edge at 390px confirms the composer profile link is 44px and no visible composer control is below 44px.
- [x] Verified port 54321 is Colima's local forwarder for this repo's `drop` Supabase containers; `supabase status` reports the local API and database endpoints.
- [x] `npm run test:local-supabase` passed against that local stack: three disposable accounts authenticated, text access and reaction policies passed, unrelated access was denied, and GIF finalization plus exact retry passed. Cleanup completed without a warning.
- [x] Mark legacy seeded inbox examples as samples, exclude them from real counts and normal mailbox filters, keep sample reactions device-only, and feature the newest real inbox drop on Home when one exists. Unit coverage and a local browser pass confirm the photo/GIF examples remain openable.
- [x] Verified photo/GIF send-open-react through the composer at a 390px viewport with two disposable local accounts: both media types appeared in the recipient inbox, opened from the sealed state, and accepted a persisted reaction. The PNG loaded at 1448×1086. Removed the two local accounts, their drops/reactions/media, and only their four Mailpit sign-in messages; no hosted project was used.
- [x] Verify photo/GIF retry recovery with a fresh staging path; the server reuses the committed object only when its MIME type, size, and bytes match.
- [x] Verify existing-drop lookup failures stop media finalization with a retryable response before writing the final object.
- [x] Sending feedback names the selected note, photo, or GIF and announces the in-progress label through a polite live region.
- [x] Add confirmed, account-scoped deletion for unsent local drafts and their saved media; tests cover history cleanup, replacement drafts, sample/sent protection, account isolation, and localStorage rollback. Composer UI and media-cleanup rollback still need browser verification.
- [x] Relay carrier links use the native share sheet where available and clipboard fallback elsewhere; tests cover share, cancellation, fallback, and unavailable states. Device share-sheet behavior still needs browser verification.
- [x] Replace opaque email-link network/response parsing errors with a clear retry message while preserving actionable Supabase Auth API errors; covered by three focused tests and shipped in `6cc9873`.
- [x] Verified invite email sign-in, profile save/sync, and share-back in Edge against the loopback Supabase stack. A disposable account completed `/invite` → `/profile?invite=1` → synced handle → share-back; the copied payload contained only `@handle` and the local public `/u/<handle>` URL. Checked the flow at 360px and 390px, then removed the exact Auth user/profile and Mailpit message. No hosted project was used.
- [x] Restricted public profile reads to username, display name, and bio; account metadata stays owner-only. Local Supabase smoke checks anonymous grants, signed-in owner scoping, recipient lookup, and mailbox sender embedding. `npm test` passes 81/81, lint, typecheck, and production build pass.

## Current follow-up — 2026-10-22

- [x] Save a stable media upload ID with each selected attachment and reuse it when a draft resumes or retries.
- [x] Recover an unlinked final object after a lost response only when its bytes match the freshly validated retry; reject different media for a linked draft and attempt to remove its new staging object.
- [x] Add regression coverage for lost-response recovery, one final object, staged cleanup on a linked-media conflict, and draft upload-ID persistence.
- [x] Verification passed in an isolated checkout using the same commit and lockfile: `npm test` (84/84), lint, typecheck, `npm run build -- --webpack`, local smoke-script syntax, `bash -n run.sh`, and `git diff --check`.
- [x] Exercise `run.sh` start/restart/stop and confirm the home and compose routes return HTTP 200 in the isolated checkout; the active checkout still needs its locked dependencies installed before it can run locally.
- [ ] Run the authenticated local Supabase smoke and test a real lost-response retry in the browser. The local auth health endpoint on `127.0.0.1:54321` was unavailable; no local database was started or reset, and no hosted project exists.

## Current follow-up — 2026-10-22 (reaction privacy and mobile sizing)

- [x] Explain that live reactions are visible only to the sender and recipient, matching the participant-only Supabase read policy; distinguish device-only sample and demo reactions.
- [x] Keep all five reaction controls in one row with 44px minimum targets and 8px gaps. At 360px, the row is 252px wide and each button measures 44×44px; at 390px and 430px the buttons grow, with no horizontal overflow.
- [x] Playwright/Chrome opened a sample drop, saved a reaction, and confirmed device-only status at 360px, 390px, and 430px. The only console error was the browser's automatic request for missing /favicon.ico; no page runtime errors occurred.
- [x] npm test passes (84/84), lint and typecheck pass, and the Webpack production build passes with the test font mock. Turbopack could not build the isolated copy because its node_modules symlink points outside the filesystem root.
- [x] Push commit e18dda6 on ux/reaction-spacing-8px to origin.
- [x] Install locked dependencies in the active GitHub clone, rerun the project checks there, and serve that checkout from run.sh on port 4004; the three-width browser flow passes against it.
- [x] npm ci reported 15 audit advisories (1 moderate, 13 high, 1 critical); dependency versions were left unchanged.
- [ ] Check keyboard interaction, reduced-motion behavior, desktop layout, and real-device safe areas; hosted account-to-account behavior remains open.

## Current follow-up — 2026-10-23 (live sender reaction feedback)

- [x] Add a private sender-scoped reaction Broadcast containing only the drop ID; reload the participant-visible reaction through RLS.
- [x] Keep Home, Mailbox, and an open sent-drop page current; suppress baseline and duplicate reactions and announce changes accessibly.
- [x] Prevent a recipient from moving a reaction to a different drop; add SQL regression coverage for the rejected move.
- [x] `npm test` passes 107/107, `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`, `bash -n run.sh`, and `git diff --check` pass. Local `/`, `/mailbox`, `/letter/incoming-1`, `/compose`, and `/journey` return HTTP 200 on port 4004.
- [x] Commit `9c375a1` is pushed to `feat/live-reaction-feedback`. The local GitHub clone already has `.env.local` at mode 600; it is ignored by Git, so there was nothing to copy from OneDrive. The former OneDrive Drop directory is absent, and `/letter` remains untouched.
- [ ] Run `tests/db/drop_reaction_broadcast.sql` against a disposable local database; Docker and temporary PostgreSQL startup are unavailable in this environment.
- [ ] Verify mobile/desktop rendering and screen-reader behavior in a browser, then verify cross-account reactions after a Free hosted Supabase project is available.

## Current follow-up — 2026-10-23 (relay acceptance retry recovery)

- [x] Persist the same relay request ID and exact carrier details in tab-scoped storage, keyed by a SHA-256 fingerprint of the invite and active local account.
- [x] Restore and lock those details after refresh, expire saved attempts after 24 hours, and clear them only after the local carrier pass is saved.
- [x] Add regression tests for key scoping, exact retry restoration, expiry and malformed data cleanup, and unavailable browser storage.
- [x] npm test passes 113/113; lint, typecheck, Webpack production build, bash -n run.sh, and git diff --check pass. The app restarted on port 4004 and /, /relay/scan, and /relay/handoff returned HTTP 200.
- [ ] Verify an interrupted acceptance and page refresh in a rendered browser against local Supabase; browser automation and local Supabase are unavailable in this session.

## Current follow-up — 2026-10-23 (mailbox filter empty states)

- [x] Add distinct empty-state copy and next steps for All, Samples, On a journey, Received, Sent, and Drafts. Received directs people to profile handle setup; in-transit drops direct to the relay composer.
- [x] Announce empty search results politely and clear the query while preserving the selected filter; whitespace-only queries count as empty.
- [x] `npm test` passes 118/118, `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build -- --webpack`, `bash -n run.sh`, and `git diff --check` pass. `/`, `/mailbox`, `/profile`, and `/compose?new=1&mode=relay` return HTTP 200 on port 4004.
- [x] Isolated Chrome verified no horizontal overflow at 360px, 390px, and 430px, confirmed the Received search-empty announcement and filter-preserving clear action, and followed the transit action to the relay composer.
- [x] Code commit `10efead` is pushed to `origin/feat/mailbox-filter-empty-states`. This documentation update is committed separately.
- [x] The old OneDrive `projects/drop` directory is absent from the synced path and connected folder listing. The local clone already has ignored `.env.local` at mode 600, so no file copy was needed; no secret values were read. The `/letter` folder was not changed.
- [ ] Verify screen-reader announcements and real-device keyboard/safe-area behavior. Hosted account-to-account delivery and broader Drop acceptance remain open.

## Current follow-up — 2026-10-23 (mailbox search focus and local checkout)

- [x] Return focus to the search input after either clear action while preserving the selected mailbox filter.
- [x] Hide the native WebKit search cancel control to prevent a duplicate clear icon beside Drop's accessible button.
- [x] Run 118 unit tests, lint, TypeScript, and `git diff --check`; all pass.
- [x] Build in an isolated copy with Next.js Google Fonts responses mocked because sandbox DNS could not resolve `fonts.googleapis.com`.
- [x] Confirm `/` and `/mailbox` return HTTP 200 on the local app at port 4004.
- [x] Confirm the OneDrive Drop directory is absent and `.env.local` already exists in the local clone with mode 600 and Git ignore coverage; preserve `/letter`.
- [ ] Capture a final browser screenshot after the native clear-control rule; the isolated Chrome launch exited with code 134. Screen-reader and real-device checks remain open.

## Current follow-up — 2026-10-23 (recipient invite recovery and send receipt)

- [x] Persist shared, copied, cancelled, and unavailable invite outcomes with the account's draft; migrate the older local invite reminder shape.
- [x] Keep a manual invite link available after an unavailable retry is cancelled, including when the draft is reopened; announce the retry in progress and show the next action on the mailbox card.
- [x] Scope asynchronous invite results to the account, draft, and current handle. A successful send only marks the exact submitted composition sent; newer same-draft edits remain drafts.
- [x] Add store regressions for every invite outcome, restored manual-link availability, account and recipient scoping, sent-copy persistence, and concurrent draft edits.
- [x] `npm test` passes 126/126; lint, TypeScript, Webpack production build, `bash -n run.sh`, and diff checks pass. `/compose?new=1` returns HTTP 200 on port 4004.
- [x] Code commit `c1d57e0` and its separate README/checklist/handoff commit are pushed to `origin/feat/draft-invite-progress`. The active clone is `/Users/arjeetanand/projects/drop`; `.env.local` was already present, mode 600, ignored, and untracked. The former OneDrive Drop directory is absent, so no file was moved or deleted; `/letter` was not changed.
- [ ] Verify share/cancel/reopen behavior in a rendered browser, screen reader, and real device. Hosted account-to-account invite/send checks remain open until the Free Drop Supabase project is available.
