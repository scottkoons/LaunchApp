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
import { limitedBody } from '@/lib/body-limit';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    originGuard(request);
    const user = await owner();
    const { id } = await params;
    const row = await database()
      .prepare('SELECT body FROM records WHERE owner=? AND id=? AND kind=?')
      .bind(user, id, 'meeting')
      .first<{ body: string }>();
    if (!row) return json({ error: 'Report not found' }, 404);
    const entity = JSON.parse(row.body);
    const key = 'report-' + id;
    const prior = await database()
      .prepare('SELECT id FROM files WHERE owner=? AND id=?')
      .bind(user, key)
      .first();
    if (prior) return json({ id: key });
    const bytes = await limitedBody(request, 20 * 1024 * 1024);
    if (!bytes || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
      throw new Error('Invalid report PDF');
    await bucket().put(`${user}/${key}`, bytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });
    const inserted = await database()
      .prepare(
        'INSERT OR IGNORE INTO files(owner,id,name,type,size,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        user,
        key,
        `Launch-marketing-${entity.date}.pdf`,
        'application/pdf',
        bytes.byteLength,
        now(),
      )
      .run();
    if (!(await keepStoredFile(user, key, inserted.meta.changes)))
      return json({ error: 'This report was permanently deleted.' }, 410);
    return json({ id: key });
  } catch (e) {
    return failure(e);
  }
}
