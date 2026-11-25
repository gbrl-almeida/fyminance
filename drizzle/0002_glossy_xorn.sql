CREATE TABLE `category_goals` (
	`month` text NOT NULL,
	`category_id` integer NOT NULL,
	`cents` integer NOT NULL,
	`note` text,
	PRIMARY KEY(`month`, `category_id`)
);
--> statement-breakpoint
CREATE TABLE `divergence_notes` (
	`key` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`explained_at` text NOT NULL,
	`explained_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `month_checks` (
	`month` text NOT NULL,
	`key` text NOT NULL,
	`done_at` text NOT NULL,
	`done_by` text NOT NULL,
	`note` text,
	PRIMARY KEY(`month`, `key`)
);
--> statement-breakpoint
CREATE TABLE `month_closings` (
	`month` text PRIMARY KEY NOT NULL,
	`closed_at` text NOT NULL,
	`closed_by` text NOT NULL,
	`report_path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `month_plans` (
	`month` text PRIMARY KEY NOT NULL,
	`expected_income_cents` integer,
	`investment_goal_cents` integer,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_note_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`delta_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`title` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_name` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_unique` ON `users` (`name`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `counts_as_investment` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `ledger_from` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `ledger_until` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `origin` text DEFAULT 'pluggy' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `created_by` text;