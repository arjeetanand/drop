import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Drop — Small things, sent',
    short_name: 'Drop',
    description: 'Send a private note, photo, or GIF to one person.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f4ee',
    theme_color: '#2b45f7',
    icons: [
      {
        src: '/icons/drop-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/drop-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/drop-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    share_target: {
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        files: [
          {
            name: 'media',
            accept: [
              'image/jpeg',
              'image/png',
              'image/webp',
              'image/gif',
              '.jpg',
              '.jpeg',
              '.png',
              '.webp',
              '.gif',
            ],
          },
        ],
      },
    },
  };
}
