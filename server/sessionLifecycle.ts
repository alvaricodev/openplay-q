import { and, count, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  appNotifications,
  gameResultAudits,
  games,
  openSessions,
  participants,
  playerProfiles,
  sessionAudit,
  users,
  type OpenSession,
} from "../drizzle/schema";
import { getDb } from "./db";

const WARNING_MS = 15 * 60_000;

async function database() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The session database is unavailable.",
    });
  return db;
}

async function ownedSession(ownerOpenId: string, sessionId: number) {
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

async function recipients(
  db: Awaited<ReturnType<typeof database>>,
  session: OpenSession
) {
  const linked = await db
    .select({ openId: participants.playerOpenId })
    .from(participants)
    .where(eq(participants.sessionId, session.id));
  return [
    ...new Set([
      session.ownerOpenId,
      ...linked.flatMap(row => (row.openId ? [row.openId] : [])),
    ]),
  ];
}

async function sendNotifications(
  db: Awaited<ReturnType<typeof database>>,
  session: OpenSession,
  kind: string,
  title: string,
  body: string,
  gameId?: number | null
) {
  const targets = await recipients(db, session);
  if (!targets.length) return;
  await db.insert(appNotifications).values(
    targets.map(recipientOpenId => ({
      recipientOpenId,
      sessionId: session.id,
      gameId: gameId ?? null,
      kind,
      title,
      body,
    }))
  );
}

async function audit(
  db: Awaited<ReturnType<typeof database>>,
  sessionId: number,
  actorOpenId: string | null,
  kind: string,
  details: unknown
) {
  await db
    .insert(sessionAudit)
    .values({ sessionId, actorOpenId, kind, details: JSON.stringify(details) });
}

/**
 * Synchronize the session against persisted server time. This is idempotent: only the first
 * request crossing the warning or expiry boundary creates its corresponding event.
 */
export async function syncSessionLifecycle(sessionId: number) {
  const db = await database();
  return db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(openSessions)
      .where(eq(openSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session)
      throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
    const now = new Date();
    if (session.status === "live" && session.endsAt) {
      const remaining = session.endsAt.getTime() - now.getTime();
      if (remaining <= 0) {
        const ready = await tx
          .select({ id: games.id })
          .from(games)
          .where(
            and(eq(games.sessionId, sessionId), eq(games.status, "ready"))
          );
        const readyIds = ready.map(game => game.id);
        if (readyIds.length) {
          await tx
            .update(participants)
            .set({
              currentGameId: null,
              currentCourt: null,
              status: "waiting",
              waitingSince: now,
            })
            .where(inArray(participants.currentGameId, readyIds));
          await tx
            .update(games)
            .set({ status: "returned", resultStatus: "cancelled" })
            .where(inArray(games.id, readyIds));
        }
        await tx
          .update(openSessions)
          .set({ status: "ending", expiredAt: session.expiredAt ?? now })
          .where(eq(openSessions.id, sessionId));
        await tx.insert(sessionAudit).values({
          sessionId,
          actorOpenId: null,
          kind: "session_expired",
          details: JSON.stringify({
            endsAt: session.endsAt.toISOString(),
            expiredAt: now.toISOString(),
          }),
        });
        const linked = await tx
          .select({ openId: participants.playerOpenId })
          .from(participants)
          .where(eq(participants.sessionId, sessionId));
        const targets = [
          ...new Set([
            session.ownerOpenId,
            ...linked.flatMap(row => (row.openId ? [row.openId] : [])),
          ]),
        ];
        if (targets.length)
          await tx.insert(appNotifications).values(
            targets.map(recipientOpenId => ({
              recipientOpenId,
              sessionId,
              gameId: null,
              kind: "session_expired",
              title: "Session time is up",
              body: "No new matches will start. Active matches remain available for settlement.",
            }))
          );
      } else if (remaining <= WARNING_MS && !session.warningSentAt) {
        await tx
          .update(openSessions)
          .set({ warningSentAt: now })
          .where(eq(openSessions.id, sessionId));
        const linked = await tx
          .select({ openId: participants.playerOpenId })
          .from(participants)
          .where(eq(participants.sessionId, sessionId));
        const targets = [
          ...new Set([
            session.ownerOpenId,
            ...linked.flatMap(row => (row.openId ? [row.openId] : [])),
          ]),
        ];
        if (targets.length)
          await tx.insert(appNotifications).values(
            targets.map(recipientOpenId => ({
              recipientOpenId,
              sessionId,
              gameId: null,
              kind: "session_warning",
              title: "15 minutes remaining",
              body: `${session.name} is approaching its scheduled end. Play can continue until time reaches zero.`,
            }))
          );
      }
    }
    const [fresh] = await tx
      .select()
      .from(openSessions)
      .where(eq(openSessions.id, sessionId))
      .limit(1);
    if (!fresh)
      throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
    return { session: fresh, serverNow: now };
  });
}

export async function startSession(ownerOpenId: string, sessionId: number) {
  const db = await database();
  const started = await db.transaction(async tx => {
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
    if (
      session.status !== "scheduled" &&
      !(session.status === "live" && !session.endsAt)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session cannot be started in its current state.",
      });
    const now = new Date();
    const endsAt = new Date(now.getTime() + session.durationMinutes * 60_000);
    await tx
      .update(openSessions)
      .set({
        status: "live",
        startedAt: session.startedAt ?? now,
        endsAt,
        expiredAt: null,
        warningSentAt: null,
      })
      .where(eq(openSessions.id, sessionId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "session_started",
      details: JSON.stringify({
        startedAt: now.toISOString(),
        endsAt: endsAt.toISOString(),
        durationMinutes: session.durationMinutes,
      }),
    });
    return {
      ...session,
      status: "live" as const,
      startedAt: session.startedAt ?? now,
      endsAt,
      expiredAt: null,
      warningSentAt: null,
    };
  });
  const endsAt = started.endsAt!;
  await sendNotifications(
    db,
    started,
    "session_started",
    "Session started",
    `${started.name} is now live and ends at ${endsAt.toISOString()}.`
  );
  return syncSessionLifecycle(sessionId);
}

export async function updateSessionSchedule(
  ownerOpenId: string,
  sessionId: number,
  input: { scheduledStartAt: Date; durationMinutes: number; notes: string }
) {
  const db = await database();
  if (
    !Number.isFinite(input.scheduledStartAt.getTime()) ||
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 15 ||
    input.durationMinutes > 24 * 60
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose a valid start time and duration between 15 minutes and 24 hours.",
    });
  const updated = await db.transaction(async tx => {
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
    if (session.status !== "scheduled")
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Only a scheduled session can have its planned start and duration edited.",
      });
    const notes = input.notes.trim().slice(0, 2000);
    await tx
      .update(openSessions)
      .set({
        sessionDate: input.scheduledStartAt,
        scheduledStartAt: input.scheduledStartAt,
        durationMinutes: input.durationMinutes,
        sessionNotes: notes,
      })
      .where(eq(openSessions.id, sessionId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "session_schedule_updated",
      details: JSON.stringify({
        scheduledStartAt: input.scheduledStartAt.toISOString(),
        durationMinutes: input.durationMinutes,
      }),
    });
    return {
      ...session,
      sessionDate: input.scheduledStartAt,
      scheduledStartAt: input.scheduledStartAt,
      durationMinutes: input.durationMinutes,
      sessionNotes: notes,
    };
  });
  await sendNotifications(
    db,
    updated,
    "session_schedule_updated",
    "Session schedule updated",
    `${updated.name} is scheduled for ${input.scheduledStartAt.toISOString()}.`
  );
  return syncSessionLifecycle(sessionId);
}

export async function adjustSessionEnd(
  ownerOpenId: string,
  sessionId: number,
  nextEnd: Date
) {
  const db = await database();
  if (!Number.isFinite(nextEnd.getTime()))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Enter a valid end time.",
    });
  await ownedSession(ownerOpenId, sessionId);
  await syncSessionLifecycle(sessionId);
  const updated = await db.transaction(async tx => {
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
    if (session.status !== "live" && session.status !== "ending")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Only a session that is not finally closed can be adjusted.",
      });
    const now = new Date();
    await tx
      .update(openSessions)
      .set({
        endsAt: nextEnd,
        status: "live",
        expiredAt: null,
        warningSentAt:
          nextEnd.getTime() - now.getTime() > WARNING_MS
            ? null
            : session.warningSentAt,
      })
      .where(eq(openSessions.id, sessionId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "session_end_adjusted",
      details: JSON.stringify({
        previousEnd: session.endsAt?.toISOString() ?? null,
        nextEnd: nextEnd.toISOString(),
      }),
    });
    return {
      ...session,
      status: "live" as const,
      endsAt: nextEnd,
      expiredAt: null,
    };
  });
  await sendNotifications(
    db,
    updated,
    "session_time_adjusted",
    "Session time updated",
    `${updated.name} now ends at ${nextEnd.toISOString()}.`
  );
  return syncSessionLifecycle(sessionId);
}

export async function extendSession(
  ownerOpenId: string,
  sessionId: number,
  extraMinutes: number
) {
  const db = await database();
  await ownedSession(ownerOpenId, sessionId);
  if (
    !Number.isInteger(extraMinutes) ||
    extraMinutes < 1 ||
    extraMinutes > 24 * 60
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an extension between 1 minute and 24 hours.",
    });
  await syncSessionLifecycle(sessionId);
  const updated = await db.transaction(async tx => {
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
    if (session.status !== "live" && session.status !== "ending")
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session cannot be extended in its current state.",
      });
    const now = new Date();
    const base =
      session.endsAt && session.endsAt.getTime() > now.getTime()
        ? session.endsAt.getTime()
        : now.getTime();
    const endsAt = new Date(base + extraMinutes * 60_000);
    await tx
      .update(openSessions)
      .set({ status: "live", endsAt, warningSentAt: null, expiredAt: null })
      .where(eq(openSessions.id, sessionId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "session_extended",
      details: JSON.stringify({
        previousEnd: session.endsAt?.toISOString() ?? null,
        nextEnd: endsAt.toISOString(),
        extraMinutes,
      }),
    });
    return {
      ...session,
      status: "live" as const,
      endsAt,
      warningSentAt: null,
      expiredAt: null,
    };
  });
  await sendNotifications(
    db,
    updated,
    "session_extended",
    "Session extended",
    `${updated.name} has been extended. New end time: ${updated.endsAt?.toISOString()}.`
  );
  return syncSessionLifecycle(sessionId);
}

export async function finishSession(ownerOpenId: string, sessionId: number) {
  const db = await database();
  const session = await ownedSession(ownerOpenId, sessionId);
  if (session.status === "finished" || session.status === "cancelled")
    throw new TRPCError({
      code: "CONFLICT",
      message: "This session is already closed.",
    });
  const now = new Date();
  await db.transaction(async tx => {
    const [locked] = await tx
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
    if (!locked)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    if (locked.status === "finished" || locked.status === "cancelled")
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session is already closed.",
      });
    const ready = await tx
      .select({ id: games.id })
      .from(games)
      .where(and(eq(games.sessionId, sessionId), eq(games.status, "ready")));
    const readyIds = ready.map(game => game.id);
    if (readyIds.length) {
      await tx
        .update(participants)
        .set({
          currentGameId: null,
          currentCourt: null,
          status: "waiting",
          waitingSince: now,
        })
        .where(inArray(participants.currentGameId, readyIds));
      await tx
        .update(games)
        .set({ status: "returned", resultStatus: "cancelled" })
        .where(inArray(games.id, readyIds));
    }
    await tx
      .update(openSessions)
      .set({ status: "ending" })
      .where(eq(openSessions.id, sessionId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "session_finish_requested",
      details: JSON.stringify({ at: now.toISOString() }),
    });
  });
  await sendNotifications(
    db,
    session,
    "session_ending",
    "Session is ending",
    "No new matches will be started. Active matches can still be settled."
  );
  return syncSessionLifecycle(sessionId);
}

export async function cancelSession(
  ownerOpenId: string,
  sessionId: number,
  reason: string
) {
  const db = await database();
  const session = await ownedSession(ownerOpenId, sessionId);
  if (session.status === "finished" || session.status === "cancelled")
    throw new TRPCError({
      code: "CONFLICT",
      message: "This session is already closed.",
    });
  const now = new Date();
  await db.transaction(async tx => {
    const [locked] = await tx
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
    if (!locked)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    if (locked.status === "finished" || locked.status === "cancelled")
      throw new TRPCError({
        code: "CONFLICT",
        message: "This session is already closed.",
      });
    const active = await tx
      .select({ id: games.id })
      .from(games)
      .where(
        and(
          eq(games.sessionId, sessionId),
          inArray(games.status, ["ready", "playing"])
        )
      );
    const ids = active.map(game => game.id);
    if (ids.length) {
      await tx
        .update(participants)
        .set({
          currentGameId: null,
          currentCourt: null,
          status: "waiting",
          waitingSince: now,
        })
        .where(inArray(participants.currentGameId, ids));
      await tx
        .update(games)
        .set({
          status: "cancelled",
          resultStatus: "cancelled",
          finishedAt: now,
        })
        .where(inArray(games.id, ids));
    }
    await tx
      .update(openSessions)
      .set({ status: "cancelled", cancelledAt: now })
      .where(eq(openSessions.id, sessionId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "session_cancelled",
      details: JSON.stringify({
        reason: reason.trim().slice(0, 500),
        at: now.toISOString(),
      }),
    });
  });
  await sendNotifications(
    db,
    session,
    "session_cancelled",
    "Session cancelled",
    `${session.name} was cancelled by its organizer.`
  );
  return syncSessionLifecycle(sessionId);
}

export async function finalizeSession(ownerOpenId: string, sessionId: number) {
  const db = await database();
  const session = await db.transaction(async tx => {
    const [locked] = await tx
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
    if (!locked)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Session not found or you do not have access.",
      });
    if (locked.status !== "ending")
      throw new TRPCError({
        code: "CONFLICT",
        message: "Request Finish Session before final closure.",
      });
    const [active] = await tx
      .select({ count: count() })
      .from(games)
      .where(
        and(
          eq(games.sessionId, sessionId),
          inArray(games.status, ["ready", "playing"])
        )
      );
    if (active?.count)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Settle or explicitly cancel every active match before closing this session.",
      });
    const now = new Date();
    await tx
      .update(openSessions)
      .set({ status: "finished", finishedAt: now })
      .where(eq(openSessions.id, sessionId));
    await tx.insert(sessionAudit).values({
      sessionId,
      actorOpenId: ownerOpenId,
      kind: "session_finalized",
      details: JSON.stringify({ at: now.toISOString() }),
    });
    return locked;
  });
  await sendNotifications(
    db,
    session,
    "session_finished",
    "Session finished",
    `${session.name} is now read-only. Match history remains available.`
  );
  return syncSessionLifecycle(sessionId);
}

export async function getSessionAudit(ownerOpenId: string, sessionId: number) {
  const db = await database();
  await ownedSession(ownerOpenId, sessionId);
  const rows = await db
    .select()
    .from(sessionAudit)
    .where(eq(sessionAudit.sessionId, sessionId))
    .orderBy(sessionAudit.createdAt);
  const actorIds = [
    ...new Set(rows.flatMap(row => (row.actorOpenId ? [row.actorOpenId] : []))),
  ];
  const [profiles, people] = actorIds.length
    ? await Promise.all([
        db
          .select({
            openId: playerProfiles.openId,
            displayName: playerProfiles.displayName,
          })
          .from(playerProfiles)
          .where(inArray(playerProfiles.openId, actorIds)),
        db
          .select({ openId: users.openId, name: users.name })
          .from(users)
          .where(inArray(users.openId, actorIds)),
      ])
    : [[], []];
  const profileNames = new Map(
    profiles.map(row => [row.openId, row.displayName])
  );
  const userNames = new Map(people.map(row => [row.openId, row.name]));
  return rows.map(({ actorOpenId, ...row }) => ({
    ...row,
    actorName: actorOpenId
      ? profileNames.get(actorOpenId) ||
        userNames.get(actorOpenId) ||
        "Organizer"
      : "System",
  }));
}

export async function getGameResultAudit(
  ownerOpenId: string,
  sessionId: number,
  gameId: number
) {
  const db = await database();
  await ownedSession(ownerOpenId, sessionId);
  const rows = await db
    .select()
    .from(gameResultAudits)
    .where(
      and(
        eq(gameResultAudits.sessionId, sessionId),
        eq(gameResultAudits.gameId, gameId)
      )
    )
    .orderBy(gameResultAudits.createdAt);
  const actorIds = [...new Set(rows.map(row => row.actorOpenId))];
  const [profiles, people] = actorIds.length
    ? await Promise.all([
        db
          .select({
            openId: playerProfiles.openId,
            displayName: playerProfiles.displayName,
          })
          .from(playerProfiles)
          .where(inArray(playerProfiles.openId, actorIds)),
        db
          .select({ openId: users.openId, name: users.name })
          .from(users)
          .where(inArray(users.openId, actorIds)),
      ])
    : [[], []];
  const profileNames = new Map(
    profiles.map(row => [row.openId, row.displayName])
  );
  const userNames = new Map(people.map(row => [row.openId, row.name]));
  return rows.map(({ actorOpenId, ...row }) => ({
    ...row,
    actorName:
      profileNames.get(actorOpenId) ||
      userNames.get(actorOpenId) ||
      "Organizer",
  }));
}
