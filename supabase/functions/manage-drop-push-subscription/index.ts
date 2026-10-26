import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  createManageDropPushSubscriptionHandler,
  type ManageDropPushDependencies,
} from './handler.ts';

const dependencies: ManageDropPushDependencies = {
  getEnv: (name) => Deno.env.get(name),
  createClient: (url, key, options) => createClient(url, key, options) as never,
};

Deno.serve(createManageDropPushSubscriptionHandler(dependencies));
