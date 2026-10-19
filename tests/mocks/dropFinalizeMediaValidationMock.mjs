export class DropMediaValidationError extends Error {}

export async function validateDropMediaBytes(bytes) {
  return { bytes, mimeType: 'image/gif', sizeBytes: bytes.byteLength };
}
