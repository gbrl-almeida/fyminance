CREATE TABLE `offsets` (
	`credit_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`credit_id`, `purchase_id`)
);
--> statement-breakpoint
CREATE INDEX `offsets_purchase` ON `offsets` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `transaction_notes` (
	`transaction_id` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`transaction_id` text NOT NULL,
	`position` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`category_id` integer NOT NULL,
	`owner` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `position`)
);
--> statement-breakpoint
DROP VIEW `v_transactions`;
--> statement-breakpoint
CREATE VIEW `v_transactions` AS
SELECT
  t.id,
  t.date,
  substr(t.date, 1, 7) AS month,
  t.amount_cents,
  t.description,
  t.merchant_key,
  t.status,
  t.origin,
  t.installment_number,
  t.installment_total,
  a.id AS account_id,
  a.name AS account_name,
  a.kind AS account_kind,
  a.owner AS account_holder,
  c.nature,
  c.transfer_kind,
  c.owner,
  c.source,
  c.confidence,
  c.review_reason,
  c.purchase_group,
  n.note,
  cat.id AS category_id,
  cat.name AS category_name,
  COALESCE(parent.name, cat.name) AS parent_category_name,
  CASE WHEN parent.name IS NULL THEN cat.name ELSE parent.name || ' > ' || cat.name END AS category_path
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN classifications c ON c.transaction_id = t.id
LEFT JOIN transaction_notes n ON n.transaction_id = t.id
LEFT JOIN categories cat ON cat.id = c.category_id
LEFT JOIN categories parent ON parent.id = cat.parent_id
WHERE t.status <> 'removed'
  AND (a.ledger_from IS NULL OR t.date >= a.ledger_from)
  AND (a.ledger_until IS NULL OR t.date < a.ledger_until);
--> statement-breakpoint
CREATE VIEW `v_splits` AS
SELECT
  s.transaction_id,
  s.position,
  s.amount_cents,
  s.owner,
  cat.id AS category_id,
  CASE WHEN parent.name IS NULL THEN cat.name ELSE parent.name || ' > ' || cat.name END AS category_path
FROM transaction_splits s
LEFT JOIN categories cat ON cat.id = s.category_id
LEFT JOIN categories parent ON parent.id = cat.parent_id;
--> statement-breakpoint
CREATE VIEW `v_offsets` AS
SELECT credit_id, purchase_id, amount_cents, created_by, created_at FROM offsets;
