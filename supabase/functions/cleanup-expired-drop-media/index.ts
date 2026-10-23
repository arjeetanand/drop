import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCleanupWorkerHandler, type WorkerSupabaseClient } from './handler.ts';

Deno.serve(createCleanupWorkerHandler({
  getEnv: (name) => Deno.env.get(name),
  createClient: (url, key, options) => createClient(url, key, options) as unknown as WorkerSupabaseClient,
}));
