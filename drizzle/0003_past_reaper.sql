CREATE TABLE IF NOT EXISTS `app_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipientOpenId` varchar(64) NOT NULL,
	`sessionId` int NOT NULL,
	`gameId` int,
	`kind` varchar(40) NOT NULL,
	`title` varchar(180) NOT NULL,
	`body` text NOT NULL,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `game_result_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`sessionId` int NOT NULL,
	`actorOpenId` varchar(64) NOT NULL,
	`oldTeamAScore` int,
	`oldTeamBScore` int,
	`newTeamAScore` int NOT NULL,
	`newTeamBScore` int NOT NULL,
	`reason` varchar(500) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `game_result_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `player_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`displayName` varchar(160) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `player_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `player_profiles_open_id_unique_idx` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session_audit` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`actorOpenId` varchar(64),
	`kind` varchar(48) NOT NULL,
	`details` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `session_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `open_games` MODIFY COLUMN `status` enum('ready','playing','finished','returned','cancelled') NOT NULL DEFAULT 'ready';--> statement-breakpoint
ALTER TABLE `open_game_players` ADD `playerNameSnapshot` varchar(160);--> statement-breakpoint
ALTER TABLE `open_games` ADD `teamAScore` int;--> statement-breakpoint
ALTER TABLE `open_games` ADD `teamBScore` int;--> statement-breakpoint
ALTER TABLE `open_games` ADD `winningTeam` enum('A','B');--> statement-breakpoint
ALTER TABLE `open_games` ADD `resultType` enum('normal','time_expired','tie');--> statement-breakpoint
ALTER TABLE `open_games` ADD `resultStatus` enum('unresolved','confirmed','corrected','cancelled') DEFAULT 'unresolved' NOT NULL;--> statement-breakpoint
ALTER TABLE `open_games` ADD `resultConfirmedByOpenId` varchar(64);--> statement-breakpoint
ALTER TABLE `open_games` ADD `durationSeconds` int;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `sessionNotes` varchar(2000) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `scheduledStartAt` timestamp;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `durationMinutes` int DEFAULT 240 NOT NULL;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `status` enum('scheduled','live','ending','finished','cancelled') DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `startedAt` timestamp;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `endsAt` timestamp;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `warningSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `expiredAt` timestamp;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `finishedAt` timestamp;--> statement-breakpoint
ALTER TABLE `open_sessions` ADD `cancelledAt` timestamp;--> statement-breakpoint
ALTER TABLE `participants` ADD `playerOpenId` varchar(64);--> statement-breakpoint
ALTER TABLE `participants` ADD CONSTRAINT `participants_player_session_unique_idx` UNIQUE(`sessionId`,`playerOpenId`);--> statement-breakpoint
CREATE INDEX `app_notifications_recipient_idx` ON `app_notifications` (`recipientOpenId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `game_result_audit_game_idx` ON `game_result_audits` (`gameId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `session_audit_session_idx` ON `session_audit` (`sessionId`,`createdAt`);
