import {
  owner,
  database,
  bucket,
  json,
  failure,
  originGuard,
} from '@/lib/server';
import { now } from '@/lib/model';
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const len = Number(request.headers.get('content-length') || 0);
    if (len > 21 * 1024 * 1024)
      return json({ error: 'Files must be 20 MB or smaller.' }, 413);
    const form = await request.formData();
    const file = form.get('file');
    const id = form.get('id');
    if (
      !(file instanceof File) ||
      typeof id !== 'string' ||
      !/^[\w-]{1,100}$/.test(id)
    )
      return json({ error: 'Invalid file' }, 400);
    if (file.size > 20 * 1024 * 1024)
      return json({ error: 'Files must be 20 MB or smaller.' }, 413);
    const prior = await database()
      .prepare(
        'SELECT id,name,type,size,created_at AS createdAt FROM files WHERE owner=? AND id=?',
      )
      .bind(user, id)
      .first();
    if (prior) return json(prior);
    const meta = {
      id,
      name: file.name.slice(0, 250),
      type: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: now(),
    };
    await bucket().put(`${user}/${id}`, file.stream(), {
      httpMetadata: { contentType: meta.type },
    });
    await database()
      .prepare(
        'INSERT OR IGNORE INTO files(owner,id,name,type,size,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(user, id, meta.name, meta.type, meta.size, meta.createdAt)
      .run();
    return json(meta);
  } catch (e) {
    return failure(e);
  }
}
