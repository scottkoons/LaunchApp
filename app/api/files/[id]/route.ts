import { owner, database, bucket, json, failure } from '@/lib/server';
import { fileRange } from '@/lib/file-range';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await owner();
    const { id } = await params;
    const meta = await database()
      .prepare(
        "SELECT name,type FROM files WHERE owner=? AND id=? AND id NOT IN (SELECT id FROM permanent_deletions WHERE owner=? AND resource='file')",
      )
      .bind(user, id, user)
      .first<{ name: string; type: string }>();
    if (!meta) return json({ error: 'File not found' }, 404);
    const storage = bucket();
    const key = `${user}/${id}`;
    const info = await storage.head(key);
    if (!info) return json({ error: 'File not found' }, 404);
    const safeInline =
      /^(image\/(png|jpeg|webp|gif)|application\/pdf|audio\/[a-z0-9.+-]+)$/i.test(
        meta.type,
      ) && !new URL(request.url).searchParams.has('download');
    const headers = new Headers({
      'Content-Type': meta.type,
      'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(info.size),
      ETag: info.httpEtag,
    });
    if (request.method === 'HEAD') return new Response(null, { headers });
    // A stale If-Range validator asks for the complete representation.
    const ifRange = request.headers.get('if-range');
    const range = fileRange(
      ifRange && ifRange !== info.httpEtag
        ? null
        : request.headers.get('range'),
      info.size,
    );
    if (range === 'unsatisfiable') {
      headers.set('Content-Range', `bytes */${info.size}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    const obj = await storage.get(key, range ? { range } : undefined);
    if (!obj) return json({ error: 'File not found' }, 404);
    if (range) {
      headers.set('Content-Length', String(range.length));
      headers.set(
        'Content-Range',
        `bytes ${range.offset}-${range.offset + range.length - 1}/${info.size}`,
      );
    }
    return new Response(obj.body, { status: range ? 206 : 200, headers });
  } catch (e) {
    return failure(e);
  }
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return GET(request, context);
}
