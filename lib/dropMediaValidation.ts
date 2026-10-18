import sharp from 'sharp';
import { MAX_DROP_MEDIA_BYTES } from './dropValidation.ts';

export const MAX_DROP_MEDIA_PIXELS = 40_000_000;
export const MAX_DROP_MEDIA_FRAMES = 120;

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export class DropMediaValidationError extends Error {}

export async function validateDropMediaBytes(bytes: Uint8Array, payloadKind: 'image' | 'gif') {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DROP_MEDIA_BYTES) {
    throw new DropMediaValidationError('Keep images under 8 MB.');
  }

  try {
    const options = { animated: true, failOn: 'warning' as const, limitInputPixels: MAX_DROP_MEDIA_PIXELS };
    const metadata = await sharp(bytes, options).metadata();
    const mimeType = metadata.format ? MIME_BY_FORMAT[metadata.format] : undefined;
    if (!mimeType || (payloadKind === 'gif') !== (mimeType === 'image/gif')) {
      throw new DropMediaValidationError('Choose a readable photo or GIF that matches this drop.');
    }

    const frames = metadata.pages ?? 1;
    const pixels = (metadata.width ?? 0) * (metadata.pageHeight ?? metadata.height ?? 0) * frames;
    if (frames > MAX_DROP_MEDIA_FRAMES || pixels <= 0 || pixels > MAX_DROP_MEDIA_PIXELS) {
      throw new DropMediaValidationError('This image is too large to open safely. Choose a smaller photo or GIF.');
    }

    const sanitizedBytes = await sharp(bytes, options).rotate().toFormat(metadata.format).toBuffer();
    if (sanitizedBytes.byteLength > MAX_DROP_MEDIA_BYTES) {
      throw new DropMediaValidationError('Keep images under 8 MB after processing. Choose a smaller photo or GIF.');
    }
    return { bytes: new Uint8Array(sanitizedBytes), mimeType, sizeBytes: sanitizedBytes.byteLength };
  } catch (error) {
    if (error instanceof DropMediaValidationError) throw error;
    throw new DropMediaValidationError('Choose a readable JPG, PNG, WebP, or GIF image.');
  }
}
