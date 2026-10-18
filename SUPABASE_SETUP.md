# Supabase setup for Drop

Drop needs Supabase Auth, the existing `profiles` and `letters` schema, and the new private `drop-media` bucket for real account-to-account sends.

1. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project to `.env.local`.
2. Apply the migrations in `supabase/migrations/` in filename order, including both `20261018_drop_media_reactions.sql` and `20261018_relay_handoff_tokens.sql`.
3. Enable Google OAuth in Supabase Auth if you want the existing Google sign-in button to work, and allow `http://localhost:3000/auth/callback` as a redirect URL during local development.
4. Sign in, save a unique username on Your profile, then send to a registered `@username`.

The app accepts JPG, PNG, WebP, and GIF uploads up to 8 MB. Attachments stay in the private `drop-media` bucket; the app stores a storage path and requests a one-minute signed URL only after Supabase returns an authorized letter row. Storage policies allow the uploader to write under their own account folder and only the sender or addressed recipient to read a linked attachment. The recipient alone can add or change a reaction.

## Relay handoffs

Apply `20261018_relay_handoff_tokens.sql` after the existing letter and media migrations. Relay invites are bearer links: the first invite expires after 10 minutes, and accepting it issues a carrier capability that lasts 30 days. A carrier capability can mint a fresh 10-minute handoff pass when its holder is ready to pass the drop on. Share each invite only with the intended next carrier. Carriers can add route events but cannot read the drop's text or media.

Without Supabase credentials, the app runs with local seeded examples and local text drafts. Real sends and cross-account media delivery are unavailable in that mode.
