import { createClient } from 'npm:@supabase/supabase-js@2';
import webPush from 'npm:web-push@3.6.7';
import {
  createDropPushDispatcherHandler,
  type DropPushDispatcherDependencies,
} from './handler.ts';

const dependencies: DropPushDispatcherDependencies = {
  getEnv: (name) => Deno.env.get(name),
  createClient: (url, key, options) => createClient(url, key, options) as never,
  sendNotification: (subscription, payload, options) => webPush.sendNotification(
    subscription,
    payload,
    options,
  ),
};

Deno.serve(createDropPushDispatcherHandler(dependencies));
