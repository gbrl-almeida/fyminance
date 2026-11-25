CREATE TABLE `investment_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`net_cents` integer,
	`quantity` real NOT NULL,
	`unit_value` real,
	`raw` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `investment_movements_account_date` ON `investment_movements` (`account_id`,`date`);