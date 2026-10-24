export async function POST() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/compose?shareError=worker-unavailable',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
}
