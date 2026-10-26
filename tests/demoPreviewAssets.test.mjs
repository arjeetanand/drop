import assert from 'node:assert/strict';
import test from 'node:test';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const photoPreview = new URL('../public/demo-cat-preview.webp', import.meta.url);
const gifPreview = new URL('../public/demo-cat-loop-preview.webp', import.meta.url);

test('demo chooser previews are compact static WebP derivatives', async () => {
  const [photo, gif] = await Promise.all([
    sharp(fileURLToPath(photoPreview)).metadata(),
    sharp(fileURLToPath(gifPreview)).metadata(),
  ]);
  const [photoFile, gifFile] = await Promise.all([stat(photoPreview), stat(gifPreview)]);

  assert.equal(photo.format, 'webp');
  assert.equal(photo.width, 840);
  assert.equal(photo.height, 630);
  assert.ok(photoFile.size <= 140 * 1024, 'The Home/photo preview should stay under 140 KiB.');

  assert.equal(gif.format, 'webp');
  assert.equal(gif.width, 280);
  assert.equal(gif.height, 280);
  assert.ok((gif.pages ?? 1) <= 1, 'The GIF preview should be a single static poster frame.');
  assert.ok(gifFile.size <= 35 * 1024, 'The GIF poster should stay under 35 KiB.');
  assert.ok(photoFile.size + gifFile.size <= 160 * 1024, 'Both chooser previews should stay under 160 KiB combined.');
});
