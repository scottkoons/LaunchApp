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
// Content-free markers prevent old devices from recreating permanently deleted data.
export const permanentDeletions = sqliteTable(
  'permanent_deletions',
  {
    owner: text('owner').notNull(),
    id: text('id').notNull(),
    resource: text('resource', { enum: ['record', 'file'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.id, t.resource] })],
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
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    subscription: text('subscription').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_push_subscriptions_owner').on(t.owner)],
);
export const pushDeliveries = sqliteTable(
  'push_deliveries',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    subscriptionId: text('subscription_id').notNull(),
    recordId: text('record_id'),
    reminderAt: text('reminder_at').notNull(),
    sentAt: text('sent_at'),
    leaseUntil: text('lease_until'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [index('idx_push_deliveries_due').on(t.sentAt, t.reminderAt)],
);
export const pushService = sqliteTable('push_service', {
  id: text('id').primaryKey(),
  lastRunAt: text('last_run_at').notNull(),
});
