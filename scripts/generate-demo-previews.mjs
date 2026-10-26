#!/usr/bin/env node

import { stat } from 'node:fs/promises';
import sharp from 'sharp';

const previews = [
  {
    source: 'public/demo-cat.png',
    destination: 'public/demo-cat-preview.webp',
    width: 840,
    height: 630,
    quality: 76,
    maxBytes: 140 * 1024,
  },
  {
    source: 'public/demo-cat.gif',
    destination: 'public/demo-cat-loop-preview.webp',
    width: 280,
    height: 280,
    quality: 74,
    maxBytes: 35 * 1024,
  },
];

for (const preview of previews) {
  const result = await sharp(preview.source)
    .resize(preview.width, preview.height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: preview.quality, effort: 6 })
    .toFile(preview.destination);
  const { size } = await stat(preview.destination);

  if (result.format !== 'webp' || result.width > preview.width || result.height > preview.height) {
    throw new Error(`Unexpected preview output for ${preview.destination}.`);
  }
  if (size > preview.maxBytes) {
    throw new Error(`${preview.destination} is ${size} bytes; the limit is ${preview.maxBytes}.`);
  }

  console.log(`${preview.destination}: ${result.width}x${result.height}, ${size} bytes`);
}
