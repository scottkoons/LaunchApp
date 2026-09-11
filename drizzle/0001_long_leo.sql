CREATE TABLE `agent_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_connections_token_hash_unique` ON `agent_connections` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_agent_connections_owner` ON `agent_connections` (`owner`);--> statement-breakpoint
CREATE TABLE `agent_requests` (
	`connection_id` text NOT NULL,
	`request_id` text NOT NULL,
	`owner` text NOT NULL,
	`entity_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`connection_id`, `request_id`)
);
