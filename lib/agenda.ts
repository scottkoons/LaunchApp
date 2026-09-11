import type { Entity, Scope } from './model';

function isDiscussed(item: Entity) {
  return !!item.archived || item.status === 'completed';
}

export function agendaItems(
  records: Entity[],
  scope: Scope,
  discussed = false,
) {
  return records
    .filter(
      (item) =>
        item.kind === 'agenda' &&
        item.scope === scope &&
        !item.deletedAt &&
        isDiscussed(item) === discussed,
    )
    .sort((a, b) =>
      discussed
        ? (b.completedAt || b.date || b.updatedAt).localeCompare(
            a.completedAt || a.date || a.updatedAt,
          )
        : Number(!!b.important) - Number(!!a.important) ||
          (a.order || 0) - (b.order || 0) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
    );
}

export function agendaOrderChanges(
  items: Entity[],
  id: string,
  target: string,
) {
  const from = items.findIndex((item) => item.id === id);
  const to = items.findIndex((item) => item.id === target);
  if (
    from < 0 ||
    to < 0 ||
    from === to ||
    !!items[from].important !== !!items[to].important
  )
    return [];
  const reordered = [...items];
  reordered.splice(to, 0, reordered.splice(from, 1)[0]);
  return reordered.flatMap((item, order) =>
    item.order === order ? [] : [{ item, order }],
  );
}
