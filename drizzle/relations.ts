import { relations } from "drizzle-orm";
import {
  appNotifications,
  gamePlayers,
  gameResultAudits,
  games,
  openSessions,
  participants,
  sessionAudit,
} from "./schema";

export const openSessionsRelations = relations(openSessions, ({ many }) => ({
  participants: many(participants),
  games: many(games),
  audit: many(sessionAudit),
  notifications: many(appNotifications),
  resultAudits: many(gameResultAudits),
}));

export const participantsRelations = relations(
  participants,
  ({ one, many }) => ({
    session: one(openSessions, {
      fields: [participants.sessionId],
      references: [openSessions.id],
    }),
    gameEntries: many(gamePlayers),
  })
);

export const gamesRelations = relations(games, ({ one, many }) => ({
  session: one(openSessions, {
    fields: [games.sessionId],
    references: [openSessions.id],
  }),
  players: many(gamePlayers),
}));

export const gamePlayersRelations = relations(gamePlayers, ({ one }) => ({
  game: one(games, { fields: [gamePlayers.gameId], references: [games.id] }),
  participant: one(participants, {
    fields: [gamePlayers.participantId],
    references: [participants.id],
  }),
}));

export const sessionAuditRelations = relations(sessionAudit, ({ one }) => ({
  session: one(openSessions, {
    fields: [sessionAudit.sessionId],
    references: [openSessions.id],
  }),
}));

export const appNotificationsRelations = relations(
  appNotifications,
  ({ one }) => ({
    session: one(openSessions, {
      fields: [appNotifications.sessionId],
      references: [openSessions.id],
    }),
  })
);

export const gameResultAuditRelations = relations(
  gameResultAudits,
  ({ one }) => ({
    session: one(openSessions, {
      fields: [gameResultAudits.sessionId],
      references: [openSessions.id],
    }),
    game: one(games, {
      fields: [gameResultAudits.gameId],
      references: [games.id],
    }),
  })
);
