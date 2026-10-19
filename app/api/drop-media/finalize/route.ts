import { createClient } from '@supabase/supabase-js';
import { MAX_DROP_MEDIA_BYTES } from '@/lib/dropValidation';
import { isDropMediaFinalPath, resolveDropMediaPaths } from '@/lib/dropMediaStorage';
import { DropMediaValidationError, validateDropMediaBytes } from '@/lib/dropMediaValidation';
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/readBoundedJson';

export const runtime = 'nodejs';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'Private media validation is not configured.' }, 503);

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null && Number(contentLengthHeader) > 4096) return json({ error: 'Invalid media request.' }, 413);
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return json({ error: 'Sign in before sending a media drop.' }, 401);

  let parsedBody: unknown;
  try {
    parsedBody = await readBoundedJson(request, 4096);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ error: 'Invalid media request.' }, 413);
    return json({ error: 'Invalid media request.' }, 400);
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) return json({ error: 'Invalid media request.' }, 400);
  const body = parsedBody as { stagedPath?: unknown; payloadKind?: unknown };
  if (body.payloadKind !== 'image' && body.payloadKind !== 'gif') return json({ error: 'Invalid media request.' }, 400);

  const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return json({ error: 'Sign in before sending a media drop.' }, 401);

  const paths = resolveDropMediaPaths(body.stagedPath, user.id);
  if (!paths) return json({ error: 'Invalid media request.' }, 400);

  const serviceClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: stagedMedia, error: downloadError } = await serviceClient.storage.from('drop-media').download(paths.stagedPath);
  if (downloadError || !stagedMedia || stagedMedia.size === 0 || stagedMedia.size > MAX_DROP_MEDIA_BYTES) {
    return json({ error: 'The staged image could not be validated. Choose it again and retry.' }, 400);
  }

  const bytes = new Uint8Array(await stagedMedia.arrayBuffer());
  let media;
  try {
    media = await validateDropMediaBytes(bytes, body.payloadKind);
  } catch (error) {
    const message = error instanceof DropMediaValidationError ? error.message : 'The image could not be validated. Choose it again and retry.';
    return json({ error: message }, 400);
  }

  const { data: existingDrop, error: existingDropError } = await serviceClient.from('letters')
    .select('media_path, media_mime_type, media_size_bytes')
    .eq('id', paths.draftId)
    .eq('sender_id', user.id)
    .maybeSingle<{ media_path: string | null; media_mime_type: string | null; media_size_bytes: number | null }>();
  if (existingDropError) return json({ error: 'Could not confirm the drop media state. Please retry.' }, 503);
  if (existingDrop && isDropMediaFinalPath(existingDrop.media_path, user.id, paths.draftId)) {
    const { data: savedMedia, error: savedMediaError } = await serviceClient.storage.from('drop-media').download(existingDrop.media_path!);
    if (!savedMediaError && savedMedia && existingDrop.media_mime_type === media.mimeType && existingDrop.media_size_bytes === media.sizeBytes) {
      const savedBytes = Buffer.from(await savedMedia.arrayBuffer());
      if (savedBytes.equals(Buffer.from(media.bytes))) {
        try {
          await serviceClient.storage.from('drop-media').remove([paths.stagedPath]);
        } catch {
          // The linked copy is safe; an inaccessible staging copy can be removed later.
        }
        return json({ mediaPath: existingDrop.media_path, mediaMimeType: media.mimeType, mediaSizeBytes: media.sizeBytes });
      }
    }
  }

  const { error: uploadError } = await serviceClient.storage.from('drop-media').upload(
    paths.finalPath,
    new Blob([media.bytes], { type: media.mimeType }),
    { contentType: media.mimeType, upsert: false },
  );
  if (uploadError) return json({ error: 'The validated image could not be saved. Please retry.' }, 500);

  try {
    await serviceClient.storage.from('drop-media').remove([paths.stagedPath]);
  } catch {
    // The final copy is safe to use; an inaccessible staging copy can be removed later.
  }
  return json({ mediaPath: paths.finalPath, mediaMimeType: media.mimeType, mediaSizeBytes: media.sizeBytes });
}
