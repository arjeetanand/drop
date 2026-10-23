# Implementation Tasks: Mobile Drop Experience

Tasks are ordered by dependency. Progress is recorded at each tested and pushed checkpoint.

## Current Checkpoint — 2026-10-24 (No-sign-in Home photo/GIF demo)

- [x] Add a Home entry and demo chooser that take a visitor into the existing recipient reveal, reaction, and sender-copy journey without sign-in or a handle.
- [x] Keep demo media local, preserve the active draft, and bind media save/rollback to the account captured before the sample fetch; add account-switch regression checks.
- [x] Verify 241/241 tests, lint, no-incremental TypeScript, Webpack production build, browser-smoke syntax, and `git diff --check`.
- [x] Isolated Chrome smoke passes the keyboard Home action and complete GIF/reaction/reload/sender-copy flow at 390×844; Home and chooser have no horizontal overflow at 360, 390, or 430px. No Auth, RPC, or Storage-write request occurred.
- [x] Code commits `8c44f1c` and `74db67a` are pushed to `origin/feat/home-demo-drop`.
- [x] Reconfirm the 30-day deletion choice for valid abandoned staging uploads; the existing migration already implements this cutoff, so no retention code changed here.
- [ ] Verify hosted account-to-account sends, actual 30-day Storage deletion, screen-reader behavior, and physical-device keyboard/safe-area behavior when the approved project and devices are available.

## Current Checkpoint — 2026-10-24 (Unknown-handle photo/GIF claims)

- [x] Extend the local Auth/Storage smoke and rollback-only SQL fixture to cover photo and GIF invites before profile setup, after profile setup but before explicit claim, and after claim. Sender/claimant access and outsider denial are asserted; staged/final media cleanup stays on Supabase Storage APIs.
- [x] `npm test` passes 237/237; lint, no-incremental TypeScript, smoke-script syntax, and `git diff --check` pass. Code commit `adc648b` is pushed to `origin/test/unknown-handle-media-claim-smoke`.
- [ ] Run the local smoke and SQL fixture against an isolated configured runtime. The configured loopback API port is owned by an SSH process, PostgreSQL at 54322 is not listening, and disposable PostgreSQL startup failed at System V shared-memory allocation. No hosted resource was contacted.
- [ ] Verify the rendered sign-in/claim journey and real 30-day Storage cleanup when browser tooling and the approved Free Supabase project are available.

## Current Checkpoint — 2026-10-22 (Live inbox arrival)

- [x] Home and Mailbox refresh the inbox when a private recipient-scoped broadcast arrives, then read drop data through the existing RLS query; a visible-tab 60-second refresh recovers missed signals.
- [x] Home marks the featured new drop without adding a third copy of the arrival cue; Mailbox gives a direct-open and dismiss action. Burst arrivals are counted, and drafts/sealed rows do not trigger cues.
- [x] A broadcast during an in-flight fetch queues one follow-up sync, and a signaled row in the first inbox response is still announced. `npm test` passes 101/101, lint and TypeScript pass, `git diff --check` is clean, and `npm run build -- --webpack` passes.
- [ ] Apply `20261022100000_drop_inbox_broadcast.sql` and verify two separate accounts against the Free Supabase project; no hosted Drop project or running local Supabase service is available yet.
- [ ] Check rendered Home/Mailbox layouts at phone and desktop sizes and verify screen-reader announcements when a browser runtime is available.

## Current Checkpoint — 2026-10-22 (Live relay route)

- [x] Sender relay and journey views refresh route state immediately, every 15 seconds while visible, and on tab return; manual refresh has loading, success, and saved-route error states.
- [x] Empty journeys say they are waiting for the first carrier; expired invites hide QR/copy controls, announce expiry once, and offer a replacement.
- [x] Added a focused regression for refresh lifecycle and request coalescing; `npm test` passes 93/93, lint, TypeScript, and the production build pass.
- [x] Added a Supabase migration and SQL regression for participant route reads and hidden handoff token/idempotency columns.
- [x] Executed the SQL regression against a throwaway PostgreSQL cluster in `/private/tmp`; it passed and did not touch Supabase.
- [ ] Check the rendered route screens at phone and desktop sizes when a browser runtime is available; hosted account-to-account verification remains open because no hosted Drop project exists.

## Current Checkpoint — 2026-10-22

- Local Supabase Auth now allows Drop callbacks on the documented 4004, 5004, and 6004 ports for loopback hosts, while retaining port 3000. The focused redirect test, all 86 unit tests, lint, and TypeScript checks pass.
- Reloading local Supabase and completing email-link sign-in remain pending because no local services are running in this environment. Hosted Supabase account-to-account verification is also still open.
- The OneDrive `projects/drop` folder is absent. The active clone at `/Users/arjeetanand/projects/drop` already has the ignored `.env.local`; no secret was staged.

## Previous Checkpoint — 2026-10-18

- The mixed-payload/private-media foundation is pushed as `04cc01f`. The mobile-first desk, inbox, composer, and received-drop/reaction UI are implemented and locally verified: 3 unit tests, lint, typecheck, production build, plus browser checks at 463px and desktop width.
- Media finalization validates decoded image bytes server-side, strips source metadata by re-encoding, and binds new rows to their exact storage object metadata. Unit checks and the local Postgres policy smoke test pass; hosted Supabase account-to-account verification remains open.
- Remote account-to-account send, media access, and reactions still need a configured Supabase project and applied migrations. Relay handoffs currently use the existing browser-local store, so shared multi-device relay behavior remains future work. The in-app browser clamps mobile width to 463px, so exact 360px, 390px, and 430px checks are pending.

## Git Delivery

Commit each completed code change separately with a descriptive message and push it to `https://github.com/arjeetanand/drop.git` after verification. Keep `/letter` read-only, and never stage environment secrets or generated output.

## Task 0: Set up the new Drop repository and isolated app baseline

**Description:** Use the existing empty private `arjeetanand/drop` repository and copy the Letter app into `/drop` as a separate working project. Preserve the plan files in this folder, exclude secrets/build output/dependencies, and never edit files in `/letter`.

**Acceptance criteria:**
- [ ] `/drop` has its own `main` branch and `origin` points to `https://github.com/arjeetanand/drop.git`.
- [ ] App source and the existing prompt/seal work are copied into `/drop`; `/letter` remains unchanged.
- [ ] No environment secrets, dependency directories, or build artifacts are tracked.
- [ ] The baseline lint, typecheck, and build results are recorded before the import commit is pushed.

**Verification:**
- [ ] Check the staged file list and secret exclusions.
- [ ] Run `npm run lint`, `npm run typecheck`, and `npm run build` in `/drop`.
- [ ] Confirm `/letter` has the same Git status and diff as before the copy.

**Dependencies:** None.

**Files likely touched:** app source copied into `/drop`, `.gitignore`, `README.md`, `package.json`.

**Estimated scope:** Small.

## Task 1: Add the mixed-payload model with backward-compatible text defaults

**Description:** Extend the existing letter/draft model so each item can represent a text letter, image/meme, or GIF, plus its delivery mode and optional private media metadata. Keep old localStorage drafts and existing database rows readable as text.

**Acceptance criteria:**
- [ ] Existing seeded letters, local drafts, and Supabase rows without a payload kind render as text drops.
- [ ] New model fields are additive and existing letter content and IDs remain intact.
- [ ] Mock examples cover a text drop, an image/meme, and a GIF.

**Verification:**
- [ ] Run `npm run typecheck` and inspect migrated mock/local draft output.
- [ ] Confirm an existing seeded letter still opens through `/letter/[id]`.

**Dependencies:** None.

**Files likely touched:** `data/mockData.ts`, `lib/letterStore.ts`, `lib/letterBackend.ts`, a new additive SQL migration under `supabase/migrations/`.

**Estimated scope:** Medium.

## Task 2: Add private image/GIF upload and recipient-authorized reads

**Description:** Add the smallest Supabase Storage path for private image and GIF assets. Keep only the storage path and basic metadata on the drop, validate files before upload, and fetch a short-lived URL for an authorized sender or recipient.

**Acceptance criteria:**
- [ ] Only the chosen image formats and GIF are accepted, with a visible size limit and upload error state.
- [ ] Storage policies allow the sender and addressed recipient to read the attachment, while unrelated users cannot.
- [ ] A failed upload leaves the draft intact and does not report the drop as sent.

**Verification:**
- [ ] Test upload and read with the sender account, then verify access with an unrelated account is denied.
- [ ] Test unsupported type, oversized file, and failed upload recovery.

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
- [ ] Home and mailbox labels, cards, and empty states make sense for text and media drops.
- [ ] Navigation and primary actions fit phone widths and respect bottom safe-area insets.
- [ ] The existing desktop sidebar and profile access remain available at larger widths.

**Verification:**
- [ ] Check home and mailbox at 360px, 390px, and 430px widths.
- [ ] Confirm current prompt cards and seal-related entry points remain reachable.

**Dependencies:** Task 1.

**Files likely touched:** `app/page.tsx`, `app/mailbox/page.tsx`, `components/Sidebar.tsx`, `components/LetterCard.tsx`, `app/globals.css`.

**Estimated scope:** Medium.

## Task 4: Turn the composer into a mobile-first drop flow

**Description:** Let the sender choose a text note, image/meme, or GIF; preview it with an optional caption; choose one recipient; then send instantly by default or explicitly choose relay. Preserve existing text prompts and optional seals for letter-style drops.

**Acceptance criteria:**
- [ ] The composer supports text, image/meme, and GIF previews without requiring multiple desktop-style steps on mobile.
- [ ] A local draft survives navigation, and media is clearly marked as uploaded or local-only until upload succeeds.
- [ ] Sending gives clear progress, success, and recovery states; instant is the default and relay is opt-in.

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
- [ ] Existing letter URLs continue to open and text still uses its current reveal behavior.
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
- [ ] Lint, typecheck, and production build all pass without removing unrelated working-tree changes.

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
