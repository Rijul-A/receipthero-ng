CREATE TABLE `item_name_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rawItemNameLower` text NOT NULL,
	`canonicalName` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_name_overrides_rawItemNameLower_unique` ON `item_name_overrides` (`rawItemNameLower`);--> statement-breakpoint
ALTER TABLE `processing_logs` ADD `storeLocation` text;--> statement-breakpoint
ALTER TABLE `receipt_items` ADD `storeLocation` text;