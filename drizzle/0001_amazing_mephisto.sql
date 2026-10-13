CREATE TABLE `open_game_players` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`participantId` int NOT NULL,
	`team` enum('A','B') NOT NULL DEFAULT 'A',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `open_game_players_id` PRIMARY KEY(`id`),
	CONSTRAINT `open_game_player_unique_idx` UNIQUE(`gameId`,`participantId`)
);
--> statement-breakpoint
CREATE TABLE `open_games` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`courtNumber` int NOT NULL,
	`status` enum('ready','playing','finished','returned') NOT NULL DEFAULT 'ready',
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `open_games_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `open_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`sessionDate` timestamp NOT NULL,
	`venue` varchar(180) NOT NULL DEFAULT '',
	`shareToken` varchar(64) NOT NULL,
	`strategy` enum('fair','skill') NOT NULL DEFAULT 'fair',
	`groupMode` enum('similar','balanced') NOT NULL DEFAULT 'similar',
	`courtCount` int NOT NULL DEFAULT 2,
	`playersPerGame` int NOT NULL DEFAULT 4,
	`tierConfig` varchar(2000) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `open_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `open_sessions_shareToken_unique` UNIQUE(`shareToken`),
	CONSTRAINT `open_sessions_share_token_idx` UNIQUE(`shareToken`)
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`duprRating` varchar(32),
	`selfRating` varchar(64),
	`manualRating` varchar(64),
	`registrationStatus` varchar(40) NOT NULL DEFAULT 'registered',
	`checkedIn` boolean NOT NULL DEFAULT false,
	`queuePosition` int NOT NULL DEFAULT 0,
	`status` enum('waiting','playing') NOT NULL DEFAULT 'waiting',
	`currentGameId` int,
	`currentCourt` int,
	`gamesPlayed` int NOT NULL DEFAULT 0,
	`checkInOrder` int NOT NULL DEFAULT 0,
	`lastPlayedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `participants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `open_game_players_participant_idx` ON `open_game_players` (`participantId`);--> statement-breakpoint
CREATE INDEX `open_games_session_status_idx` ON `open_games` (`sessionId`,`status`);--> statement-breakpoint
CREATE INDEX `open_sessions_owner_idx` ON `open_sessions` (`ownerOpenId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `participants_session_queue_idx` ON `participants` (`sessionId`,`queuePosition`);--> statement-breakpoint
CREATE INDEX `participants_current_game_idx` ON `participants` (`currentGameId`);