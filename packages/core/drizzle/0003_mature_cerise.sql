CREATE TABLE `receipt_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`documentId` integer NOT NULL,
	`vendor` text,
	`itemName` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unitPrice` integer,
	`totalPrice` integer,
	`currency` text,
	`purchaseDate` text,
	`createdAt` text NOT NULL
);
