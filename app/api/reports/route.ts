import {
  owner,
  database,
  json,
  failure,
  originGuard,
  allRecords,
} from '@/lib/server';
import { makeReport, createEntity, defaultReport } from '@/lib/model';
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const input = (await request.json()) as {
      id?: string;
      options: Record<string, unknown>;
    };
    const options = { ...defaultReport(), ...input.options };
    for (const key of [
      'meetingDate',
      'from',
      'to',
      'completedFrom',
      'completedTo',
      'agendaFrom',
      'agendaTo',
    ] as const)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(options[key]))
        throw new Error('Choose valid report dates');
    if (
      options.from > options.to ||
      options.completedFrom > options.completedTo ||
      options.agendaFrom > options.agendaTo
    )
      throw new Error('Start dates must come before end dates');
    if (!Array.isArray(options.excluded)) throw new Error('Invalid selection');
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
    return json({ entity: JSON.parse(row!.body) });
  } catch (e) {
    return failure(e);
  }
}
