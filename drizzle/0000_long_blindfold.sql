CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`owner` text NOT NULL,
	`raw` text
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`taken_at` text NOT NULL,
	`date` text NOT NULL,
	`balance_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_account_date` ON `balance_snapshots` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`due_date` text NOT NULL,
	`total_cents` integer NOT NULL,
	`raw` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `classifications` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`nature` text NOT NULL,
	`transfer_kind` text,
	`transfer_pair_id` text,
	`category_id` integer,
	`owner` text NOT NULL,
	`source` text NOT NULL,
	`rule_id` integer,
	`model` text,
	`confidence` text,
	`purchase_group` text,
	`review_reason` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `classifications_review` ON `classifications` (`review_reason`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`institution` text NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`consent_expires_at` text,
	`last_sync_at` text,
	`last_success_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`merchant_key` text,
	`card_last4` text,
	`account_id` text,
	`min_cents` integer,
	`max_cents` integer,
	`direction` text,
	`set_nature` text,
	`set_category_id` integer,
	`set_owner` text,
	`origin` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`stats` text DEFAULT '{}' NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`merchant_key` text NOT NULL,
	`status` text NOT NULL,
	`card_last4` text,
	`installment_number` integer,
	`installment_total` integer,
	`purchase_date` text,
	`bill_id` text,
	`counterpart_doc_type` text,
	`counterpart_doc` text,
	`raw` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`missing_since` text
);
--> statement-breakpoint
CREATE INDEX `transactions_account_date` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_merchant` ON `transactions` (`merchant_key`);