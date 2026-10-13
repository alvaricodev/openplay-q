import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_TIER_CONFIG,
  RATING_TIERS,
  buildSchedule,
  type GroupMode,
  type QueuePlayer,
  type Strategy,
  type TierConfig,
} from "@shared/openPlay";
import {
  appNotifications,
  gameResultAudits,
  gamePlayers,
  games,
  openSessions,
  participants,
  sessionAudit,
  type OpenSession,
  type Participant,
} from "../drizzle/schema";
import { getDb } from "./db";
import { syncSessionLifecycle } from "./sessionLifecycle";
import { hasTimerExpired, scoreMatch } from "@shared/sessionLogic";

export type DashboardData = {
  sessions: Array<
    Pick<
      OpenSession,
      | "id"
      | "name"
      | "sessionDate"
      | "venue"
      | "status"
      | "scheduledStartAt"
      | "endsAt"
    >
  >;
  session: Omit<OpenSession, "ownerOpenId">;
  serverNow: Date;
  participants: Array<Omit<Participant, "playerOpenId">>;
  games: Array<{
    id: number;
    courtNumber: number;
    status: "ready" | "playing" | "finished" | "returned" | "cancelled";
    teamAScore: number | null;
    teamBScore: number | null;
    winningTeam: "A" | "B" | null;
    resultType: "normal" | "time_expired" | "tie" | null;
    resultStatus: "unresolved" | "confirmed" | "corrected" | "cancelled";
    durationSeconds: number | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    players: Array<{
      participantId: number;
      name: string;
      team: "A" | "B";
      gamesPlayed: number;
    }>;
  }>;
};

export type PublicSessionData = {
  session: {
    name: string;
    sessionDate: Date;
    venue: string;
    courtCount: number;
    playersPerGame: number;
    status: OpenSession["status"];
    scheduledStartAt: Date | null;
    startedAt: Date | null;
    endsAt: Date | null;
    durationMinutes: number;
    activeMatchCount: number;
    serverNow: Date;
  };
  courts: Array<{
    gameId: number;
    courtNumber: number;
    status: "ready" | "playing";
    teamAScore: number | null;
    teamBScore: number | null;
    winningTeam: "A" | "B" | null;
    resultStatus: "unresolved" | "confirmed" | "corrected" | "cancelled";
    players: Array<{ name: string; team: "A" | "B" }>;
  }>;
  waiting: Array<{ name: string; position: number }>;
  checkedInCount: number;
};

function database() {
  return getDb().then(db => {
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The session database is unavailable.",
      });
    return db;
  });
}

function makeShareToken() {
  return randomBytes(32).toString("base64url");
}

function parseTierConfig(value: string): TierConfig {
  try {
    const parsed = JSON.parse(value) as TierConfig;
    if (
      Array.isArray(parsed.duprThresholds) &&
      parsed.duprThresholds.length === RATING_TIERS.length - 1 &&
      Array.isArray(parsed.selfNumericThresholds) &&
      parsed.selfNumericThresholds.length === RATING_TIERS.length - 1 &&
      parsed.duprThresholds.every(Number.isFinite) &&
      parsed.selfNumericThresholds.every(Number.isFinite) &&
      parsed.duprThresholds.every(
        (n, i, values) => i === 0 || n > values[i - 1]
      ) &&
      parsed.selfNumericThresholds.every(
        (n, i, values) => i === 0 || n > values[i - 1]
      ) &&
      parsed.selfLabels &&
      typeof parsed.selfLabels === "object"
    )
      return parsed;
  } catch {}
  return DEFAULT_TIER_CONFIG;
}

async function sessionById(
  ownerOpenId: string,
  sessionId: number
): Promise<OpenSession> {
  const db = await database();
  const [session] = await db
    .select()
    .from(openSessions)
    .where(
      and(
        eq(openSessions.id, sessionId),
        eq(openSessions.ownerOpenId, ownerOpenId)
      )
    )
    .limit(1);
  if (!session)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Session not found or you do not have access.",
    });
  return session;
}

function assertSessionEditable(session: OpenSession) {
  if (
    (session.status !== "scheduled" && session.status !== "live") ||
    (session.status === "live" &&
      session.endsAt !== null &&
      session.endsAt.getTime() <= Date.now())
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This session is read-only, in settlement, or past its end time.",
    });
}

function assertSessionPlayable(session: OpenSession, now = new Date()) {
  if (
    session.status !== "live" ||
    (session.endsAt && session.endsAt.getTime() <= now.getTime())
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This session is not accepting new matches.",
    });
}

async function createSessionRow(
  ownerOpenId: string,
  input: {
    name: string;
    sessionDate: Date;
    venue: string;
    scheduledStartAt?: Date;
    durationMinutes?: number;
    sessionNotes?: string;
    courtCount?: number;
    playersPerGame?: number;
    strategy?: Strategy;
    groupMode?: GroupMode;
  }
): Promise<OpenSession> {
  const db = await database();
  const shareToken = makeShareToken();
  const inserted = await db
    .insert(openSessions)
    .values({
      ownerOpenId,
      name: input.name.trim().slice(0, 160) || "Open Play",
      sessionDate: input.sessionDate,
      venue: input.venue.trim().slice(0, 180),
      shareToken,
      sessionNotes: input.sessionNotes?.trim().slice(0, 2000) ?? "",
      scheduledStartAt: input.scheduledStartAt ?? input.sessionDate,
      durationMinutes: input.durationMinutes ?? 240,
      status: "scheduled",
      strategy: input.strategy ?? "fair",
      groupMode: input.groupMode ?? "similar",
      courtCount: input.courtCount ?? 2,
      playersPerGame: input.playersPerGame ?? 4,
      tierConfig: JSON.stringify(DEFAULT_TIER_CONFIG),
    })
    .$returningId();
  const sessionId = inserted[0]?.id;
  if (!sessionId)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not create session.",
    });

  await db.insert(sessionAudit).values({
    sessionId,
    actorOpenId: ownerOpenId,
    kind: "session_created",
    details: JSON.stringify({
      name: input.name.trim().slice(0, 160) || "Open Play",
      scheduledStartAt: (
        input.scheduledStartAt ?? input.sessionDate
      ).toISOString(),
      durationMinutes: input.durationMinutes ?? 240,
      courtCount: input.courtCount ?? 2,
      playersPerGame: input.playersPerGame ?? 4,
      strategy: input.strategy ?? "fair",
    }),
  });

  const [session] = await db
    .select()
    .from(openSessions)
    .where(eq(openSessions.id, sessionId))
    .limit(1);
  if (!session)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Session was created but could not be loaded.",
    });
  return session;
}

async function ownedSessions(ownerOpenId: string) {
  const db = await database();
  return db
    .select({
      id: openSessions.id,
      name: openSessions.name,
      sessionDate: openSessions.sessionDate,
      venue: openSessions.venue,
      status: openSessions.status,
      scheduledStartAt: openSessions.scheduledStartAt,
      endsAt: openSessions.endsAt,
    })
    .from(openSessions)
    .where(eq(openSessions.ownerOpenId, ownerOpenId))
    .orderBy(desc(openSessions.updatedAt), desc(openSessions.id));
}

async function snapshot(
  ownerOpenId: string,
  session: OpenSession
): Promise<DashboardData> {
  const { session: activeSession, serverNow } = await syncSessionLifecycle(
    session.id
  );
  const db = await database();
  const [sessionList, people, gameRows] = await Promise.all([
    ownedSessions(ownerOpenId),
    db
      .select()
      .from(participants)
      .where(eq(participants.sessionId, activeSession.id))
      .orderBy(asc(participants.queuePosition), asc(participants.id)),
    db
      .select()
      .from(games)
      .where(eq(games.sessionId, activeSession.id))
      .orderBy(desc(games.id)),
  ]);
  const gameIds = gameRows.map(game => game.id);
  const links = gameIds.length
    ? await db
        .select({
          gameId: gamePlayers.gameId,
          participantId: gamePlayers.participantId,
          team: gamePlayers.team,
          playerNameSnapshot: gamePlayers.playerNameSnapshot,
        })
        .from(gamePlayers)
        .where(inArray(gamePlayers.gameId, gameIds))
    : [];
  const peopleById = new Map(people.map(person => [person.id, person]));
  const linksByGame = new Map<number, typeof links>();
  for (const link of links)
    linksByGame.set(link.gameId, [
      ...(linksByGame.get(link.gameId) ?? []),
      link,
    ]);
  const mappedGames = gameRows.map(
    ({ resultConfirmedByOpenId: _resultConfirmedByOpenId, ...game }) => ({
      ...game,
      players: (linksByGame.get(game.id) ?? []).flatMap(link => {
        const person = peopleById.get(link.participantId);
        return person
          ? [
              {
                participantId: person.id,
                name: link.playerNameSnapshot || person.name,
                team: link.team,
                gamesPlayed: person.gamesPlayed,
              },
            ]
          : [];
      }),
    })
  );
  const { ownerOpenId: _ownerOpenId, ...safeSession } = activeSession;
  const safePeople = people.map(
    ({ playerOpenId: _playerOpenId, ...person }) => person
  );
  return {
    sessions: sessionList,
    session: safeSession,
    serverNow,
    participants: safePeople,
    games: mappedGames,
  };
}

export async function getCurrentDashboard(
  ownerOpenId: string
): Promise<DashboardData> {
  const db = await database();
  let [session] = await db
    .select()
    .from(openSessions)
    .where(eq(openSessions.ownerOpenId, ownerOpenId))
    .orderBy(desc(openSessions.updatedAt), desc(openSessions.id))
    .limit(1);
  if (!session) {
    const now = new Date();
    session = await createSessionRow(ownerOpenId, {
      name: "Open Play",
      sessionDate: now,
      scheduledStartAt: now,
      venue: "",
      durationMinutes: 240,
    });
  }
  return snapshot(ownerOpenId, session);
}

export async function getDashboard(
  ownerOpenId: string,
  sessionId: number
): Promise<DashboardData> {
  return snapshot(ownerOpenId, await sessionById(ownerOpenId, sessionId));
}

export async function createSession(
  ownerOpenId: string,
  input: {
    name: string;
    sessionDate: string;
    scheduledStartAt: string;
    durationMinutes: number;
    courtCount: number;
    playersPerGame: number;
    strategy: Strategy;
    groupMode: GroupMode;
    venue: string;
    notes?: string;
  }
) {
  const date = new Date(input.sessionDate);
  const scheduledStart = new Date(input.scheduledStartAt);
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(scheduledStart.getTime())
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a valid session date.",
    });
  const session = await createSessionRow(ownerOpenId, {
    name: input.name,
    sessionDate: date,
    scheduledStartAt: scheduledStart,
    durationMinutes: input.durationMinutes,
    courtCount: input.courtCount,
    playersPerGame: input.playersPerGame,
    strategy: input.strategy,
    groupMode: input.groupMode,
    sessionNotes: input.notes ?? "",
    venue: input.venue,
  });
  return snapshot(ownerOpenId, session);
}

export async function updateSessionSettings(
  ownerOpenId: string,
  sessionId: number,
  input: {
    courtCount: number;
    playersPerGame: number;
    strategy: Strategy;
    groupMode: GroupMode;
    tierConfig: TierConfig;
  }
) {
  const db = await database();
  const thresholdsValid = (values: number[]) =>
    values.length === RATING_TIERS.length - 1 &&
    values.every(Number.isFinite) &&
    values.every((n, i) => i === 0 || n > values[i - 1]);
  if (
    !thresholdsValid(input.tierConfig.duprThresholds) ||
    !thresholdsValid(input.tierConfig.selfNumericThresholds)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Rating cutoffs must be four increasing numbers for each rating source.",
    });
  }
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(
        and(
          eq(openSessions.id, sessionId),
          eq(openSessions.ownerOpenId, ownerOpenId)
        )
      )
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    assertSessionEditable(session);
    const [activeCourt] = await tx
      .select({ highest: max(games.courtNumber) })
      .from(games)
      .where(
        and(
          eq(games.sessionId, sessionId),
          inArray(games.status, ["ready", "playing"])
        )
      );
    if (input.courtCount < Number(activeCourt?.highest ?? 0))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Return or finish the active court before reducing the court count.",
      });
    await tx
      .update(openSessions)
      .set({
        courtCount: Math.max(1, Math.min(12, input.courtCount)),
        playersPerGame: Math.max(2, Math.min(8, input.playersPerGame)),
        strategy: input.strategy,
        groupMode: input.groupMode,
        tierConfig: JSON.stringify(input.tierConfig),
      })
      .where(eq(openSessions.id, sessionId));
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function addPlayer(
  ownerOpenId: string,
  input: {
    sessionId: number;
    name: string;
    duprRating?: string;
    selfRating?: string;
    manualRating?: string;
  }
) {
  const db = await database();
  const name = input.name.trim().slice(0, 160);
  if (!name)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a player name.",
    });
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(
        and(
          eq(openSessions.id, input.sessionId),
          eq(openSessions.ownerOpenId, ownerOpenId)
        )
      )
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    assertSessionEditable(session);
    const current = await tx
      .select({ name: participants.name })
      .from(participants)
      .where(eq(participants.sessionId, input.sessionId));
    if (
      current.some(
        person =>
          person.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: `${name} is already in this session.`,
      });
    const [highest] = await tx
      .select({ value: max(participants.queuePosition) })
      .from(participants)
      .where(eq(participants.sessionId, input.sessionId));
    const inserted = await tx
      .insert(participants)
      .values({
        sessionId: input.sessionId,
        name,
        duprRating: input.duprRating?.trim().slice(0, 32) || null,
        selfRating: input.selfRating?.trim().slice(0, 64) || null,
        manualRating: input.manualRating?.trim().slice(0, 64) || null,
        registrationStatus: "registered",
        checkedIn: false,
        queuePosition: Number(highest?.value ?? 0) + 1,
        checkInOrder: 0,
        waitingSince: null,
      })
      .$returningId();
    if (!inserted[0])
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not add player.",
      });
  });
  return getDashboard(ownerOpenId, input.sessionId);
}

export async function importPlayers(
  ownerOpenId: string,
  input: {
    sessionId: number;
    players: Array<{
      name: string;
      duprRating?: string;
      selfRating?: string;
      manualRating?: string;
      registrationStatus?: string;
      checkedIn?: boolean;
    }>;
  }
) {
  const db = await database();
  if (input.players.length > 300)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Import up to 300 participants at a time.",
    });
  let added = 0;
  let duplicateCount = 0;
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(
        and(
          eq(openSessions.id, input.sessionId),
          eq(openSessions.ownerOpenId, ownerOpenId)
        )
      )
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    assertSessionEditable(session);
    const existing = await tx
      .select({
        name: participants.name,
        queuePosition: participants.queuePosition,
        checkInOrder: participants.checkInOrder,
      })
      .from(participants)
      .where(eq(participants.sessionId, input.sessionId));
    const names = new Set(
      existing.map(player => player.name.trim().toLocaleLowerCase())
    );
    let nextQueuePosition = Math.max(
      0,
      ...existing.map(player => player.queuePosition)
    );
    let nextCheckInOrder = Math.max(
      0,
      ...existing.map(player => player.checkInOrder)
    );
    const accepted = input.players.flatMap(player => {
      const name = player.name.trim().slice(0, 160);
      if (!name || names.has(name.toLocaleLowerCase())) {
        duplicateCount += 1;
        return [];
      }
      names.add(name.toLocaleLowerCase());
      const checkedIn = player.checkedIn ?? false;
      return [
        {
          sessionId: input.sessionId,
          name,
          duprRating: player.duprRating?.trim().slice(0, 32) || null,
          selfRating: player.selfRating?.trim().slice(0, 64) || null,
          manualRating: player.manualRating?.trim().slice(0, 64) || null,
          registrationStatus:
            player.registrationStatus?.trim().slice(0, 40) || "registered",
          checkedIn,
          queuePosition: ++nextQueuePosition,
          checkInOrder: checkedIn ? ++nextCheckInOrder : 0,
          waitingSince: checkedIn ? new Date() : null,
        },
      ];
    });
    if (accepted.length) await tx.insert(participants).values(accepted);
    added = accepted.length;
  });
  return {
    added,
    duplicates: duplicateCount,
    dashboard: await getDashboard(ownerOpenId, input.sessionId),
  };
}

export async function updateCheckIn(
  ownerOpenId: string,
  sessionId: number,
  participantId: number,
  checkedIn: boolean
) {
  const db = await database();
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(
        and(
          eq(openSessions.id, sessionId),
          eq(openSessions.ownerOpenId, ownerOpenId)
        )
      )
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    assertSessionEditable(session);
    const [person] = await tx
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.id, participantId),
          eq(participants.sessionId, sessionId)
        )
      )
      .limit(1);
    if (!person)
      throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
    if (!checkedIn && person.currentGameId !== null)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Return this player from their court before checking them out.",
      });
    let checkInOrder = person.checkInOrder;
    if (checkedIn && !person.checkedIn) {
      const [result] = await tx
        .select({ value: max(participants.checkInOrder) })
        .from(participants)
        .where(eq(participants.sessionId, sessionId));
      checkInOrder = Number(result?.value ?? 0) + 1;
    }
    await tx
      .update(participants)
      .set({
        checkedIn,
        checkInOrder,
        status: "waiting",
        waitingSince: checkedIn
          ? person.checkedIn
            ? person.waitingSince
            : new Date()
          : null,
      })
      .where(eq(participants.id, participantId));
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function updatePlayerRating(
  ownerOpenId: string,
  input: {
    sessionId: number;
    participantId: number;
    duprRating?: string;
    selfRating?: string;
    manualRating?: string;
  }
) {
  const db = await database();
  assertSessionEditable(await sessionById(ownerOpenId, input.sessionId));
  const [person] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.id, input.participantId),
        eq(participants.sessionId, input.sessionId)
      )
    )
    .limit(1);
  if (!person)
    throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
  await db
    .update(participants)
    .set({
      duprRating: input.duprRating?.trim().slice(0, 32) || null,
      selfRating: input.selfRating?.trim().slice(0, 64) || null,
      manualRating: input.manualRating?.trim().slice(0, 64) || null,
    })
    .where(eq(participants.id, input.participantId));
  return getDashboard(ownerOpenId, input.sessionId);
}

export async function movePlayer(
  ownerOpenId: string,
  sessionId: number,
  participantId: number,
  direction: -1 | 1
) {
  const db = await database();
  assertSessionEditable(await sessionById(ownerOpenId, sessionId));
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(
        and(
          eq(openSessions.id, sessionId),
          eq(openSessions.ownerOpenId, ownerOpenId)
        )
      )
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    assertSessionEditable(session);
    const ordered = await tx
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.sessionId, sessionId),
          eq(participants.checkedIn, true),
          isNull(participants.currentGameId)
        )
      )
      .orderBy(asc(participants.queuePosition), asc(participants.id));
    const from = ordered.findIndex(person => person.id === participantId);
    const to = from + direction;
    if (from < 0)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Waiting player not found.",
      });
    if (to < 0 || to >= ordered.length) return;
    const reordered = [...ordered];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    for (let index = 0; index < reordered.length; index += 1) {
      await tx
        .update(participants)
        .set({ queuePosition: index + 1 })
        .where(eq(participants.id, reordered[index].id));
    }
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function generateQueue(
  ownerOpenId: string,
  sessionId: number,
  strategy: Strategy
) {
  const db = await database();
  await sessionById(ownerOpenId, sessionId);
  const synchronized = await syncSessionLifecycle(sessionId);
  assertSessionPlayable(synchronized.session, synchronized.serverNow);

  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(eq(openSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
    assertSessionPlayable(session);

    const occupiedGames = await tx
      .select({ courtNumber: games.courtNumber })
      .from(games)
      .where(
        and(
          eq(games.sessionId, sessionId),
          inArray(games.status, ["ready", "playing"])
        )
      );
    const occupiedCourts = new Set(occupiedGames.map(game => game.courtNumber));
    const availableCourts = Array.from(
      { length: session.courtCount },
      (_, index) => index + 1
    ).filter(courtNumber => !occupiedCourts.has(courtNumber));

    await tx
      .update(openSessions)
      .set({ strategy })
      .where(eq(openSessions.id, sessionId));
    const people = await tx
      .select()
      .from(participants)
      .where(eq(participants.sessionId, sessionId))
      .orderBy(asc(participants.queuePosition), asc(participants.id));
    const queuePeople: QueuePlayer[] = people.map(person => ({
      id: person.id,
      name: person.name,
      duprRating: person.duprRating,
      selfRating: person.selfRating,
      manualRating: person.manualRating,
      checkedIn: person.checkedIn,
      queuePosition: person.queuePosition,
      gamesPlayed: person.gamesPlayed,
      checkInOrder: person.checkInOrder,
      waitingSince: person.waitingSince,
      lastPlayedAt: person.lastPlayedAt,
      currentGameId: person.currentGameId,
    }));
    const schedule = buildSchedule(queuePeople, {
      strategy,
      groupMode: session.groupMode,
      courtCount: session.courtCount,
      playersPerGame: session.playersPerGame,
      tierConfig: parseTierConfig(session.tierConfig),
      availableCourts,
    });
    const waitingIds = new Set(schedule.waiting.map(person => person.id));
    const newQueue = [
      ...schedule.ordered,
      ...people.filter(person => !person.checkedIn && !person.currentGameId),
    ];
    for (let index = 0; index < newQueue.length; index += 1) {
      if (newQueue[index].currentGameId === null)
        await tx
          .update(participants)
          .set({ queuePosition: index + 1 })
          .where(eq(participants.id, newQueue[index].id));
    }

    for (const court of schedule.courts) {
      const [game] = await tx
        .insert(games)
        .values({ sessionId, courtNumber: court.courtNumber, status: "ready" })
        .$returningId();
      if (!game) continue;
      await tx.insert(gamePlayers).values(
        court.players.map((person, index) => ({
          gameId: game.id,
          participantId: person.id,
          team: court.teams[index] ?? "A",
          playerNameSnapshot: person.name,
        }))
      );
      const assignmentNotices = court.players.flatMap((person, index) => {
        const record = people.find(candidate => candidate.id === person.id);
        if (!record?.playerOpenId) return [];
        const team = court.teams[index] ?? "A";
        const teammates = court.players
          .filter(
            (_, playerIndex) =>
              court.teams[playerIndex] === team &&
              court.players[playerIndex].id !== person.id
          )
          .map(player => player.name);
        const opponents = court.players
          .filter((_, playerIndex) => court.teams[playerIndex] !== team)
          .map(player => player.name);
        return [
          {
            recipientOpenId: record.playerOpenId,
            sessionId,
            gameId: game.id,
            kind: "court_assignment",
            title: `Court ${court.courtNumber} is ready`,
            body: `Your team: ${[person.name, ...teammates].join(" & ")}. Opposing team: ${opponents.join(" & ") || "not set"}.`,
          },
        ];
      });
      if (assignmentNotices.length)
        await tx.insert(appNotifications).values(assignmentNotices);
      for (const person of court.players)
        await tx
          .update(participants)
          .set({
            currentGameId: game.id,
            currentCourt: court.courtNumber,
            status: "waiting",
            waitingSince: null,
          })
          .where(eq(participants.id, person.id));
    }
    for (const id of waitingIds)
      await tx
        .update(participants)
        .set({ status: "waiting" })
        .where(eq(participants.id, id));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "queue_generated",
      details: JSON.stringify({
        strategy,
        courtsAssigned: schedule.courts.length,
        at: new Date().toISOString(),
      }),
    });
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function startGame(
  ownerOpenId: string,
  sessionId: number,
  gameId: number
) {
  const db = await database();
  await sessionById(ownerOpenId, sessionId);
  const synchronized = await syncSessionLifecycle(sessionId);
  assertSessionPlayable(synchronized.session, synchronized.serverNow);
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(eq(openSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
    assertSessionPlayable(session);
    const [game] = await tx
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.sessionId, sessionId)))
      .limit(1);
    if (!game || game.status !== "ready")
      throw new TRPCError({
        code: "CONFLICT",
        message: "This court is not ready to start.",
      });
    const assigned = await tx
      .select({
        id: participants.id,
        name: participants.name,
        playerOpenId: participants.playerOpenId,
        currentGameId: participants.currentGameId,
        checkedIn: participants.checkedIn,
      })
      .from(participants)
      .innerJoin(gamePlayers, eq(gamePlayers.participantId, participants.id))
      .where(eq(gamePlayers.gameId, gameId));
    if (
      assigned.length < 2 ||
      assigned.some(
        person => !person.checkedIn || person.currentGameId !== gameId
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Every assigned player must be checked in and available.",
      });
    const now = new Date();
    await tx
      .update(games)
      .set({ status: "playing", startedAt: now })
      .where(eq(games.id, gameId));
    await tx
      .update(participants)
      .set({ status: "playing" })
      .where(
        inArray(
          participants.id,
          assigned.map(person => person.id)
        )
      );
    const targets = [
      ...new Set([
        session.ownerOpenId,
        ...assigned.flatMap(person =>
          person.playerOpenId ? [person.playerOpenId] : []
        ),
      ]),
    ];
    if (targets.length)
      await tx.insert(appNotifications).values(
        targets.map(recipientOpenId => ({
          recipientOpenId,
          sessionId,
          gameId,
          kind: "game_started",
          title: `Court ${game.courtNumber} is in play`,
          body: `${assigned.map(person => person.name).join(", ")} have started their match.`,
        }))
      );
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function finishGame(
  ownerOpenId: string,
  sessionId: number,
  gameId: number,
  input: { teamAScore: number; teamBScore: number }
) {
  const db = await database();
  await sessionById(ownerOpenId, sessionId);
  const synchronized = await syncSessionLifecycle(sessionId);
  if (
    synchronized.session.status !== "live" &&
    synchronized.session.status !== "ending"
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "This session is closed to match settlement.",
    });
  let scheduleNext = false;
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(eq(openSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session || (session.status !== "live" && session.status !== "ending"))
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session is closed to match settlement.",
      });
    const [game] = await tx
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.sessionId, sessionId)))
      .limit(1);
    if (!game || game.status !== "playing")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Start the game before entering its score.",
      });
    const assigned = await tx
      .select({
        id: participants.id,
        name: participants.name,
        playerOpenId: participants.playerOpenId,
        currentGameId: participants.currentGameId,
        team: gamePlayers.team,
      })
      .from(participants)
      .innerJoin(gamePlayers, eq(gamePlayers.participantId, participants.id))
      .where(eq(gamePlayers.gameId, gameId));
    if (
      assigned.length < 2 ||
      assigned.some(person => person.currentGameId !== gameId)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The match player list is inconsistent; ask the organizer to review this court.",
      });
    const now = new Date();
    const timeExpired = hasTimerExpired(session.expiredAt, session.endsAt, now);
    let scored: ReturnType<typeof scoreMatch>;
    try {
      scored = scoreMatch(
        input.teamAScore,
        input.teamBScore,
        timeExpired ? "time_expired" : "normal"
      );
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          error instanceof Error ? error.message : "Enter a valid score.",
      });
    }
    const durationSeconds = game.startedAt
      ? Math.max(
          0,
          Math.floor((now.getTime() - game.startedAt.getTime()) / 1000)
        )
      : null;
    const resultType = scored.winningTeam === null ? "tie" : scored.resultType;
    const highest = await tx
      .select({ value: max(participants.queuePosition) })
      .from(participants)
      .where(eq(participants.sessionId, sessionId));
    let position = Number(highest[0]?.value ?? 0) + 1;
    for (const person of assigned) {
      await tx
        .update(participants)
        .set({
          currentGameId: null,
          currentCourt: null,
          status: "waiting",
          gamesPlayed: sql`${participants.gamesPlayed} + 1`,
          waitingSince: now,
          lastPlayedAt: now,
          queuePosition: position++,
        })
        .where(eq(participants.id, person.id));
    }
    await tx
      .update(games)
      .set({
        status: "finished",
        teamAScore: scored.teamAScore,
        teamBScore: scored.teamBScore,
        winningTeam: scored.winningTeam,
        resultType,
        resultStatus: "confirmed",
        resultConfirmedByOpenId: ownerOpenId,
        durationSeconds,
        finishedAt: now,
      })
      .where(eq(games.id, gameId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "score_confirmed",
      details: JSON.stringify({
        gameId,
        teamAScore: scored.teamAScore,
        teamBScore: scored.teamBScore,
        winningTeam: scored.winningTeam,
        resultType,
        at: now.toISOString(),
      }),
    });
    const targets = [
      ...new Set([
        session.ownerOpenId,
        ...assigned.flatMap(person =>
          person.playerOpenId ? [person.playerOpenId] : []
        ),
      ]),
    ];
    if (targets.length)
      await tx.insert(appNotifications).values(
        targets.map(recipientOpenId => ({
          recipientOpenId,
          sessionId,
          gameId,
          kind: "match_result",
          title: `Court ${game.courtNumber} result confirmed`,
          body: `Final score: ${scored.teamAScore}–${scored.teamBScore}${scored.winningTeam ? ` · Team ${scored.winningTeam} wins` : " · Tie at time"}.`,
        }))
      );
    scheduleNext = !timeExpired;
  });
  const latest = await syncSessionLifecycle(sessionId);
  if (scheduleNext && latest.session.status === "live")
    return generateQueue(ownerOpenId, sessionId, latest.session.strategy);
  return getDashboard(ownerOpenId, sessionId);
}

export async function correctGameResult(
  ownerOpenId: string,
  sessionId: number,
  gameId: number,
  input: { teamAScore: number; teamBScore: number; reason: string }
) {
  const db = await database();
  const session = await sessionById(ownerOpenId, sessionId);
  if (session.status === "cancelled" || session.status === "finished")
    throw new TRPCError({
      code: "CONFLICT",
      message: "Results cannot be changed after this session is closed.",
    });
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 3)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a reason for changing this result.",
    });
  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.sessionId, sessionId)))
    .limit(1);
  if (
    !game ||
    game.status !== "finished" ||
    game.teamAScore === null ||
    game.teamBScore === null
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "Only a confirmed match can be corrected.",
    });
  const mode = game.resultType === "normal" ? "normal" : "time_expired";
  let scored: ReturnType<typeof scoreMatch>;
  try {
    scored = scoreMatch(input.teamAScore, input.teamBScore, mode);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Enter a valid score.",
    });
  }
  await db.transaction(async tx => {
    const [lockedSession] = await tx
      .select()
      .from(openSessions)
      .where(
        and(
          eq(openSessions.id, sessionId),
          eq(openSessions.ownerOpenId, ownerOpenId)
        )
      )
      .limit(1)
      .for("update");
    if (!lockedSession)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    if (
      lockedSession.status === "cancelled" ||
      lockedSession.status === "finished"
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Results cannot be changed after this session is closed.",
      });
    const [current] = await tx
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.sessionId, sessionId)))
      .limit(1)
      .for("update");
    if (
      !current ||
      current.status !== "finished" ||
      current.teamAScore === null ||
      current.teamBScore === null
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This match changed before the correction could be saved.",
      });
    await tx.insert(gameResultAudits).values({
      gameId,
      sessionId,
      actorOpenId: ownerOpenId,
      oldTeamAScore: current.teamAScore,
      oldTeamBScore: current.teamBScore,
      newTeamAScore: scored.teamAScore,
      newTeamBScore: scored.teamBScore,
      reason,
    });
    const resultType = scored.winningTeam === null ? "tie" : scored.resultType;
    await tx
      .update(games)
      .set({
        teamAScore: scored.teamAScore,
        teamBScore: scored.teamBScore,
        winningTeam: scored.winningTeam,
        resultType,
        resultStatus: "corrected",
        resultConfirmedByOpenId: ownerOpenId,
      })
      .where(eq(games.id, gameId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "score_corrected",
      details: JSON.stringify({
        gameId,
        oldTeamAScore: current.teamAScore,
        oldTeamBScore: current.teamBScore,
        newTeamAScore: scored.teamAScore,
        newTeamBScore: scored.teamBScore,
        reason,
      }),
    });
    const links = await tx
      .select({ playerOpenId: participants.playerOpenId })
      .from(gamePlayers)
      .innerJoin(participants, eq(participants.id, gamePlayers.participantId))
      .where(eq(gamePlayers.gameId, gameId));
    const targets = [
      ...new Set([
        session.ownerOpenId,
        ...links.flatMap(link =>
          link.playerOpenId ? [link.playerOpenId] : []
        ),
      ]),
    ];
    if (targets.length)
      await tx.insert(appNotifications).values(
        targets.map(recipientOpenId => ({
          recipientOpenId,
          sessionId,
          gameId,
          kind: "result_corrected",
          title: "Match result corrected",
          body: `A saved result was corrected to ${scored.teamAScore}–${scored.teamBScore}. Reason: ${reason}`,
        }))
      );
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function returnGame(
  ownerOpenId: string,
  sessionId: number,
  gameId: number
) {
  const db = await database();
  assertSessionEditable(await sessionById(ownerOpenId, sessionId));
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(eq(openSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
    assertSessionEditable(session);
    const [game] = await tx
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.sessionId, sessionId)))
      .limit(1);
    if (!game || game.status !== "ready")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Only an unstarted court group can be returned to the queue.",
      });
    const assigned = await tx
      .select({ id: participants.id })
      .from(participants)
      .innerJoin(gamePlayers, eq(gamePlayers.participantId, participants.id))
      .where(eq(gamePlayers.gameId, gameId));
    const highest = await tx
      .select({ value: max(participants.queuePosition) })
      .from(participants)
      .where(eq(participants.sessionId, sessionId));
    const now = new Date();
    let position = Number(highest[0]?.value ?? 0) + 1;
    for (const person of assigned)
      await tx
        .update(participants)
        .set({
          currentGameId: null,
          currentCourt: null,
          status: "waiting",
          waitingSince: now,
          queuePosition: position++,
        })
        .where(eq(participants.id, person.id));
    await tx
      .update(games)
      .set({ status: "returned", finishedAt: now })
      .where(eq(games.id, gameId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "ready_court_returned",
      details: JSON.stringify({ gameId, at: now.toISOString() }),
    });
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function cancelGame(
  ownerOpenId: string,
  sessionId: number,
  gameId: number,
  reason: string
) {
  const db = await database();
  const initial = await sessionById(ownerOpenId, sessionId);
  if (initial.status !== "live" && initial.status !== "ending")
    throw new TRPCError({
      code: "CONFLICT",
      message: "This session is not accepting match cancellations.",
    });
  const cleanReason = reason.trim().slice(0, 500);
  if (cleanReason.length < 3)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a reason for cancelling this match.",
    });
  let continueQueue = false;
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(eq(openSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session || (session.status !== "live" && session.status !== "ending"))
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session is not accepting match cancellations.",
      });
    const [game] = await tx
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.sessionId, sessionId)))
      .limit(1);
    if (!game || game.status !== "playing")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Only a match currently in play can be cancelled.",
      });
    const assigned = await tx
      .select({
        id: participants.id,
        name: participants.name,
        playerOpenId: participants.playerOpenId,
      })
      .from(participants)
      .innerJoin(gamePlayers, eq(gamePlayers.participantId, participants.id))
      .where(eq(gamePlayers.gameId, gameId));
    const highest = await tx
      .select({ value: max(participants.queuePosition) })
      .from(participants)
      .where(eq(participants.sessionId, sessionId));
    const now = new Date();
    let position = Number(highest[0]?.value ?? 0) + 1;
    for (const person of assigned)
      await tx
        .update(participants)
        .set({
          currentGameId: null,
          currentCourt: null,
          status: "waiting",
          waitingSince: now,
          queuePosition: position++,
        })
        .where(eq(participants.id, person.id));
    await tx
      .update(games)
      .set({ status: "cancelled", resultStatus: "cancelled", finishedAt: now })
      .where(eq(games.id, gameId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "match_cancelled",
      details: JSON.stringify({
        gameId,
        reason: cleanReason,
        at: now.toISOString(),
      }),
    });
    const targets = [
      ...new Set([
        session.ownerOpenId,
        ...assigned.flatMap(person =>
          person.playerOpenId ? [person.playerOpenId] : []
        ),
      ]),
    ];
    if (targets.length)
      await tx.insert(appNotifications).values(
        targets.map(recipientOpenId => ({
          recipientOpenId,
          sessionId,
          gameId,
          kind: "match_cancelled",
          title: `Court ${game.courtNumber} match cancelled`,
          body: `The match was cancelled without a score. Reason: ${cleanReason}`,
        }))
      );
    continueQueue =
      session.status === "live" &&
      (!session.endsAt || session.endsAt.getTime() > now.getTime());
  });
  const latest = await syncSessionLifecycle(sessionId);
  if (continueQueue && latest.session.status === "live")
    return generateQueue(ownerOpenId, sessionId, latest.session.strategy);
  return getDashboard(ownerOpenId, sessionId);
}

export async function resetQueue(ownerOpenId: string, sessionId: number) {
  const db = await database();
  await db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(
        and(
          eq(openSessions.id, sessionId),
          eq(openSessions.ownerOpenId, ownerOpenId)
        )
      )
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    assertSessionEditable(session);
    const readyGames = await tx
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.sessionId, sessionId), eq(games.status, "ready")));
    const ids = readyGames.map(game => game.id);
    if (ids.length) {
      await tx
        .update(participants)
        .set({
          currentGameId: null,
          currentCourt: null,
          status: "waiting",
          waitingSince: new Date(),
        })
        .where(inArray(participants.currentGameId, ids));
      await tx
        .update(games)
        .set({ status: "returned", finishedAt: new Date() })
        .where(inArray(games.id, ids));
    }
    const people = await tx
      .select({
        id: participants.id,
        checkedIn: participants.checkedIn,
        checkInOrder: participants.checkInOrder,
      })
      .from(participants)
      .where(eq(participants.sessionId, sessionId))
      .orderBy(
        desc(participants.checkedIn),
        asc(participants.checkInOrder),
        asc(participants.id)
      );
    for (let index = 0; index < people.length; index += 1)
      await tx
        .update(participants)
        .set({ queuePosition: index + 1 })
        .where(eq(participants.id, people[index].id));
  });
  return getDashboard(ownerOpenId, sessionId);
}

export async function getPublicSession(
  token: string
): Promise<PublicSessionData> {
  const db = await database();
  const [session] = await db
    .select()
    .from(openSessions)
    .where(eq(openSessions.shareToken, token))
    .limit(1);
  if (!session)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This shared session link is unavailable.",
    });
  const { session: currentSession, serverNow } = await syncSessionLifecycle(
    session.id
  );
  const [people, activeGames] = await Promise.all([
    db
      .select()
      .from(participants)
      .where(eq(participants.sessionId, currentSession.id))
      .orderBy(asc(participants.queuePosition), asc(participants.id)),
    db
      .select()
      .from(games)
      .where(
        and(
          eq(games.sessionId, currentSession.id),
          inArray(games.status, ["ready", "playing"])
        )
      )
      .orderBy(asc(games.courtNumber)),
  ]);
  const activeIds = activeGames.map(game => game.id);
  const links = activeIds.length
    ? await db
        .select({
          gameId: gamePlayers.gameId,
          participantId: gamePlayers.participantId,
          team: gamePlayers.team,
          playerNameSnapshot: gamePlayers.playerNameSnapshot,
        })
        .from(gamePlayers)
        .where(inArray(gamePlayers.gameId, activeIds))
    : [];
  const peopleById = new Map(people.map(person => [person.id, person]));
  const courts = activeGames.map(game => ({
    gameId: game.id,
    courtNumber: game.courtNumber,
    status: game.status as "ready" | "playing",
    teamAScore: game.teamAScore,
    teamBScore: game.teamBScore,
    winningTeam: game.winningTeam,
    resultStatus: game.resultStatus,
    players: links
      .filter(link => link.gameId === game.id)
      .flatMap(link => {
        const person = peopleById.get(link.participantId);
        return person
          ? [{ name: link.playerNameSnapshot || person.name, team: link.team }]
          : [];
      }),
  }));
  const waiting = people
    .filter(person => person.checkedIn && person.currentGameId === null)
    .map((person, index) => ({ name: person.name, position: index + 1 }));
  return {
    session: {
      name: currentSession.name,
      sessionDate: currentSession.sessionDate,
      venue: currentSession.venue,
      courtCount: currentSession.courtCount,
      playersPerGame: currentSession.playersPerGame,
      status: currentSession.status,
      scheduledStartAt: currentSession.scheduledStartAt,
      startedAt: currentSession.startedAt,
      endsAt: currentSession.endsAt,
      durationMinutes: currentSession.durationMinutes,
      activeMatchCount: activeGames.filter(game => game.status === "playing")
        .length,
      serverNow,
    },
    courts,
    waiting,
    checkedInCount: people.filter(person => person.checkedIn).length,
  };
}
