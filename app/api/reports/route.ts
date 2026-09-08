import {
  owner,
  database,
  json,
  failure,
  originGuard,
  allRecords,
} from '@/lib/server';
import {
  makeReport,
  createEntity,
  defaultReport,
  validateReportOptions,
} from '@/lib/model';
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const input = (await request.json()) as {
      id?: string;
      options: Record<string, unknown>;
    };
    if (
      input.id !== undefined &&
      (typeof input.id !== 'string' || !input.id || input.id.length > 160)
    )
      throw new Error('Invalid report ID');
    const options = { ...defaultReport(), ...input.options };
    validateReportOptions(options);
    const snapshot = makeReport(await allRecords(user), options);
    const entity = createEntity('meeting', 'business', {
      id: input.id || crypto.randomUUID(),
      title: `Marketing review · ${options.meetingDate}`,
      date: options.meetingDate,
      report: false,
      snapshot,
    });
    entity.files = ['report-' + entity.id];
    const db = database();
    await db
      .prepare(
        'INSERT OR IGNORE INTO records(owner,id,kind,body,version,updated_at) VALUES(?,?,?,?,1,?)',
      )
      .bind(
        user,
        entity.id,
        'meeting',
        JSON.stringify(entity),
        entity.updatedAt,
      )
      .run();
    const row = await db
      .prepare('SELECT body FROM records WHERE owner=? AND id=?')
      .bind(user, entity.id)
      .first<{ body: string }>();
    const saved = JSON.parse(row!.body);
    if (saved.kind !== 'meeting')
      throw new Error(
        'This ID belongs to another record. Generate a new report.',
      );
    return json({ entity: saved });
  } catch (e) {
    return failure(e);
  }
}
