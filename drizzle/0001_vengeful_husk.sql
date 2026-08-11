CREATE TABLE `brain_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`horizon_minutes` integer NOT NULL,
	`direction` text NOT NULL,
	`raw_confidence` integer NOT NULL,
	`calibrated_confidence` integer NOT NULL,
	`entry_price` real NOT NULL,
	`features` text DEFAULT '{}' NOT NULL,
	`detected_at` text NOT NULL,
	`target_at` text NOT NULL,
	`outcome_price` real,
	`directional_return` real,
	`success` integer,
	`evaluated_at` text
);
--> statement-breakpoint
CREATE INDEX `brain_observations_symbol_timeframe_idx` ON `brain_observations` (`symbol`,`timeframe`,`detected_at`);--> statement-breakpoint
CREATE INDEX `brain_observations_evaluation_idx` ON `brain_observations` (`timeframe`,`evaluated_at`);