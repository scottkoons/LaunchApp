CREATE TABLE `permanent_deletions` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`resource` text NOT NULL,
	PRIMARY KEY(`owner`, `id`, `resource`)
);
--> statement-breakpoint
CREATE TRIGGER prevent_purged_record_insert BEFORE INSERT ON records
WHEN EXISTS(SELECT 1 FROM permanent_deletions WHERE owner=NEW.owner AND id=NEW.id AND resource='record')
BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER prevent_purged_record_update BEFORE UPDATE ON records
WHEN EXISTS(SELECT 1 FROM permanent_deletions WHERE owner=NEW.owner AND id=NEW.id AND resource='record')
BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER prevent_purged_operation BEFORE INSERT ON operations
WHEN EXISTS(SELECT 1 FROM permanent_deletions WHERE owner=NEW.owner AND id=json_extract(NEW.result,'$.entity.id') AND resource='record')
BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER prevent_purged_file_insert BEFORE INSERT ON files
WHEN EXISTS(SELECT 1 FROM permanent_deletions WHERE owner=NEW.owner AND id=NEW.id AND resource='file')
BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER prevent_purged_attachment_insert BEFORE INSERT ON records
WHEN EXISTS(SELECT 1 FROM permanent_deletions p,json_tree(NEW.body) j WHERE p.owner=NEW.owner AND p.resource='file' AND p.id=j.atom)
BEGIN SELECT RAISE(ABORT,'An attachment was permanently deleted. Remove it before saving.'); END;
--> statement-breakpoint
CREATE TRIGGER prevent_purged_attachment_update BEFORE UPDATE ON records
WHEN EXISTS(SELECT 1 FROM permanent_deletions p,json_tree(NEW.body) j WHERE p.owner=NEW.owner AND p.resource='file' AND p.id=j.atom)
BEGIN SELECT RAISE(ABORT,'An attachment was permanently deleted. Remove it before saving.'); END;
