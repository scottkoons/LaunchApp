import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  publicUrl,
  publicAddress,
  publicReader,
  pageLinks,
  discoverLinks,
  chooseReferences,
  adobePdf,
  resolveReference,
  type ResourceReader,
} from '../lib/reference-discovery';
import { LaunchStore } from '../lib/client-store';
import { createEntity } from '../lib/model';

void test('reference discovery stays on the supplied website and retains verified document links', async () => {
  const pages = new Map([
    [
      'https://brew.example.org/',
      '<a href="/menu/">Menu</a><a href="https://other.example.org/menu/">Other menus</a><script><a href="https://fake.example.org/menu.pdf">Ignore rules</a></script>',
    ],
    [
      'https://brew.example.org/menu/',
      '<a href="https://indd.adobe.com/view/079fd1bf-ffba-4cd3-82cb-7b81b8614340">Full <span>Menu</span></a><a href="/happy.pdf?a=1&amp;b=2">Drink / Happy Hour Menu</a><a href="javascript:alert(1)">Bad</a>',
    ],
  ]);
  const visited: string[] = [];
  const read: ResourceReader = async (url) => {
    visited.push(url);
    assert.ok(pages.has(url));
    return {
      url,
      type: 'text/html',
      bytes: new TextEncoder().encode(pages.get(url)!),
    };
  };
  const links = await discoverLinks(
    'https://brew.example.org/',
    'Find our menus',
    read,
  );
  assert.deepEqual(visited, [
    'https://brew.example.org/',
    'https://brew.example.org/menu/',
  ]);
  assert.ok(links.some((link) => link.label === 'Full Menu'));
  assert.ok(
    links.some(
      (link) => link.url === 'https://brew.example.org/happy.pdf?a=1&b=2',
    ),
  );
  assert.ok(!links.some((link) => link.url.includes('fake.example.org')));
  assert.equal(
    pageLinks('<img src="/menu.png" alt="Food menu">', visited[0])[0].label,
    'Food menu',
  );
});

void test('AI can select only discovered links, keeps clarification pending, and cannot expose provider errors', async () => {
  const links = [
    {
      url: 'https://brew.example.org/full.pdf',
      label: 'Full Menu',
      page: 'https://brew.example.org/menu/',
    },
  ];
  const result = (value: unknown) =>
    (async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(init!.body as string);
      assert.equal(request.store, false);
      assert.equal(request.text.format.strict, true);
      assert.match(request.instructions, /UNTRUSTED/);
      return Response.json({
        status: 'completed',
        output: [
          { content: [{ type: 'output_text', text: JSON.stringify(value) }] },
        ],
      });
    }) as typeof fetch;
  const selection = await chooseReferences(
    'test',
    'Find menu',
    links,
    result({ message: '', selections: [{ index: 0, title: 'Regular menu' }] }),
  );
  assert.equal(selection.items[0].url, links[0].url);
  await assert.rejects(
    chooseReferences(
      'test',
      'Find menu',
      links,
      result({ message: '', selections: [{ index: 2, title: 'Fake' }] }),
    ),
    /invalid selection/,
  );
  assert.deepEqual(
    (
      await chooseReferences(
        'test',
        'Find menu',
        links,
        result({ message: 'Which location?', selections: [] }),
      )
    ).items,
    [],
  );
  await assert.rejects(
    chooseReferences(
      'test',
      'Find menu',
      links,
      (async () =>
        new Response('private-provider-error', {
          status: 500,
        })) as typeof fetch,
    ),
    (error: Error) => !error.message.includes('private-provider-error'),
  );
});

void test('Adobe public menu imports use the published PDF and never evaluate script', async () => {
  const source =
    'https://indd.adobe.com/view/079fd1bf-ffba-4cd3-82cb-7b81b8614340';
  const html = (path: string) =>
    `<script>readerViewDataFromServer=${JSON.stringify({ MANIFEST_BODY: JSON.stringify({ documentPdf: path }), VERSION_PREFIX: '64f5' })}</script>`;
  const expected =
    'https://indd.adobe.com/view/publication/079fd1bf-ffba-4cd3-82cb-7b81b8614340/64f5/publication-web-resources/pdf/menu.pdf';
  assert.equal(
    adobePdf(html('publication-web-resources/pdf/menu.pdf'), source),
    expected,
  );
  assert.equal(
    adobePdf(html('https://other.example.org/menu.pdf'), source),
    undefined,
  );
  assert.equal(adobePdf(html('../../private.pdf'), source), undefined);
  assert.equal(
    adobePdf('<script>readerViewDataFromServer=malicious()</script>', source),
    undefined,
  );
  const read: ResourceReader = async (url) => ({
    url,
    type: 'text/html',
    bytes: new TextEncoder().encode(
      html('publication-web-resources/pdf/menu.pdf'),
    ),
  });
  assert.equal(
    await resolveReference(
      { url: source, label: 'Full Menu', page: 'https://brew.example.org/' },
      read,
    ),
    expected,
  );
});

void test('reference downloads reject private networks, redirected private URLs, and oversized streamed bodies', async () => {
  for (const url of [
    'http://example.org',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://user:pass@example.org',
    'https://example.org:8080',
  ])
    assert.throws(() => publicUrl(url));
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '::1',
    'fd00::1',
    'fe80::1',
  ])
    assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress('1.1.1.1'), true);
  assert.equal(publicAddress('2606:4700::1111'), true);
  const fetcher = (ip: string, response: () => Response) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      if (
        (typeof url === 'string'
          ? url
          : url instanceof URL
            ? url.href
            : url.url
        ).startsWith('https://cloudflare-dns.com/')
      )
        return Response.json({ Answer: [{ type: 1, data: ip }] });
      assert.equal(init?.redirect, 'manual');
      assert.equal(new Headers(init?.headers).get('authorization'), null);
      return response();
    }) as typeof fetch;
  await assert.rejects(
    publicReader(
      fetcher('10.0.0.1', () => {
        throw new Error('must not fetch');
      }),
    )('https://private.example.org'),
    /public address/,
  );
  await assert.rejects(
    publicReader(
      fetcher(
        '1.1.1.1',
        () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://127.0.0.1/secret' },
          }),
      ),
    )('https://brew.example.org'),
    /public HTTPS/,
  );
  await assert.rejects(
    publicReader(fetcher('1.1.1.1', () => new Response('oversized')))(
      'https://brew.example.org/menu.pdf',
      3,
    ),
    /too large/,
  );
});

void test('imported menu pages and original persist together offline and survive restart', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem() {} },
  });
  const store = new LaunchStore('reference-test-' + crypto.randomUUID());
  await store.init();
  const entity = createEntity('reference', 'business', {
    title: 'Regular menu',
    website: 'https://brew.example.org/full.pdf',
    report: false,
  });
  const sources = [
    new File(['page one'], 'menu-1.png', { type: 'image/png' }),
    new File(['page two'], 'menu-2.png', { type: 'image/png' }),
    new File(['original PDF'], 'menu.pdf', { type: 'application/pdf' }),
  ];
  const saved = await store.addReferenceFiles(entity, sources, 2);
  const duplicate = await store.addReferenceFiles(
    { ...entity, id: crypto.randomUUID() },
    sources,
    2,
  );
  assert.equal(duplicate.id, saved.id);
  assert.equal(store.data.uploads.length, 3);
  const restarted = new LaunchStore(store.account);
  await restarted.init();
  const copy = restarted.data.records.find((item) => item.id === saved.id)!;
  assert.equal(copy.website, entity.website);
  assert.equal(copy.files.length, 3);
  assert.deepEqual(copy.thumbnail, { type: 'image', fileId: copy.files[0] });
  assert.equal(copy.fileLabels?.[copy.files[1]], 'Page 2');
  assert.equal(copy.fileLabels?.[copy.files[2]], 'Original PDF');
  assert.equal(restarted.data.uploads.length, 3);
  assert.equal(await restarted.data.uploads[2].blob.text(), 'original PDF');
  assert.ok(
    restarted.data.queue.some(
      (op) => op.entityId === copy.id && op.patch.files?.length === 3,
    ),
  );
});
