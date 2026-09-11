CREATE TABLE `push_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`subscription_id` text NOT NULL,
	`record_id` text,
	`reminder_at` text NOT NULL,
	`sent_at` text,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_push_deliveries_due` ON `push_deliveries` (`sent_at`,`reminder_at`);--> statement-breakpoint
CREATE TABLE `push_service` (
	`id` text PRIMARY KEY NOT NULL,
	`last_run_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`subscription` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_push_subscriptions_owner` ON `push_subscriptions` (`owner`);
--> statement-breakpoint
CREATE TRIGGER remove_deleted_push_receipts AFTER DELETE ON records
BEGIN DELETE FROM push_deliveries WHERE owner=OLD.owner AND record_id=OLD.id; END;
