CREATE TABLE `app_state` (
	`id` int NOT NULL,
	`bootstrap_done` boolean NOT NULL DEFAULT false,
	CONSTRAINT `app_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_id` int,
	`action` varchar(64) NOT NULL,
	`target_type` varchar(64) NOT NULL,
	`target_id` varchar(64),
	`details` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`medicine_id` int,
	`service_name` varchar(100),
	`product_name` varchar(150) NOT NULL,
	`barcode_snapshot` varchar(64),
	`quantity` int NOT NULL,
	`unit_price` decimal(10,2) NOT NULL,
	`unit_cost` decimal(10,2) NOT NULL DEFAULT '0.00',
	`total_price` decimal(10,2) NOT NULL,
	CONSTRAINT `invoice_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_number` varchar(30) NOT NULL,
	`idempotency_key` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`shift_id` int NOT NULL,
	`payment_method` enum('cash','card') NOT NULL,
	`total_amount` decimal(10,2) NOT NULL,
	`discount` decimal(10,2) NOT NULL DEFAULT '0.00',
	`net_amount` decimal(10,2) NOT NULL,
	`cash_received` decimal(10,2),
	`change_given` decimal(10,2) NOT NULL DEFAULT '0.00',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoice_number_unique` UNIQUE(`invoice_number`),
	CONSTRAINT `invoices_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `medicines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`barcode` varchar(64),
	`name` varchar(150) NOT NULL,
	`active_ingredient` varchar(150),
	`category_id` int,
	`buy_price` decimal(10,2) NOT NULL DEFAULT '0.00',
	`sell_price` decimal(10,2) NOT NULL DEFAULT '0.00',
	`quantity` int NOT NULL DEFAULT 0,
	`expiry_date` date NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `medicines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`csrf_token` varchar(64) NOT NULL,
	`expires_at` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`start_time` datetime NOT NULL,
	`end_time` datetime,
	`starting_cash` decimal(10,2) NOT NULL DEFAULT '0.00',
	`expected_cash` decimal(10,2),
	`actual_cash` decimal(10,2),
	`cash_difference` decimal(10,2),
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','pharmacist') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(50);--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `is_active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD CONSTRAINT `invoice_items_invoice_id_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoice_items` ADD CONSTRAINT `invoice_items_medicine_id_medicines_id_fk` FOREIGN KEY (`medicine_id`) REFERENCES `medicines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_shift_id_shifts_id_fk` FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicines` ADD CONSTRAINT `medicines_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_actor_created_idx` ON `audit_logs` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_items_medicine_idx` ON `invoice_items` (`medicine_id`);--> statement-breakpoint
CREATE INDEX `invoices_shift_payment_idx` ON `invoices` (`shift_id`,`payment_method`);--> statement-breakpoint
CREATE INDEX `invoices_created_idx` ON `invoices` (`created_at`);--> statement-breakpoint
CREATE INDEX `invoices_user_created_idx` ON `invoices` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `medicines_barcode_idx` ON `medicines` (`barcode`);--> statement-breakpoint
CREATE INDEX `medicines_name_idx` ON `medicines` (`name`);--> statement-breakpoint
CREATE INDEX `medicines_ingredient_idx` ON `medicines` (`active_ingredient`);--> statement-breakpoint
CREATE INDEX `medicines_expiry_quantity_idx` ON `medicines` (`expiry_date`,`quantity`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `shifts_user_status_idx` ON `shifts` (`user_id`,`status`);