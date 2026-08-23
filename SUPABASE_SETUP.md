# Dear.exe backend

The app runs in local demo mode until Supabase is connected. To enable persistent profiles, letters, Journey events, notes, and Google sign-in:

1. Create a Supabase project.
2. Run `supabase/migrations/20260823_dear_exe.sql` in the Supabase SQL editor.
3. Enable Google under Authentication → Providers and add the app callback URL: `http://localhost:3000/profile`.
4. Copy `.env.example` to `.env.local` and add the Supabase project URL and anon key.
5. Restart the Next.js server.

The browser client only uses the public anon key. Row Level Security limits letters and private notes to their owner; a recipient can read letters addressed to their profile username.
