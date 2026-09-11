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
export const agentConnections = sqliteTable(
  'agent_connections',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('idx_agent_connections_owner').on(t.owner)],
);
export const agentRequests = sqliteTable(
  'agent_requests',
  {
    connectionId: text('connection_id').notNull(),
    requestId: text('request_id').notNull(),
    owner: text('owner').notNull(),
    entityId: text('entity_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.requestId] })],
);
