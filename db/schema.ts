import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
export const records = sqliteTable(
  'records',
  {
    owner: text('owner').notNull(),
    id: text('id').notNull(),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.owner, t.id] }),
    index('idx_records_owner_kind').on(t.owner, t.kind),
  ],
);
export const operations = sqliteTable(
  'operations',
  {
    owner: text('owner').notNull(),
    id: text('id').notNull(),
    result: text('result').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.id] })],
);
export const files = sqliteTable(
  'files',
  {
    owner: text('owner').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    size: integer('size').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.id] })],
);
