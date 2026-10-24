import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../app/share-target/route.ts';

test('the service-worker fallback redirects without reading the submitted media body', async () => {
  const request = new Request('http://localhost:4004/share-target', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=drop-test' },
    body: '--drop-test\r\nContent-Disposition: form-data; name="media"; filename="private.jpg"\r\n\r\nprivate image bytes\r\n--drop-test--\r\n',
  });

  const response = await POST(request);

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/compose?shareError=worker-unavailable');
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(request.bodyUsed, false);
});
