import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { calculateRankings, type RankingMatch } from "@shared/sessionLogic";
import {
  appNotifications,
  gamePlayers,
  games,
  openSessions,
  participants,
  playerProfiles,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { syncSessionLifecycle } from "./sessionLifecycle";

async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The player database is unavailable.",
    });
  return db;
}

function cleanDisplayName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 160);
}

async function ensureProfile(openId: string, initialName: string) {
  const db = await database();
  const [profile] = await db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.openId, openId))
    .limit(1);
  if (profile) return profile;
  const [user] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  const displayName =
    cleanDisplayName(initialName || user?.name || "") || "Player";
  await db.insert(playerProfiles).values({ openId, displayName });
  const [created] = await db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.openId, openId))
    .limit(1);
  if (!created)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not create the player profile.",
    });
  return created;
}

function publicRankingRows(rows: ReturnType<typeof calculateRankings>) {
  return rows.map(
    ({ identity: _identity, playerOpenId: _openId, ...safe }) => safe
  );
}

function accountRankingRows(
  rows: ReturnType<typeof calculateRankings>,
  openId: string
) {
  return rows.map(({ identity: _identity, playerOpenId, ...safe }) => ({
    ...safe,
    isMe: playerOpenId === openId,
  }));
}

async function loadRankingMatches(sessionId?: number): Promise<RankingMatch[]> {
  const db = await database();
  const matches = await db
    .select({
      id: games.id,
      teamAScore: games.teamAScore,
      teamBScore: games.teamBScore,
      winningTeam: games.winningTeam,
      resultStatus: games.resultStatus,
    })
    .from(games)
    .where(
      sessionId
        ? and(
            eq(games.sessionId, sessionId),
            inArray(games.resultStatus, ["confirmed", "corrected"])
          )
        : inArray(games.resultStatus, ["confirmed", "corrected"])
    );
  const ids = matches.map(match => match.id);
  const links = ids.length
    ? await db
        .select({
          gameId: gamePlayers.gameId,
          participantId: participants.id,
          playerOpenId: participants.playerOpenId,
          fallbackName: participants.name,
          playerNameSnapshot: gamePlayers.playerNameSnapshot,
          team: gamePlayers.team,
        })
        .from(gamePlayers)
        .innerJoin(participants, eq(gamePlayers.participantId, participants.id))
        .where(inArray(gamePlayers.gameId, ids))
    : [];
  return matches.map(match => ({
    teamAScore: match.teamAScore,
    teamBScore: match.teamBScore,
    winningTeam: match.winningTeam,
    resultStatus: match.resultStatus,
    players: links
      .filter(link => link.gameId === match.id)
      .map(link => ({
        participantId: link.participantId,
        playerOpenId: link.playerOpenId,
        name: link.playerNameSnapshot || link.fallbackName,
        team: link.team,
      })),
  }));
}

export async function getPlayerHub(openId: string, initialName: string) {
  const db = await database();
  const profile = await ensureProfile(openId, initialName);
  const memberships = await db
    .select({
      participantId: participants.id,
      checkedIn: participants.checkedIn,
      queuePosition: participants.queuePosition,
      status: participants.status,
      currentCourt: participants.currentCourt,
      sessionId: openSessions.id,
      sessionName: openSessions.name,
      sessionDate: openSessions.sessionDate,
      venue: openSessions.venue,
      sessionStatus: openSessions.status,
      shareToken: openSessions.shareToken,
    })
    .from(participants)
    .innerJoin(openSessions, eq(openSessions.id, participants.sessionId))
    .where(eq(participants.playerOpenId, openId))
    .orderBy(desc(openSessions.sessionDate));
  const ownEntries = await db
    .select({
      gameId: games.id,
      sessionId: games.sessionId,
      sessionName: openSessions.name,
      sessionDate: openSessions.sessionDate,
      venue: openSessions.venue,
      courtNumber: games.courtNumber,
      status: games.status,
      resultStatus: games.resultStatus,
      resultType: games.resultType,
      teamAScore: games.teamAScore,
      teamBScore: games.teamBScore,
      winningTeam: games.winningTeam,
      startedAt: games.startedAt,
      finishedAt: games.finishedAt,
      durationSeconds: games.durationSeconds,
    })
    .from(gamePlayers)
    .innerJoin(participants, eq(participants.id, gamePlayers.participantId))
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(openSessions, eq(openSessions.id, games.sessionId))
    .where(eq(participants.playerOpenId, openId))
    .orderBy(desc(games.finishedAt), desc(games.id));
  const gameIds = [...new Set(ownEntries.map(match => match.gameId))];
  const allEntries = gameIds.length
    ? await db
        .select({
          gameId: gamePlayers.gameId,
          participantId: participants.id,
          playerOpenId: participants.playerOpenId,
          name: gamePlayers.playerNameSnapshot,
          fallbackName: participants.name,
          team: gamePlayers.team,
        })
        .from(gamePlayers)
        .innerJoin(participants, eq(participants.id, gamePlayers.participantId))
        .where(inArray(gamePlayers.gameId, gameIds))
    : [];
  const entriesByGame = new Map<number, typeof allEntries>();
  for (const entry of allEntries)
    entriesByGame.set(entry.gameId, [
      ...(entriesByGame.get(entry.gameId) ?? []),
      entry,
    ]);
  const matches = ownEntries.map(match => ({
    ...match,
    players: (entriesByGame.get(match.gameId) ?? []).map(entry => ({
      name: entry.name || entry.fallbackName,
      team: entry.team,
      isMe: entry.playerOpenId === openId,
    })),
  }));
  const [rankingMatches, notices] = await Promise.all([
    loadRankingMatches(),
    db
      .select({
        id: appNotifications.id,
        sessionId: appNotifications.sessionId,
        gameId: appNotifications.gameId,
        kind: appNotifications.kind,
        title: appNotifications.title,
        body: appNotifications.body,
        readAt: appNotifications.readAt,
        createdAt: appNotifications.createdAt,
      })
      .from(appNotifications)
      .where(eq(appNotifications.recipientOpenId, openId))
      .orderBy(desc(appNotifications.createdAt))
      .limit(50),
  ]);
  const rankings = accountRankingRows(
    calculateRankings(rankingMatches, true),
    openId
  );
  return {
    profile: { displayName: profile.displayName, updatedAt: profile.updatedAt },
    sessions: memberships,
    matches,
    rankings,
    notifications: notices,
  };
}

export async function updatePlayerProfile(openId: string, displayName: string) {
  const clean = cleanDisplayName(displayName);
  if (!clean)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a player name.",
    });
  const db = await database();
  const profile = await ensureProfile(openId, clean);
  await db
    .update(playerProfiles)
    .set({ displayName: clean })
    .where(eq(playerProfiles.id, profile.id));
  await db
    .update(participants)
    .set({ name: clean })
    .where(eq(participants.playerOpenId, openId));
  return { displayName: clean };
}

export async function joinSession(
  openId: string,
  initialName: string,
  token: string,
  displayName?: string
) {
  const db = await database();
  const session = await db
    .select()
    .from(openSessions)
    .where(eq(openSessions.shareToken, token))
    .limit(1)
    .then(rows => rows[0]);
  if (!session)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This invitation link is unavailable.",
    });
  const synchronized = await syncSessionLifecycle(session.id);
  if (
    synchronized.session.status === "ending" ||
    synchronized.session.status === "finished" ||
    synchronized.session.status === "cancelled"
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This session is no longer accepting players.",
    });
  const profile = await ensureProfile(openId, displayName || initialName);
  const name = cleanDisplayName(displayName || profile.displayName);
  if (!name)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a display name before joining.",
    });
  return db.transaction(async tx => {
    const [lockedSession] = await tx
      .select()
      .from(openSessions)
      .where(
        and(eq(openSessions.id, session.id), eq(openSessions.shareToken, token))
      )
      .limit(1)
      .for("update");
    if (!lockedSession)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This invitation link is unavailable.",
      });
    const now = new Date();
    if (
      lockedSession.status === "ending" ||
      lockedSession.status === "finished" ||
      lockedSession.status === "cancelled" ||
      (lockedSession.status === "live" &&
        lockedSession.endsAt &&
        lockedSession.endsAt.getTime() <= now.getTime())
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session is no longer accepting players.",
      });
    const [existingAccount] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.sessionId, session.id),
          eq(participants.playerOpenId, openId)
        )
      )
      .limit(1);
    if (existingAccount)
      return { participantId: existingAccount.id, alreadyJoined: true };
    const current = await tx
      .select({ name: participants.name })
      .from(participants)
      .where(eq(participants.sessionId, session.id));
    if (
      current.some(
        person =>
          person.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "That name is already in this session. Change your display name or ask the organizer.",
      });
    const [highest] = await tx
      .select({ value: max(participants.queuePosition) })
      .from(participants)
      .where(eq(participants.sessionId, session.id));
    const [inserted] = await tx
      .insert(participants)
      .values({
        sessionId: session.id,
        playerOpenId: openId,
        name,
        checkedIn: false,
        queuePosition: Number(highest?.value ?? 0) + 1,
        checkInOrder: 0,
        waitingSince: null,
        registrationStatus: "registered",
      })
      .$returningId();
    return { participantId: inserted?.id ?? null, alreadyJoined: false };
  });
}

export async function playerSessionStatus(openId: string, token: string) {
  const db = await database();
  const [sessionRow] = await db
    .select({ id: openSessions.id })
    .from(openSessions)
    .where(eq(openSessions.shareToken, token))
    .limit(1);
  if (!sessionRow)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This session link is unavailable.",
    });
  const synchronized = await syncSessionLifecycle(sessionRow.id);
  const session = {
    id: synchronized.session.id,
    name: synchronized.session.name,
    shareToken: synchronized.session.shareToken,
    status: synchronized.session.status,
    sessionDate: synchronized.session.sessionDate,
    venue: synchronized.session.venue,
  };
  const [participant] = await db
    .select({
      id: participants.id,
      name: participants.name,
      checkedIn: participants.checkedIn,
      queuePosition: participants.queuePosition,
      status: participants.status,
      currentCourt: participants.currentCourt,
      gamesPlayed: participants.gamesPlayed,
    })
    .from(participants)
    .where(
      and(
        eq(participants.sessionId, session.id),
        eq(participants.playerOpenId, openId)
      )
    )
    .limit(1);
  return { session, participant: participant ?? null };
}

export async function updateOwnCheckIn(
  openId: string,
  token: string,
  checkedIn: boolean
) {
  const db = await database();
  const [session] = await db
    .select()
    .from(openSessions)
    .where(eq(openSessions.shareToken, token))
    .limit(1);
  if (!session)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This session link is unavailable.",
    });
  const synchronized = await syncSessionLifecycle(session.id);
  if (
    synchronized.session.status !== "scheduled" &&
    synchronized.session.status !== "live"
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This session is not accepting check-ins.",
    });
  await db.transaction(async tx => {
    const [lockedSession] = await tx
      .select()
      .from(openSessions)
      .where(
        and(eq(openSessions.id, session.id), eq(openSessions.shareToken, token))
      )
      .limit(1)
      .for("update");
    if (!lockedSession)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This session link is unavailable.",
      });
    const now = new Date();
    if (
      (lockedSession.status !== "scheduled" &&
        lockedSession.status !== "live") ||
      (lockedSession.status === "live" &&
        lockedSession.endsAt &&
        lockedSession.endsAt.getTime() <= now.getTime())
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session is not accepting check-ins.",
      });
    const [person] = await tx
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.sessionId, session.id),
          eq(participants.playerOpenId, openId)
        )
      )
      .limit(1);
    if (!person)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Join this session before checking in.",
      });
    if (!checkedIn && person.currentGameId !== null)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "You are assigned to a court. Ask the organizer to return your match first.",
      });
    let checkInOrder = person.checkInOrder;
    if (checkedIn && !person.checkedIn) {
      const [latest] = await tx
        .select({ value: max(participants.checkInOrder) })
        .from(participants)
        .where(eq(participants.sessionId, session.id));
      checkInOrder = Number(latest?.value ?? 0) + 1;
    }
    await tx
      .update(participants)
      .set({
        checkedIn,
        checkInOrder,
        waitingSince: checkedIn
          ? person.checkedIn
            ? person.waitingSince
            : now
          : null,
      })
      .where(eq(participants.id, person.id));
  });
  return { success: true };
}

export async function sessionRankings(openId: string, token: string) {
  const db = await database();
  const [session] = await db
    .select({ id: openSessions.id, ownerOpenId: openSessions.ownerOpenId })
    .from(openSessions)
    .where(eq(openSessions.shareToken, token))
    .limit(1);
  if (!session)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This session link is unavailable.",
    });
  if (session.ownerOpenId !== openId) {
    const [membership] = await db
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.sessionId, session.id),
          eq(participants.playerOpenId, openId)
        )
      )
      .limit(1);
    if (!membership)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Join this session to view its rankings.",
      });
  }
  const matches = await loadRankingMatches(session.id);
  return accountRankingRows(calculateRankings(matches), openId);
}

export async function listNotifications(openId: string) {
  const db = await database();
  return db
    .select({
      id: appNotifications.id,
      sessionId: appNotifications.sessionId,
      gameId: appNotifications.gameId,
      kind: appNotifications.kind,
      title: appNotifications.title,
      body: appNotifications.body,
      readAt: appNotifications.readAt,
      createdAt: appNotifications.createdAt,
    })
    .from(appNotifications)
    .where(eq(appNotifications.recipientOpenId, openId))
    .orderBy(desc(appNotifications.createdAt))
    .limit(50);
}

export async function markNotificationRead(
  openId: string,
  notificationId: number
) {
  const db = await database();
  await db
    .update(appNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(appNotifications.id, notificationId),
        eq(appNotifications.recipientOpenId, openId)
      )
    );
  return { success: true };
}
