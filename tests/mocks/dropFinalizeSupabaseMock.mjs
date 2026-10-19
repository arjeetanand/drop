export function createClient(url, key) {
  return globalThis.__dropFinalizeSupabaseFactory(url, key);
}
