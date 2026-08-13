CREATE TABLE `liquidity_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`venue` text NOT NULL,
	`captured_at` text NOT NULL,
	`mid` real NOT NULL,
	`bids` text NOT NULL,
	`asks` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `liquidity_snapshots_market_time_idx` ON `liquidity_snapshots` (`symbol`,`venue`,`captured_at`);--> statement-breakpoint
CREATE INDEX `liquidity_snapshots_captured_idx` ON `liquidity_snapshots` (`captured_at`);