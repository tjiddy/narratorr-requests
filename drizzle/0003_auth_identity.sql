PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
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
INSERT INTO `__new_users`(
	`id`, `public_id`, `auth_provider`, `auth_subject`, `username`, `password_hash`,
	`email`, `thumb`, `role`, `status`, `request_quota`, `auto_approve`, `created_at`
)
SELECT
	`id`,
	`public_id`,
	-- Map the legacy column-per-provider identity onto (auth_provider, auth_subject).
	-- The old schema set exactly ONE of plex_id / authelia_subject per row (never both),
	-- so this precedence is unambiguous; plex_id='dev-admin' is the AUTH_BYPASS sentinel,
	-- which now lives under the 'local' provider.
	CASE
		WHEN `plex_id` = 'dev-admin' THEN 'local'
		WHEN `plex_id` IS NOT NULL THEN 'plex'
		WHEN `authelia_subject` IS NOT NULL THEN 'authelia'
		ELSE 'local'
	END,
	COALESCE(`plex_id`, `authelia_subject`, `public_id`),
	`plex_username`,
	NULL,
	`email`,
	`thumb`,
	`role`,
	'active',
	`request_quota`,
	`auto_approve`,
	`created_at`
FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_public_id_unique` ON `users` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_provider_subject` ON `users` (`auth_provider`,`auth_subject`);--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `users` (`username`);
