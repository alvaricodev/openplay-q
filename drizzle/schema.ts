import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const openSessions = mysqlTable(
  "open_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    sessionDate: timestamp("sessionDate").notNull(),
    venue: varchar("venue", { length: 180 }).default("").notNull(),
    shareToken: varchar("shareToken", { length: 64 }).notNull().unique(),
    sessionNotes: varchar("sessionNotes", { length: 2000 })
      .notNull()
      .default(""),
    scheduledStartAt: timestamp("scheduledStartAt"),
    durationMinutes: int("durationMinutes").default(240).notNull(),
    status: mysqlEnum("status", [
      "scheduled",
      "live",
      "ending",
      "finished",
      "cancelled",
    ])
      .default("live")
      .notNull(),
    startedAt: timestamp("startedAt"),
    endsAt: timestamp("endsAt"),
    warningSentAt: timestamp("warningSentAt"),
    expiredAt: timestamp("expiredAt"),
    finishedAt: timestamp("finishedAt"),
    cancelledAt: timestamp("cancelledAt"),
    strategy: mysqlEnum("strategy", ["fair", "skill"])
      .default("fair")
      .notNull(),
    groupMode: mysqlEnum("groupMode", ["similar", "balanced"])
      .default("similar")
      .notNull(),
    courtCount: int("courtCount").default(2).notNull(),
    playersPerGame: int("playersPerGame").default(4).notNull(),
    tierConfig: varchar("tierConfig", { length: 2000 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerIdx: index("open_sessions_owner_idx").on(
      table.ownerOpenId,
      table.updatedAt
    ),
    shareIdx: uniqueIndex("open_sessions_share_token_idx").on(table.shareToken),
  })
);

export const participants = mysqlTable(
  "participants",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: int("sessionId").notNull(),
    playerOpenId: varchar("playerOpenId", { length: 64 }),
    name: varchar("name", { length: 160 }).notNull(),
    duprRating: varchar("duprRating", { length: 32 }),
    selfRating: varchar("selfRating", { length: 64 }),
    manualRating: varchar("manualRating", { length: 64 }),
    registrationStatus: varchar("registrationStatus", { length: 40 })
      .default("registered")
      .notNull(),
    checkedIn: boolean("checkedIn").default(false).notNull(),
    queuePosition: int("queuePosition").default(0).notNull(),
    status: mysqlEnum("status", ["waiting", "playing"])
      .default("waiting")
      .notNull(),
    currentGameId: int("currentGameId"),
    currentCourt: int("currentCourt"),
    gamesPlayed: int("gamesPlayed").default(0).notNull(),
    checkInOrder: int("checkInOrder").default(0).notNull(),
    waitingSince: timestamp("waitingSince"),
    lastPlayedAt: timestamp("lastPlayedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    sessionIdx: index("participants_session_queue_idx").on(
      table.sessionId,
      table.queuePosition
    ),
    playerSessionUnique: uniqueIndex(
      "participants_player_session_unique_idx"
    ).on(table.sessionId, table.playerOpenId),
    gameIdx: index("participants_current_game_idx").on(table.currentGameId),
  })
);

export const games = mysqlTable(
  "open_games",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: int("sessionId").notNull(),
    courtNumber: int("courtNumber").notNull(),
    status: mysqlEnum("status", [
      "ready",
      "playing",
      "finished",
      "returned",
      "cancelled",
    ])
      .default("ready")
      .notNull(),
    teamAScore: int("teamAScore"),
    teamBScore: int("teamBScore"),
    winningTeam: mysqlEnum("winningTeam", ["A", "B"]),
    resultType: mysqlEnum("resultType", ["normal", "time_expired", "tie"]),
    resultStatus: mysqlEnum("resultStatus", [
      "unresolved",
      "confirmed",
      "corrected",
      "cancelled",
    ])
      .default("unresolved")
      .notNull(),
    resultConfirmedByOpenId: varchar("resultConfirmedByOpenId", { length: 64 }),
    durationSeconds: int("durationSeconds"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    sessionStatusIdx: index("open_games_session_status_idx").on(
      table.sessionId,
      table.status
    ),
  })
);

export const gamePlayers = mysqlTable(
  "open_game_players",
  {
    id: int("id").autoincrement().primaryKey(),
    gameId: int("gameId").notNull(),
    participantId: int("participantId").notNull(),
    playerNameSnapshot: varchar("playerNameSnapshot", { length: 160 }),
    team: mysqlEnum("team", ["A", "B"]).default("A").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    gamePlayerUnique: uniqueIndex("open_game_player_unique_idx").on(
      table.gameId,
      table.participantId
    ),
    participantIdx: index("open_game_players_participant_idx").on(
      table.participantId
    ),
  })
);

export const playerProfiles = mysqlTable(
  "player_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 160 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    openIdIdx: uniqueIndex("player_profiles_open_id_unique_idx").on(
      table.openId
    ),
  })
);

export const appNotifications = mysqlTable(
  "app_notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    recipientOpenId: varchar("recipientOpenId", { length: 64 }).notNull(),
    sessionId: int("sessionId").notNull(),
    gameId: int("gameId"),
    kind: varchar("kind", { length: 40 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    body: text("body").notNull(),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    recipientIdx: index("app_notifications_recipient_idx").on(
      table.recipientOpenId,
      table.createdAt
    ),
  })
);

export const sessionAudit = mysqlTable(
  "session_audit",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: int("sessionId").notNull(),
    actorOpenId: varchar("actorOpenId", { length: 64 }),
    kind: varchar("kind", { length: 48 }).notNull(),
    details: text("details").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    sessionIdx: index("session_audit_session_idx").on(
      table.sessionId,
      table.createdAt
    ),
  })
);

export const gameResultAudits = mysqlTable(
  "game_result_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    gameId: int("gameId").notNull(),
    sessionId: int("sessionId").notNull(),
    actorOpenId: varchar("actorOpenId", { length: 64 }).notNull(),
    oldTeamAScore: int("oldTeamAScore"),
    oldTeamBScore: int("oldTeamBScore"),
    newTeamAScore: int("newTeamAScore").notNull(),
    newTeamBScore: int("newTeamBScore").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    gameIdx: index("game_result_audit_game_idx").on(
      table.gameId,
      table.createdAt
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type OpenSession = typeof openSessions.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type OpenGame = typeof games.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
export type PlayerProfile = typeof playerProfiles.$inferSelect;
export type AppNotification = typeof appNotifications.$inferSelect;
export type SessionAudit = typeof sessionAudit.$inferSelect;
export type GameResultAudit = typeof gameResultAudits.$inferSelect;
