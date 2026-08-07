PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_receipt_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`documentId` integer,
	`vendor` text,
	`itemName` text NOT NULL,
	`canonicalName` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unitPrice` integer,
	`totalPrice` integer,
	`totalSize` real,
	`sizeUnit` text,
	`currency` text,
	`purchaseDate` text,
	`purchaseTime` text,
	`isSighting` integer DEFAULT false NOT NULL,
	`storeLocation` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_receipt_items`("id", "documentId", "vendor", "itemName", "canonicalName", "quantity", "unitPrice", "totalPrice", "totalSize", "sizeUnit", "currency", "purchaseDate", "purchaseTime", "isSighting", "storeLocation", "sortOrder", "createdAt") SELECT "id", "documentId", "vendor", "itemName", "canonicalName", "quantity", "unitPrice", "totalPrice", "totalSize", "sizeUnit", "currency", "purchaseDate", "purchaseTime", "isSighting", "storeLocation", "sortOrder", "createdAt" FROM `receipt_items`;--> statement-breakpoint
DROP TABLE `receipt_items`;--> statement-breakpoint
ALTER TABLE `__new_receipt_items` RENAME TO `receipt_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;