import { owner, database, json, failure, originGuard } from '@/lib/server';
import { limitedText } from '@/lib/body-limit';
import {
  validateEntity,
  reportEligible,
  validateReportOptions,
  migrateLegacyRoutine,
  migrateReportDefaults,
  now,
  type Entity,
} from '@/lib/model';
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const raw = await limitedText(request, 4 * 1024 * 1024 * 4);
    if (raw === null || raw.length > 4 * 1024 * 1024)
      return json({ error: 'Import batch too large' }, 413);
    const input = JSON.parse(raw);
    if (!Array.isArray(input.records) || input.records.length > 100)
      throw new Error('Import up to 100 records per batch');
    const entities = input.records.map((original: Entity) => {
      const e = migrateReportDefaults(migrateLegacyRoutine(original));
      validateEntity(e);
      if (typeof e.id !== 'string' || !e.id || e.id.length > 160)
        throw new Error('Invalid record ID');
      if (e.kind === 'meeting' && e.snapshot) {
        validateReportOptions(e.snapshot.options);
        for (const list of [
          e.snapshot.tasks,
          e.snapshot.completed,
          e.snapshot.backburner,
          e.snapshot.postponed,
          e.snapshot.agenda,
          e.snapshot.events,
        ])
          if (
            !Array.isArray(list) ||
            list.some(
              (x) =>
                !reportEligible(x) &&
                !(
                  e.snapshot!.options.includePersonal === true &&
                  x.scope === 'personal' &&
                  !x.deletedAt &&
                  x.kind === 'task'
                ),
            )
          )
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
    const results = statements.length ? await database().batch(statements) : [];
    // Existing and permanently deleted IDs are skipped, so count real inserts.
    const imported = results.filter((r) => r.meta.changes).length;
    return json({ imported, skipped: entities.length - imported });
  } catch (e) {
    return failure(e);
  }
}
