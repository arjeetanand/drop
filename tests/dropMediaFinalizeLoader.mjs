import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@supabase/supabase-js') {
    return { url: new URL('./mocks/dropFinalizeSupabaseMock.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === '@/lib/dropMediaValidation') {
    return { url: new URL('./mocks/dropFinalizeMediaValidationMock.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    return { url: pathToFileURL(resolvePath(process.cwd(), specifier.slice(2) + '.ts')).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
