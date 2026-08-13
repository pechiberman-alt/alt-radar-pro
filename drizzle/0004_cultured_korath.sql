CREATE TABLE `brain_security_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`symbol` text,
	`timeframe` text,
	`source` text NOT NULL,
	`payload_hash` text NOT NULL,
	`previous_hash` text NOT NULL,
	`chain_hash` text NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brain_security_events_event_key_unique` ON `brain_security_events` (`event_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `brain_security_events_previous_hash_unique` ON `brain_security_events` (`previous_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `brain_security_events_chain_hash_unique` ON `brain_security_events` (`chain_hash`);--> statement-breakpoint
CREATE INDEX `brain_security_events_previous_idx` ON `brain_security_events` (`previous_hash`);--> statement-breakpoint
CREATE INDEX `brain_security_events_time_idx` ON `brain_security_events` (`observed_at`);--> statement-breakpoint
CREATE INDEX `brain_security_events_symbol_idx` ON `brain_security_events` (`symbol`,`timeframe`,`observed_at`);