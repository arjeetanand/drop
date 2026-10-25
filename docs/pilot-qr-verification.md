# Local private-claim QR browser verification

**Repeatable smoke run:** 2026-10-26
**Code:** commits `9e764e8` and `2a9cf49`, pushed to `feat/pilot-integrated-preview` (PR #11 remains open/draft)
**Command:** `npm run test:browser-qr`
**Environment:** isolated headless Chromium-family profile, local app on port 6004, loopback Supabase only

## Repeatable smoke results

- Passed the browser loopback Supabase health preflight, then signed in a disposable sender and issued a handleless private text claim from Compose at 390×844.
- Verified exactly one pending `claim_pending` text row with null recipient, denied anonymous row reads, and checked the visible labeled QR region/image receives focus and exposes the matching local claim-link shape with its bearer token in the URL fragment.
- Hid and showed the QR, confirming the same accessible link and stable SVG fingerprint; started a new draft and confirmed the old link/QR state cleared.
- No browser-page cross-origin requests, console errors, or runtime exceptions were observed. The page-request firewall is scoped to the browser target; the isolated Next.js dev-server process was not OS-sandboxed.
- Cleanup verified one exact drop deletion and absence of the disposable profile/Auth user, browser/app process groups, and temporary directory. Port 4004 and hosted Supabase were untouched.
- This browser did not expose `BarcodeDetector`, so this repeatable smoke checked the link and QR SVG fingerprints, not a decoded QR image. The separate earlier manual run below did decode the captured QR and remains the only pixel-decoding evidence.

### Browser startup diagnosis

The first repeatable attempts timed out before reaching local Auth because the browser child had `HOME` redirected to its temporary test directory. The local page recorded a health navigation without a response, and the browser target closed. Keeping the normal process `HOME` while retaining a unique temporary `--user-data-dir` restored loopback navigation; `TMPDIR` and the app/browser profile remain under the temporary test root. This macOS runtime behavior was verified through the successful final smoke.

## Earlier manual pixel-decode run

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

The repeatable smoke verifies local browser issuance and UI state only. A physical camera scan, hosted claim flow, installed-PWA system sharing, spoken screen-reader output, and physical-device safe-area behavior remain unverified.
