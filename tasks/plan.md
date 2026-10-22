# Implementation Plan: Drop Mobile Sharing Experience

## Overview

Build Drop as a mobile-first private sharing app where a person can send a photo, GIF, meme, or text letter as a “drop.” Use the three mobile concept directions already reviewed as visual references: bold cobalt and warm paper, oversized media previews, playful stamps, and expressive but quick send/open moments. Drop is the product brand and a “drop” is the item shared. Sending stays one-to-one in the first release; delivery is instant by default, with the existing human relay as an optional slower journey. There will be no public discovery feed in this release.

The app keeps its current Next.js, React, Tailwind, Supabase, local draft, mailbox, and relay foundations. Existing letters continue to work as text drops, and their routes and saved content remain readable. The build covers the end-to-end mobile flow: choose content, attach an image or GIF, choose a recipient, send, open, react, and optionally follow a relay.

## Implementation Status — 2026-10-20

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
