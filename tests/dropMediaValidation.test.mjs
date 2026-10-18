import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import { DropMediaValidationError, validateDropMediaBytes } from '../lib/dropMediaValidation.ts';

const png = new Uint8Array(await readFile(new URL('../public/demo-cat.png', import.meta.url)));
const gif = new Uint8Array(await readFile(new URL('../public/demo-cat.gif', import.meta.url)));

test('detects the actual MIME type and decodes allowed image and GIF content', async () => {
  const cleanPng = await validateDropMediaBytes(png, 'image');
  const cleanGif = await validateDropMediaBytes(gif, 'gif');
  assert.equal(cleanPng.mimeType, 'image/png');
  assert.equal(cleanGif.mimeType, 'image/gif');
  assert.equal((await sharp(cleanGif.bytes, { animated: true }).metadata()).pages, (await sharp(gif, { animated: true }).metadata()).pages);
  assert.ok(cleanPng.sizeBytes <= 8 * 1024 * 1024);
});

test('rejects corrupt files and image types that do not match the selected drop kind', async () => {
  await assert.rejects(validateDropMediaBytes(new TextEncoder().encode('<script>bad</script>'), 'image'), DropMediaValidationError);
  await assert.rejects(validateDropMediaBytes(png, 'gif'), DropMediaValidationError);
});

test('removes EXIF metadata before media leaves the server', async () => {
  const withLocationMetadata = new Uint8Array(await sharp(png).jpeg().withExif({
    IFD0: { Artist: 'private test fixture' },
    IFD2: { GPSLatitude: '37,48,30', GPSLatitudeRef: 'N', GPSLongitude: '122,24,30', GPSLongitudeRef: 'W' },
  }).toBuffer());
  assert.ok((await sharp(withLocationMetadata).metadata()).exif);
  const clean = await validateDropMediaBytes(withLocationMetadata, 'image');
  assert.equal((await sharp(clean.bytes).metadata()).exif, undefined);
});
