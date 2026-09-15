import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run against the built Worker to check lengths after the final stream wrapper.
// Only local fixtures may use the headers normally added by Sites.
const base = process.env.LAUNCH_TEST_WORKER_URL || 'http://localhost:8787';

void test('recordings support iPhone range probes, seeking and HEAD without bypassing authentication', async () => {
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname),
  );
  const auth = {
    'oai-authenticated-user-id': 'file-playback-test',
    'oai-authenticated-user-email': 'file-playback-test@example.test',
  };
  const id = crypto.randomUUID();
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
  const form = new FormData();
  form.set('id', id);
  form.set('file', new File([bytes], 'range-test.m4a', { type: 'audio/mp4' }));
  const uploaded = await fetch(base + '/api/files', {
    method: 'POST',
    headers: auth,
    body: form,
  });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const url = base + '/api/files/' + id;
  const get = (range?: string, extra: Record<string, string> = {}) =>
    fetch(url, {
      headers: { ...auth, ...(range ? { Range: range } : {}), ...extra },
    });
  const whole = await get();
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'audio/mp4');
  assert.equal(whole.headers.get('content-length'), '256');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(whole.headers.get('cache-control'), 'private, no-store');
  assert.match(whole.headers.get('content-disposition')!, /^inline;/);
  assert.deepEqual(new Uint8Array(await whole.arrayBuffer()), bytes);
  for (const [range, start, end] of [
    ['bytes=0-1', 0, 1], // Safari's initial two-byte media probe.
    ['bytes=32-63', 32, 63],
    ['bytes=250-', 250, 255],
    ['bytes=-10', 246, 255],
    ['bytes=250-999', 250, 255],
    ['bytes=-999', 0, 255],
  ] as const) {
    const response = await get(range);
    assert.equal(response.status, 206, range);
    assert.equal(
      response.headers.get('content-range'),
      `bytes ${start}-${end}/256`,
    );
    assert.equal(
      response.headers.get('content-length'),
      String(end - start + 1),
    );
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      bytes.slice(start, end + 1),
    );
  }
  for (const range of ['bytes=256-', 'bytes=-0']) {
    const response = await get(range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */256');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  for (const range of ['bytes=20-10', 'bytes=0-1,10-20', 'invalid']) {
    const response = await get(range);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
  const fresh = await get('bytes=0-1', {
    'If-Range': whole.headers.get('etag')!,
  });
  assert.equal(fresh.status, 206);
  assert.equal((await fresh.arrayBuffer()).byteLength, 2);
  const stale = await get('bytes=0-1', { 'If-Range': '"stale"' });
  assert.equal(stale.status, 200);
  assert.equal((await stale.arrayBuffer()).byteLength, 256);
  const head = await fetch(url, {
    method: 'HEAD',
    headers: { ...auth, Range: 'bytes=0-1' },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '256');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const method of ['GET', 'HEAD'])
    assert.equal(
      (await fetch(url, { method, headers: { Range: 'bytes=0-1' } })).status,
      401,
    );
  assert.equal(
    (
      await fetch(base + '/api/files/' + crypto.randomUUID(), {
        headers: { ...auth, Range: 'bytes=0-1' },
      })
    ).status,
    404,
  );
});
