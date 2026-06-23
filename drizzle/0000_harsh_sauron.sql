CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_quota` integer,
	`auto_approve_roles` text DEFAULT '["admin"]' NOT NULL,
	`notify_config` text,
	`connectors` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`asin` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`narrator` text,
	`cover_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`narratorr_book_id` text,
	`note` text,
	`user_caused_failure` integer DEFAULT false NOT NULL,
	`failure_reason` text,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`decided_at` integer,
	`decided_by` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requests_public_id_unique` ON `requests` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_user_id` ON `requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_status` ON `requests` (`status`);--> statement-breakpoint
CREATE INDEX `idx_requests_asin` ON `requests` (`asin`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_requests_user_asin_active` ON `requests` (`user_id`,`asin`) WHERE status IN ('pending','approved','acquiring');--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text NOT NULL,
	`auth_provider` text NOT NULL,
	`auth_subject` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`email` text,
	`thumb` text,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`request_quota` integer,
	`auto_approve` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_public_id_unique` ON `users` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_provider_subject` ON `users` (`auth_provider`,`auth_subject`);--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `users` (`username`);