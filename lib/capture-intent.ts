type CaptureItem = {
  kind: 'note' | 'task' | 'agenda';
  title: string;
  notes: string;
  dueDate: string;
  reminderLocal: string;
  meetingDate: string;
};
export type CapturePlan = { items: CaptureItem[]; question: string };
export type CaptureState = {
  type: 'voice' | 'photo';
  state: 'pending' | 'review' | 'done';
  capturedAt: string;
  timeZone: string;
  instruction: string;
  transcript?: string;
  plan?: CapturePlan;
  resultIds?: string[];
  resultHashes?: string[];
};
export async function captureFingerprint(entity: object) {
  const content = Object.fromEntries(
    Object.entries(entity)
      .filter(
        ([key]) =>
          !['updatedAt', 'version', 'reportDefaultsVersion'].includes(key),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(content)),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
function validDay(value: string) {
  const time = Date.parse(value + 'T12:00:00Z');
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
  );
}
export function localTime(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
// Resolve wall-clock time in the capture's zone, including DST gaps and repeats.
export function reminderInstant(value: string, zone: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !validDay(value.slice(0, 10))
  )
    throw new Error('Choose a valid reminder date and time.');
  const nominal = Date.parse(value + ':00Z');
  if (!Number.isFinite(nominal))
    throw new Error('Choose a valid reminder time.');
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const instant = nominal + delta;
    offsets.add(
      Date.parse(localTime(new Date(instant).toISOString(), zone) + ':00Z') -
        instant,
    );
  }
  const candidates = [...offsets]
    .map((offset) => new Date(nominal - offset).toISOString())
    .filter((instant) => localTime(instant, zone) === value);
  if (candidates.length !== 1)
    throw new Error(
      'That reminder time falls at a clock change. Choose a different time.',
    );
  return candidates[0];
}
export function validatePlan(value: unknown): CapturePlan {
  const plan = value as CapturePlan;
  if (JSON.stringify(value)?.length > 90000)
    throw new Error(
      'This capture contains too much text. Split it into shorter captures.',
    );
  if (
    !plan ||
    typeof plan.question !== 'string' ||
    plan.question.length > 1000 ||
    !Array.isArray(plan.items) ||
    plan.items.length > 12 ||
    (!plan.items.length && !plan.question)
  )
    throw new Error(
      'The capture could not be understood. Try adding a short instruction.',
    );
  return {
    question: plan.question.trim(),
    items: plan.items.map((item) => {
      if (
        !item ||
        !['task', 'note', 'agenda'].includes(item.kind) ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 500 ||
        typeof item.notes !== 'string' ||
        item.notes.length > 20000 ||
        typeof item.dueDate !== 'string' ||
        (item.dueDate && !validDay(item.dueDate)) ||
        typeof item.meetingDate !== 'string' ||
        (item.meetingDate && !validDay(item.meetingDate)) ||
        typeof item.reminderLocal !== 'string' ||
        (item.reminderLocal &&
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.reminderLocal)) ||
        (item.kind !== 'task' && (item.dueDate || item.reminderLocal)) ||
        (item.kind !== 'agenda' && item.meetingDate)
      )
        throw new Error('The suggested item needs a clearer title or date.');
      return {
        kind: item.kind,
        title: item.title.trim(),
        notes: item.notes,
        dueDate: item.dueDate,
        reminderLocal: item.reminderLocal,
        meetingDate: item.meetingDate,
      };
    }),
  };
}
export function validateCapture(capture: CaptureState) {
  if (
    capture?.resultHashes !== undefined &&
    (!Array.isArray(capture.resultHashes) ||
      capture.resultHashes.length > 12 ||
      capture.resultHashes.some(
        (hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash),
      ))
  )
    throw new Error('Invalid capture history.');
  if (
    !capture ||
    !['voice', 'photo'].includes(capture.type) ||
    !['pending', 'review', 'done'].includes(capture.state) ||
    typeof capture.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(capture.capturedAt)) ||
    typeof capture.timeZone !== 'string' ||
    typeof capture.instruction !== 'string' ||
    capture.instruction.length > 10000 ||
    (capture.transcript !== undefined &&
      (typeof capture.transcript !== 'string' ||
        capture.transcript.length > 40000)) ||
    (capture.resultIds !== undefined &&
      (!Array.isArray(capture.resultIds) ||
        capture.resultIds.length > 12 ||
        capture.resultIds.some(
          (id) => typeof id !== 'string' || id.length > 160,
        )))
  )
    throw new Error('Invalid voice or photo capture.');
  localTime(capture.capturedAt, capture.timeZone);
  if (capture.plan) validatePlan(capture.plan);
}
export const captureSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    question: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['note', 'task', 'agenda'] },
          title: { type: 'string' },
          notes: { type: 'string' },
          dueDate: { type: 'string' },
          reminderLocal: { type: 'string' },
          meetingDate: { type: 'string' },
        },
        required: [
          'kind',
          'title',
          'notes',
          'dueDate',
          'reminderLocal',
          'meetingDate',
        ],
      },
    },
  },
  required: ['question', 'items'],
};
