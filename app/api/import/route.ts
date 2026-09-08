import { owner, database, json, failure, originGuard } from '@/lib/server';
import {
  validateEntity,
  reportEligible,
  migrateLegacyRoutine,
  now,
  type Entity,
} from '@/lib/model';
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const raw = await request.text();
    if (raw.length > 4 * 1024 * 1024) throw new Error('Import batch too large');
    const input = JSON.parse(raw);
    if (!Array.isArray(input.records) || input.records.length > 100)
      throw new Error('Import up to 100 records per batch');
    const entities = input.records.map((original: Entity) => {
      const e = migrateLegacyRoutine(original);
      validateEntity(e);
      if (!e.id || e.id.length > 160) throw new Error('Invalid record ID');
      if (e.kind === 'meeting' && e.snapshot) {
        for (const list of [
          e.snapshot.tasks,
          e.snapshot.completed,
          e.snapshot.backburner,
          e.snapshot.postponed,
          e.snapshot.agenda,
          e.snapshot.events,
        ])
          if (!Array.isArray(list) || list.some((x) => !reportEligible(x)))
            throw new Error('A report contains excluded content.');
      }
      return e;
    });
    const statements = entities.map((e: Entity) =>
      database()
        .prepare(
          'INSERT OR IGNORE INTO records(owner,id,kind,body,version,updated_at) VALUES(?,?,?,?,1,?)',
        )
        .bind(user, e.id, e.kind, JSON.stringify(e), now()),
    );
    if (statements.length) await database().batch(statements);
    return json({ imported: entities.length });
  } catch (e) {
    return failure(e);
  }
}
