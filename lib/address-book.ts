import type { Entity, FileMeta } from './model';

// Read the original import without rewriting it. Explicit edits, including empty
// values, take precedence over legacy values so clearing a field stays cleared.
export function addressDetails(entity: Entity, files: FileMeta[] = []): Entity {
  const source = entity.legacy?.record;
  const legacy =
    source && typeof source === 'object'
      ? (source as Record<string, unknown>)
      : {};
  const text = (key: string) =>
    typeof legacy[key] === 'string' ? (legacy[key] as string) : '';
  const company = entity.kind === 'company';
  const name = entity.title.trim().split(/\s+/);
  const path = text(company ? 'logo_path' : 'avatar_path')
    .split(/[\\/]/)
    .pop();
  const portrait = path
    ? files.find((f) => entity.files.includes(f.id) && f.name === path)?.id
    : '';
  let notes = entity.notes;
  // The first importer appended structured values to notes. Only remove that
  // exact generated text; preserve anything the user has since edited.
  const importedNotes = company
    ? [
        text('notes'),
        text('website') ? `Website: ${text('website')}` : '',
        text('address') ? `Address: ${text('address')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : [text('title'), text('notes')].filter(Boolean).join('\n');
  if (
    Object.keys(legacy).length &&
    entity.notes === importedNotes &&
    (company
      ? entity.website === undefined && entity.address === undefined
      : entity.jobTitle === undefined)
  )
    notes = text('notes');
  return {
    ...entity,
    notes,
    firstName:
      entity.firstName ?? (text('first_name') || (company ? '' : name[0])),
    lastName:
      entity.lastName ??
      (text('last_name') || (company ? '' : name.slice(1).join(' '))),
    jobTitle: entity.jobTitle ?? text('title'),
    companyName: entity.companyName ?? text('company'),
    website: entity.website ?? text('website'),
    address: entity.address ?? text('address'),
    portraitId: entity.portraitId ?? portrait ?? '',
    email: cleanEmail(entity.email || ''),
    phone: cleanPhone(entity.phone || ''),
  };
}
export const cleanEmail = (value: string) =>
  value.trim().replace(/^mailto:/i, '');
export const cleanPhone = (value: string) => value.trim().replace(/^tel:/i, '');
export function websiteUrl(value: string) {
  const candidate = value.trim();
  if (!candidate) return '';
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    );
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
export function contactCompany(contact: Entity, companies: Entity[]) {
  return (
    companies.find((c) => c.id === contact.companyId)?.title ||
    contact.companyName ||
    ''
  );
}
export function addressSearch(entity: Entity, query: string) {
  return [
    entity.title,
    entity.notes,
    entity.firstName,
    entity.lastName,
    entity.jobTitle,
    entity.companyName,
    entity.email,
    entity.phone,
    entity.website,
    entity.address,
  ]
    .join(' ')
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
export type ContactSort = {
  field: 'title' | 'email' | 'company' | null;
  direction: 1 | -1;
};
export function sortedContacts(
  contacts: Entity[],
  companies: Entity[],
  sort: ContactSort,
) {
  return [...contacts].sort((a, b) => {
    if (!sort.field)
      return (
        (a.lastName || '').localeCompare(b.lastName || '') ||
        (a.firstName || a.title).localeCompare(b.firstName || b.title)
      );
    const value = (e: Entity) =>
      sort.field === 'company'
        ? contactCompany(e, companies)
        : e[sort.field as 'title' | 'email'] || '';
    const left = value(a),
      right = value(b);
    if (!left || !right) return Number(!left) - Number(!right);
    return (
      left.localeCompare(right, undefined, { sensitivity: 'base' }) *
      sort.direction
    );
  });
}
export function addressBookCsv(companies: Entity[], contacts: Entity[]) {
  const cell = (value: string) =>
    '"' +
    (/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') +
    '"';
  const rows = [
    [
      'Company',
      'Company Phone',
      'Company Email',
      'Website',
      'Address',
      'Company Notes',
      'Contact',
      'Title',
      'Contact Email',
      'Contact Phone',
      'Contact Notes',
      'Primary Contact',
    ],
  ];
  const row = (company?: Entity, contact?: Entity) =>
    rows.push([
      company?.title || contact?.companyName || '',
      company?.phone || '',
      company?.email || '',
      company?.website || '',
      company?.address || '',
      company?.notes || '',
      contact?.title || '',
      contact?.jobTitle || '',
      contact?.email || '',
      contact?.phone || '',
      contact?.notes || '',
      contact ? (company?.primaryId === contact.id ? 'Yes' : 'No') : '',
    ]);
  for (const company of [...companies].sort((a, b) =>
    a.title.localeCompare(b.title),
  )) {
    const people = sortedContacts(
      contacts.filter((c) => c.companyId === company.id),
      companies,
      { field: null, direction: 1 },
    );
    if (people.length) people.forEach((contact) => row(company, contact));
    else row(company);
  }
  contacts
    .filter((c) => !companies.some((company) => company.id === c.companyId))
    .forEach((contact) => row(undefined, contact));
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function deliveryRecipient(task: Entity, records: Entity[]) {
  const company = records.find(
    (e) =>
      e.id === task.companyId &&
      e.kind === 'company' &&
      e.scope === task.scope &&
      !e.deletedAt,
  );
  return records.find(
    (e) =>
      e.kind === 'contact' &&
      !e.deletedAt &&
      e.scope === task.scope &&
      (task.contactId
        ? e.id === task.contactId
        : e.id === company?.primaryId && e.companyId === company.id),
  );
}
