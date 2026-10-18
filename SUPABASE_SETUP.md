# Supabase setup for Drop

Drop needs Supabase Auth, the existing `profiles` and `letters` schema, and the new private `drop-media` bucket for real account-to-account sends.

1. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Supabase project to `.env.local`.
2. Apply the migrations in `supabase/migrations/` in filename order, including `20261018_drop_media_reactions.sql`.
3. Enable Google OAuth in Supabase Auth if you want the existing Google sign-in button to work.
4. Sign in, save a unique username on Your profile, then send to a registered `@username`.

The app accepts JPG, PNG, WebP, and GIF uploads up to 8 MB. Attachments stay in the private `drop-media` bucket; the app stores a storage path and requests a one-minute signed URL only after Supabase returns an authorized letter row. Storage policies allow the uploader to write under their own account folder and only the sender or addressed recipient to read a linked attachment. The recipient alone can add or change a reaction.

Without Supabase credentials, the app runs with local seeded examples and local text drafts. Real sends and cross-account media delivery are unavailable in that mode.
