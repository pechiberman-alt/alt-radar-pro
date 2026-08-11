CREATE TABLE `automation_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`signal` text NOT NULL,
	`score` integer NOT NULL,
	`technical_score` integer NOT NULL,
	`altseason_score` integer,
	`geopolitical_risk` integer,
	`entry_price` real NOT NULL,
	`source` text NOT NULL,
	`timeframe` text DEFAULT '15m / 1H' NOT NULL,
	`detected_at` text NOT NULL,
	`status` text DEFAULT 'MONITORING' NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`penalties` text DEFAULT '[]' NOT NULL,
	`price_15m` real,
	`return_15m` real,
	`captured_15m` text,
	`price_1h` real,
	`return_1h` real,
	`captured_1h` text,
	`price_4h` real,
	`return_4h` real,
	`captured_4h` text,
	`price_24h` real,
	`return_24h` real,
	`captured_24h` text,
	`max_move` real DEFAULT 0 NOT NULL,
	`min_move` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_records_detected_idx` ON `signal_records` (`detected_at`);--> statement-breakpoint
CREATE INDEX `signal_records_symbol_side_idx` ON `signal_records` (`symbol`,`side`);--> statement-breakpoint
CREATE INDEX `signal_records_status_idx` ON `signal_records` (`status`);