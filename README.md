# Drop

Drop is a mobile-first way to send a friend a photo, meme, GIF, or personal note as a private drop. Sending is instant by default; a human relay is an optional journey.

The append-only engineering learning log is in [LEARNINGS.md](./LEARNINGS.md); it records solved issues, causes, verification evidence, and Git checkpoints.

## Run locally

```bash
npm ci
./run.sh
```

Open `http://localhost:4004`. Run `./run.sh` again to restart Drop, or `./run.sh stop` to stop it. Without Supabase credentials, the app runs with local demo data. Real account-to-account media delivery needs the Supabase migrations and private storage setup in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md).

The composer shows account readiness and recipient selection before the note, photo, or GIF controls. Recipient lookup and invite detours preserve the existing local draft. Each invite outcome (shared, copied, cancelled, or unavailable) is saved with that account’s draft so the composer and mailbox can offer the right next step; a manual-copy link remains available after an unsuccessful retry. Progress clears when the handle resolves or changes, or when the drop is sent. Send receipts are tied to the submitted draft content, so edits made in another tab stay drafts.
Before sharing an invite, Drop confirms the current draft was written to local storage. On the invite profile’s final step, people can open the share sheet or explicitly copy their public handle and profile link. If clipboard access is denied, selectable text provides a manual fallback; cancelling the share sheet does not copy automatically.

Mailbox empty states now respond to the selected filter and offer a matching next step; clearing a search keeps the selected filter and returns focus to the search field.

For an unknown handle, the composer can share a private claim link for an instant text, photo, or GIF drop; relay claim links are not part of this flow. The recipient signs in, creates a Drop profile, and explicitly claims the drop before its content or media is released. The shared link carries the bearer token in the URL fragment, never in query parameters or share copy, and the page removes it from the address after arrival. To resume sign-in in another tab of the same browser, Drop temporarily stores the token in browser local storage for up to 10 minutes and passes only a random opaque handoff ID through profile/auth-return URLs. The receiving tab saves the token in its own session storage before removing the shared copy. If tab storage cannot save it, the shared record remains available until expiry. The open tab schedules cleanup; expired or malformed records are also removed on the next claim-page load. A successful claim clears any remaining handoff. This transfer does not move between browsers or devices, which must reopen the original invite. The sender sees a waiting state and can rotate the link from the sent-drop page; a fresh link replaces the old one. A successful claim updates an open sender detail page live; the result also appears as “Claimed by [name]” in Sent and on the detail page after reload. The sender-only status RPC returns claimed drop IDs without exposing invite tokens or recipient account IDs. Claim links expire after 7 days. Unclaimed photo/GIF claims and media access end 30 days after the initial send; rotating a link does not extend that deadline. The hourly worker queues expired objects for deletion through the Supabase Storage API and retries failed removals. It also scans up to 25 finalized objects per run that are older than 30 days and unlinked when initial queue attempts failed. A paused Free project or a Storage/worker outage can delay physical deletion after the access cutoff. Apply `20261023120000_drop_claim_invites.sql`, `20261023130000_drop_claimed_sender_broadcast.sql`, `20261023140000_sender_claimed_drop_status.sql`, `20261023150000_private_media_claim_invites.sql`, and `20261023160000_reconcile_orphan_drop_media.sql` in order before deploying the updated cleanup worker. Configure the cleanup worker and Vault secrets as described in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md). A disposable PostgreSQL policy fixture is available at `tests/db/drop_claim_invites.sql`.

The cleanup endpoint's HTTP, secret, and configuration boundary is covered by `tests/dropMediaCleanupEndpoint.test.mjs`, using a fake Supabase client to prove rejected requests make no privileged calls. These Node tests do not validate Deno bundling, hosted worker configuration, or actual Storage deletion.

Relay recipients now see a route-only mailbox card while a drop is in transit and choose **I got this drop** before its message or media unlocks. After confirmation, the sender Journey and Relay views mark the recipient as collected across the header, map, route chain, and custody timeline, and stop offering carrier invites. Apply `20261023000000_relay_recipient_collection.sql` followed by `20261023010000_legacy_dispatched_relay_compatibility.sql`; the second migration safely handles older dispatched rows whose saved media path predates the current path shape. Rendered collected-state verification is still open.

Drop uses port 4004 for the main app, 5004 for its isolated local Supabase smoke test, and 6004 for browser QA. The smoke test only accepts a loopback Supabase URL from `.env.local`; it does not reset the local database.

Keep local credentials in the ignored `.env.local` file at the project root. Local Supabase Auth redirects are configured for ports 4004, 5004, and 6004, with the legacy 3000 callback retained. Restart the local Supabase stack after changing `supabase/config.toml`.

Run checks with `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build -- --webpack`. For authenticated local Supabase verification, start the documented local stack and run `npm run test:local-supabase`. It uses port 5004 and four disposable accounts/media objects, cleans them up, and does not reset the database. It checks participant privacy, reactions, GIF finalization/retry, and relay collection; it does not cover unknown-handle claims or hosted behavior.

Relay handoffs request current device location only after an explicit opt-in. Optional GPS is used for the local proximity check and, after a successful handoff, saved in this browser; neighborhood labels can be entered manually. New server-issued carrier invites keep the bearer capability in the URL fragment, outside the initial HTTP request. Previously issued query-token invites remain compatible and are cleaned from the address bar after opening. Legacy `?d=` QR links still contain the previous carrier's coordinates and send them to Drop when opened; create a fresh secure carrier invite for future handoffs.

Sender route views refresh immediately, every 15 seconds while visible, and when the tab returns; the refresh control reports new handoffs and keeps the saved route visible when remote reads fail. Apply `20261022000000_restrict_relay_handoff_column_select.sql` with the other Supabase migrations so authenticated participants can read route details without access to handoff tokens or retry keys.

Signed-in Home and Mailbox listen for private recipient-scoped Realtime Broadcasts, then reload drop rows through the existing RLS query; broadcasts contain only the drop ID. A visible-tab 60-second refresh recovers missed signals. Apply `20261022100000_drop_inbox_broadcast.sql` with the other migrations before expecting hosted arrival cues.

Senders also get private reaction-change signals containing only the drop ID. Home, Mailbox, and an open sent-drop page reload the reaction through participant RLS, with a visible-tab recovery refresh. Apply `20261022110000_drop_reaction_broadcast.sql` after the inbox broadcast migration before expecting hosted reaction updates.

Mailbox history is paged beyond the API's 1,000-row limit, and reaction reads run in bounded batches. If reaction data is incomplete, drops remain visible while reaction cues wait for a complete read or a matching realtime signal. A sent-drop detail route captures its reaction baseline before opening the private listener, then bounds the direction, baseline, channel setup, and mailbox waits so slow requests cannot keep the screen loading indefinitely.

## Relay retry recovery

Carrier invite accepts keep the exact attempt details in the current browser tab for up to 24 hours. If the response is interrupted, refresh the same invite in that tab and choose “Retry same handoff”; Drop clears the record after the carrier pass is saved.
