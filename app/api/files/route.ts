import {
  owner,
  database,
  bucket,
  keepStoredFile,
  json,
  failure,
  originGuard,
} from '@/lib/server';
import { now } from '@/lib/model';
import { limitedForm } from '@/lib/body-limit';
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const form = await limitedForm(request, 21 * 1024 * 1024);
    if (!form) return json({ error: 'Files must be 20 MB or smaller.' }, 413);
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
    const removed = await database()
      .prepare(
        "SELECT id FROM permanent_deletions WHERE owner=? AND id=? AND resource='file'",
      )
      .bind(user, id)
      .first();
    if (removed)
      return json(
        { error: 'This attachment was permanently deleted.', removedId: id },
        410,
      );
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
    const inserted = await database()
      .prepare(
        'INSERT OR IGNORE INTO files(owner,id,name,type,size,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(user, id, meta.name, meta.type, meta.size, meta.createdAt)
      .run();
    if (!(await keepStoredFile(user, id, inserted.meta.changes)))
      return json(
        { error: 'This attachment was permanently deleted.', removedId: id },
        410,
      );
    return json(meta);
  } catch (e) {
    return failure(e);
  }
}
