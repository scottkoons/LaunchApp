import {
  conflictFields,
  type Entity,
  type Kind,
  type Operation,
} from './model';

const nouns: Record<Kind, string> = {
  task: 'task',
  note: 'note',
  agenda: 'agenda item',
  reference: 'reference',
  company: 'company',
  contact: 'contact',
  event: 'event',
  settings: 'setting',
  meeting: 'report',
};
const groups: [string[], string][] = [
  [
    ['draft', 'final', 'review', 'publication', 'plannedDate', 'revisit'],
    'The dates were changed on your other device.',
  ],
  [
    ['date', 'endDate', 'time', 'endTime'],
    'The date or time was changed on your other device.',
  ],
  [
    ['draftDone', 'finalDone'],
    'A milestone was checked off or reopened on your other device.',
  ],
  [
    ['reminderAt', 'reminderZone', 'dueAt', 'dueZone'],
    'The reminder was changed on your other device.',
  ],
  [
    ['files', 'thumbnail', 'portraitId', 'fileLabels'],
    'The attachments were changed on your other device.',
  ],
  [['notes'], 'The notes were edited on your other device.'],
  [['reportNote'], 'The report note was edited on your other device.'],
  [
    ['monthlyNotes'],
    'Notes for the same month were edited on your other device.',
  ],
  [
    [
      'repeat',
      'repeatDays',
      'repeatAnchor',
      'repeatFrom',
      'repeatUntil',
      'excludedDates',
      'seriesStopped',
    ],
    'The repeat schedule was changed on your other device.',
  ],
  [
    ['report', 'includeNotesInReport', 'reportSchedule', 'reportPreferenceSet'],
    'The report settings were changed on your other device.',
  ],
  [
    ['important', 'pinned'],
    'It was pinned or marked important on your other device.',
  ],
  [
    [
      'email',
      'phone',
      'firstName',
      'lastName',
      'jobTitle',
      'companyName',
      'website',
      'address',
      'companyId',
      'contactId',
      'primaryId',
    ],
    'The contact details were changed on your other device.',
  ],
];
// Explain a genuine conflict in everyday words, never field names. The other
// device's values (saved with the conflict) make the wording specific.
export function describeConflict(op: Operation, record?: Entity) {
  const item = `This ${nouns[record?.kind || op.kind] || 'item'}`;
  const theirs = op.conflictRemote || {};
  const known = (key: keyof Entity) => op.conflictRemote && key in theirs;
  const lines: string[] = [];
  const add = (line: string) => {
    if (!lines.includes(line)) lines.push(line);
  };
  for (const key of conflictFields(op)) {
    const field = key as keyof Entity;
    const value = theirs[field];
    if (key === 'status' || key === 'completedAt') {
      const status = key === 'status' ? value : value ? 'completed' : 'active';
      add(
        !known(field)
          ? `Whether ${item.toLowerCase()} is finished was changed on your other device.`
          : status === 'completed'
            ? `${item} was marked complete on your other device.`
            : status === 'postponed'
              ? `${item} was postponed on your other device.`
              : `${item} was reopened on your other device.`,
      );
    } else if (key === 'deletedAt')
      add(
        !known(field)
          ? `${item} was moved to or from Trash on your other device.`
          : value
            ? `${item} was moved to Trash on your other device.`
            : `${item} was restored from Trash on your other device.`,
      );
    else if (key === 'archived')
      add(
        value
          ? `${item} was archived on your other device.`
          : `${item} was brought back from the archive on your other device.`,
      );
    else if (key === 'title')
      add(
        known(field) && typeof value === 'string' && value
          ? `It was renamed “${value}” on your other device.`
          : 'The name was changed on your other device.',
      );
    else if (key === 'scope')
      add(
        value === 'personal'
          ? 'It was moved to Personal on your other device.'
          : value === 'business'
            ? 'It was moved to Business on your other device.'
            : 'It was moved to the other workspace on your other device.',
      );
    else
      add(
        groups.find(([keys]) => keys.includes(key))?.[1] ||
          'Other details were changed on your other device.',
      );
  }
  return lines.length ? lines : [`${item} was changed on your other device.`];
}
// Titles of the items an attachment belongs to, for recovery messages.
export function attachmentOwners(records: Entity[], fileId: string) {
  return records
    .filter(
      (record) =>
        (record.files || []).includes(fileId) ||
        record.portraitId === fileId ||
        (record.thumbnail?.type === 'image' &&
          record.thumbnail.fileId === fileId),
    )
    .map((record) => record.title || 'Untitled item');
}
