import { owner, database, bucket, json, failure } from '@/lib/server';
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
    const obj = await bucket().get(`${user}/${id}`);
    if (!obj) return json({ error: 'File not found' }, 404);
    const safeInline =
      /^(image\/(png|jpeg|webp|gif)|application\/pdf|audio\/[a-z0-9.+-]+)$/i.test(
        meta.type,
      ) && !new URL(request.url).searchParams.has('download');
    return new Response(obj.body, {
      headers: {
        'Content-Type': meta.type,
        'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      },
    });
  } catch (e) {
    return failure(e);
  }
}
