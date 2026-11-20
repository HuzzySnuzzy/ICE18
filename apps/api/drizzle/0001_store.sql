CREATE TABLE `credit_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`amount` int NOT NULL,
	`balance_after` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`created_by` int,
	`subscription_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prefabs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text NOT NULL,
	`nest_id` int NOT NULL,
	`egg_id` int NOT NULL,
	`docker_image` varchar(255) NOT NULL,
	`startup` text NOT NULL,
	`environment` json NOT NULL,
	`memory` int NOT NULL,
	`swap` int NOT NULL DEFAULT 0,
	`disk` int NOT NULL,
	`io` int NOT NULL DEFAULT 500,
	`cpu` int NOT NULL,
	`databases` int NOT NULL DEFAULT 0,
	`allocations` int NOT NULL DEFAULT 1,
	`backups` int NOT NULL DEFAULT 0,
	`location_ids` json NOT NULL,
	`price` int NOT NULL DEFAULT 0,
	`store_visible` boolean NOT NULL DEFAULT false,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prefabs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`prefab_id` int,
	`ptero_server_id` int NOT NULL,
	`server_identifier` varchar(64) NOT NULL,
	`name` varchar(191) NOT NULL,
	`price` int NOT NULL,
	`status` varchar(16) NOT NULL,
	`cancel_at_period_end` boolean NOT NULL DEFAULT false,
	`paid_until` datetime NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_server_idx` UNIQUE(`ptero_server_id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `credits` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `credit_tx_user_idx` ON `credit_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_user_idx` ON `subscriptions` (`user_id`);