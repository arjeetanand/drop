# Local private-claim QR browser verification

**Run date:** 2026-10-25
**Code under test:** `pilot/qr-integration` at `1bf7837` plus `9cf9e87`, based on `feat/pilot-integrated-preview` at `f0c015a`
**Environment:** isolated headless Chrome, 390×844, local app and local Supabase only

## Results

- Authenticated the local test sender and issued a private text claim invite from Compose.
- Verified the QR appeared in a labelled region, received focus, and showed the disclosure that anyone scanning the bearer link can claim.
- Confirmed the 64-hex bearer token was in the URL fragment, not the query string; the created claim row remained pending with a null recipient. Anonymous RLS read returned zero rows.
- Hid and showed the QR; both states retained the same invite. Decoding the captured QR image produced the exact displayed invite link.
- Scrolled to the explanation and confirmed it stayed above the fixed mobile navigation.
- Observed one local RPC, no non-local requests, no console errors, and no page exceptions.
- Cleanup removed the exact one test drop, one Auth user, and one profile. The test did not use hosted Supabase.

## Limits

This was a successful local browser run, but it is not yet a committed repeatable QR smoke script. A physical camera scan, hosted claim flow, installed-PWA system sharing, spoken screen-reader output, and physical-device safe-area behavior remain unverified.
