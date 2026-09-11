import {
  owner,
  database,
  bucket,
  json,
  failure,
  originGuard,
} from '@/lib/server';
import {
  purgeTrash,
  cleanupPurgedFiles,
  type TrashTarget,
} from '@/lib/trash-server';

export async function DELETE(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const raw = await request.text();
    if (raw.length > 100000)
      return json({ error: 'Selection too large.' }, 413);
    const input = JSON.parse(raw);
    if (
      !Array.isArray(input.items) ||
      !input.items.length ||
      input.items.length > 500 ||
      input.items.some(
        (item: TrashTarget) =>
          !item ||
          typeof item.id !== 'string' ||
          !item.id ||
          item.id.length > 160 ||
          !Number.isInteger(item.version) ||
          item.version < 1,
      ) ||
      new Set(input.items.map((item: TrashTarget) => item.id)).size !==
        input.items.length
    )
      return json({ error: 'Choose up to 500 items in Trash.' }, 400);
    const result = await purgeTrash(database(), user, input.items);
    let cleanupPending = false;
    try {
      await cleanupPurgedFiles(database(), bucket(), user);
    } catch {
      cleanupPending = true;
    }
    return json({ ...result, cleanupPending });
  } catch (e) {
    return failure(e);
  }
}
