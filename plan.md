# Implementation Plan: Drop Mobile Sharing Experience

## Overview

Build Drop as a mobile-first private sharing app where a person can send a photo, GIF, meme, or text letter as a “drop.” Use the three mobile concept directions already reviewed as visual references: bold cobalt and warm paper, oversized media previews, playful stamps, and expressive but quick send/open moments. Drop is the product brand and a “drop” is the item shared. Sending stays one-to-one in the first release; delivery is instant by default, with the existing human relay as an optional slower journey. There will be no public discovery feed in this release.

The app keeps its current Next.js, React, Tailwind, Supabase, local draft, mailbox, and relay foundations. Existing letters continue to work as text drops, and their routes and saved content remain readable. The build covers the end-to-end mobile flow: choose content, attach an image or GIF, choose a recipient, send, open, react, and optionally follow a relay.

## Implementation Status — 2026-10-24 (Relay count and mobile pass)

- Relay statistics now count only carrier handoffs, and both Relay and Journey label the value “Carriers.” Regression coverage excludes sender and recipient roles.
- The narrow-screen Relay controls stack, and the passport identifier and headline use mobile-safe wrapping. Exact Chrome checks measured no document overflow at 390 CSS pixels or desktop width.
- Verification: `npm test` passed 249/249; lint, no-incremental TypeScript, `git diff --check`, and the production build passed. The full demo browser smoke timed out on initial `Page.navigate`, so no full journey claim is made for this checkpoint.
- Code commit `4f8d512` is pushed to `origin/fix/relay-carrier-count`; hosted Supabase setup remains blocked because the local CLI has no access token. No project, billing, or `.env.local` change was made.
- Next: connect the demo sender copy to a fresh editable draft without inheriting demo content or replacing an active draft, then complete the hosted Free project setup when authenticated access is available.

## Implementation Status — 2026-10-24 (Home writing spark)

- Home’s **Use this thought** action now creates a fresh text drop and seeds it with the currently displayed writing prompt. The composer remains editable and receives only the draft ID in its route.
- Starting this draft does not replace an unfinished photo/GIF draft or its saved local attachment. The store regression test covers draft identity, prompt content, and existing attachment recovery.
- Code commit `2a29ffa` (`fix: seed home thought into fresh drop draft`) is pushed to `origin/fix-private-claim-share-cancel-copy`. The requested learning log and product notes are appended in the docs checkpoint.
- The user reports being signed in to Supabase, but this task exposes no authenticated dashboard control. No project or billing changes were made; the approved Free plan, hosted sends, and real 30-day Storage deletion remain unverified.

## Implementation Status — 2026-10-24 (Hosted Supabase provisioning)

- The approved distinct organization `Drop App Free` was created. Its plan could not be verified because the organization-details request returned 403. No paid compute or add-on was selected; do not treat the Free plan as verified yet.
- Creating the `Drop` project in `ap-south-1` without a compute-size override returned 403. The read-only project list still shows only the existing `arjeetanand's Project`; no Drop project was created or configured.
- The supplied PAT can create the organization and list projects, but organization details and project creation return 403. Supabase documents `organization_admin_read` and `organization_projects_create` for those operations. Hosted setup awaits a newly scoped token or manual project creation, with the plan verified before migrations or app configuration.
- `.env.local` was not changed; the generated password for the rejected project request was removed. The user-approved 30-day cleanup policy remains implemented in the existing migration.
- `npm run build -- --webpack` now passes. `./run.sh` restarted the app on port 4004 and Home returned HTTP 200. The build reports only outdated Browserslist data and an ambiguous Tailwind easing class. Hosted behavior remains unverified.

## Implementation Status — 2026-10-24 (Share without a handle)

- The composer offers an explicit handleless private-claim path from the blank recipient step. It discloses that anyone holding the bearer link can claim, keeps the account/payload-save gates, limits this route to Instant, and lets the sender return to handle entry with keyboard focus restored.
- A successful recipientless claim issue is persisted as `claim_pending`; Sent and detail views show a neutral claim status instead of inventing a recipient or saying the link was shared. Existing addressed sends still require a confirmed handle.
- Regression coverage includes eligibility, saved receipt persistence, generic recipient projection, and rejection of a normal delivered send without a recipient. The isolated Chrome run verified the handleless choice, disclosure, readiness gate, focus return, and saved claim detail/recovery at 360×844, 390×844, 430×844, and 1440×900. The full GIF and photo demo flows also passed; touch was used for the 360px GIF journey, and keyboard activation for the handleless route and claim recovery.
- `npm test` passed 247/247; lint, no-incremental TypeScript, smoke-script syntax, and `git diff --check` passed. The browser request gate observed no cross-origin or Auth/RPC/Storage-write requests in the local flows.
- Code commit `a6f8de7` (`feat: add handleless private claim route`) is pushed to `origin/fix-private-claim-share-cancel-copy`; product notes and this learning log are committed separately.
- Hosted two-account delivery and real Storage deletion remain unverified because no hosted Drop project is set up. This slice does not change the existing 30-day retention policy. Screen-reader and physical-device checks also remain open. A production build was not rerun; prior attempts were blocked by `.next/trace` write permission in the checkout and Google Fonts DNS resolution in a scratch copy.

## Implementation Status — 2026-10-24 (Home demo browser verification)

- Home now links directly to a no-sign-in photo/GIF demo. It reuses the recipient reveal, reaction, and sender-copy screens, uses bundled media, and clearly says the sample stays on this device and is not sent or shared.
- The demo saves into the current account’s local history without replacing the active draft. Its attachment write and rollback use the account captured before fetching the bundled media; account-switch regression checks cover changes before and during the IndexedDB write.
- The isolated Chrome smoke now covers full GIF/reaction/reload/sender-copy flows at 360×844, 390×844, 430×844, and 1440×900, plus the bundled photo flow at 390×844. Touch activation passed at 360px; keyboard activation passed at 390px, 430px, and desktop. Home and the chooser have no horizontal overflow at those widths. The page-scoped gate observed no cross-origin, Auth, RPC, or Storage-write requests.
- Verification this slice: `npm test` passed 241/241, `npm run lint`, no-incremental TypeScript, browser-script syntax, `git diff --check`, and the rendered Chrome smoke passed. The plain incremental `npm run typecheck` hit a sandbox EPERM writing ignored `tsconfig.tsbuildinfo`; `npx tsc --noEmit --incremental false` passed. The production build was not rerun because only the browser smoke script changed; it passed in the prior demo checkpoint.
- Chrome touch input timed out at 430px in this environment, so that viewport uses the passing keyboard path. This local demo evidence does not cover hosted account-to-account sends, actual 30-day Storage deletion, screen-reader use, or physical-device keyboard/safe-area behavior. The user confirmed valid abandoned staging uploads should be deleted after 30 days; the existing migration already implements that cutoff, so no retention code or hosted resource changed.

## Implementation Status — 2026-10-18

- The unknown-handle claim regression coverage now follows photo and GIF drops through three access states: before profile setup, after profile setup but before claim, and after explicit claim. The local Auth/Storage smoke and rollback-only SQL fixture check participant access and outsider denial; runtime verification still needs an isolated Supabase project with the media cleanup schedule configured.
- Task 1 is complete. The mixed-payload model, default text behavior for older drafts, and compatible recipient routes are in place.
- The core mobile sharing, receive, reaction, and optional relay flows have local implementations. Detailed code and browser checks are recorded in `tasks/todo.md`.
- Seeded demo reactions now persist on this device and appear on the mailbox card; they are clearly marked as local and do not notify a sender.
- Preview offers an explicit same-device demo for instant drops: recipient reveal, local reaction, then a sender copy. The mailbox labels it as a demo and excludes it from real Sent counts; its local completion state does not mean a message was sent or a notification delivered.
- A disposable PostgreSQL regression test now covers relay token authorization, retry recovery, rotation/revocation, optional coordinates, participant-only route visibility, and private token-table denial.
- Signed-in mailbox cards now show participant-visible reactions on sent drops; hosted account-to-account verification remains open.
- First-use profile setup preserves customized local identity, suggests an editable account-specific handle, and only creates a sender profile after confirmed absence. Per-account unsynced edits survive lookup recovery, and handle conflicts stay recoverable on-device. The local smoke test verifies rejected updates and duplicate first-use inserts leave existing profiles unchanged. Authenticated browser onboarding remains unverified.
- Browser media uploads now use private staging, server-side format/decode limits, metadata-stripping re-encoding, and database checks that bind stored media to its drop; hosted Supabase verification remains open.
- Hosted account-to-account sending, storage privacy, reactions, and relay still need verification because no hosted Supabase project exists. The local CLI setup and disposable three-account smoke test verify local Auth, text-row RLS, reaction RLS, private GIF finalization, and participant-only storage reads. Browser sign-in and the full composer flow remain unverified. Real-device safe-area, keyboard, and reduced-motion checks also remain open.

## Workspace and Delivery

- `/drop` is the new app and the only write target. `/letter` is read-only inspiration; source files and its existing uncommitted work must remain untouched.
- Use the existing empty private GitHub repository `arjeetanand/drop`. Copy the working app into this folder without `.git`, environment secrets, generated output, or installed dependencies; preserve the plan files already here.
- Verify each implementation slice before committing and push each passing task-branch commit to `origin`. Merge into `main` only with explicit approval.
- The earlier design chat did not record a final selection. Use its playful paper direction as the default: warm paper, cobalt actions, expressive media, small postmark details, and thumb-first navigation.

## Product Scope and Decisions

- **Core payloads:** text/letter, photo or meme image, and GIF. A meme is an image with an optional caption. Upload from the device first; defer a searchable third-party GIF catalog until a provider is selected.
- **Sharing:** one recipient per drop for v1. Keep the interface ready for groups, but defer group data and permissions until the one-to-one flow is solid.
- **Delivery:** instant is the default. Human relay is an explicit choice for a drop that should travel hand to hand. Map and route details appear only in relay mode.
- **Privacy:** drops are private to sender and recipient. Media uses private storage and recipient-aware access. Do not expose public asset URLs or precise location in the normal sharing flow.
- **Local demo:** seeded examples demonstrate image/GIF cards, and an explicit same-device instant-drop demo exercises recipient reveal and reactions without sending or sharing. Real media delivery requires the configured Supabase account and private storage; drafts should clearly show if a file has not uploaded yet.
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
- [ ] Task 2: Add private image/GIF upload and recipient-authorized reads.

### Checkpoint: Foundation

- [ ] Existing local and Supabase letters still load as text drops.
- [ ] An authenticated sender can upload an allowed image/GIF and only the sender or recipient can retrieve it.
- [ ] No existing stored letter or draft is overwritten by the new fields.

### Phase 2: Mobile Sharing Flow

- [ ] Task 3: Rework the mobile home, mailbox, and navigation around drops.
- [ ] Task 4: Turn the composer into a single mobile-first drop flow.

### Checkpoint: Sending

- [ ] A person can create and send a text, image/meme, or GIF drop to one recipient.
- [ ] Instant delivery works without showing a map; relay is an intentional choice.
- [ ] Current writing prompts and seal choices still work where they apply to text drops.

### Phase 3: Receiving and Relay

- [ ] Task 5: Make received drops open in the right media format and support a private reaction.
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
| The local demo has no cross-device backend. | A recipient could mistake a local simulation for a real delivery. | Label each local demo as on-device and not sent; only report real delivery after a persistent account save. |
| Existing relay screens and their map/location model are more elaborate than instant sharing needs. | The default flow could feel slow or expose unnecessary location. | Keep relay optional and preserve map details only in that mode; request location only when the user starts a relay action. |
| Existing user changes overlap the home and composer. | The redesign could erase current writing prompts or seal choices. | Integrate with the current working tree and inspect the diff before editing those files. |

## Open Questions

- Revisit group sharing and GIF search after the one-to-one image/GIF flow is working.
- Confirm the upload size cap against the configured Supabase plan during implementation; the initial design should surface the limit before upload.
