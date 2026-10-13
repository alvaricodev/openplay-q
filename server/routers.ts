import { COOKIE_NAME } from "@shared/const";
import { DEFAULT_TIER_CONFIG } from "@shared/openPlay";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import * as openPlay from "./openPlay";
import * as lifecycle from "./sessionLifecycle";
import * as player from "./player";

const sessionId = z.number().int().positive();
const gameId = z.number().int().positive();
const inviteToken = z.string().min(32).max(64);
const scoreInput = z.object({
  teamAScore: z.number().int().min(0).max(99),
  teamBScore: z.number().int().min(0).max(99),
});
const playerRatingInput = z.object({
  sessionId,
  participantId: z.number().int().positive(),
  duprRating: z.string().max(32).optional(),
  selfRating: z.string().max(64).optional(),
  manualRating: z.string().max(64).optional(),
});

const tierConfig = z
  .object({
    duprThresholds: z.array(z.number().finite()).length(4),
    selfNumericThresholds: z.array(z.number().finite()).length(4),
    selfLabels: z.record(z.string(), z.number().int().min(0).max(4)),
  })
  .default(DEFAULT_TIER_CONFIG);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  session: router({
    current: protectedProcedure.query(({ ctx }) =>
      openPlay.getCurrentDashboard(ctx.user.openId)
    ),
    byId: protectedProcedure
      .input(z.object({ sessionId }))
      .query(({ ctx, input }) =>
        openPlay.getDashboard(ctx.user.openId, input.sessionId)
      ),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(160),
          sessionDate: z.string().min(1).max(80),
          scheduledStartAt: z.string().min(1).max(80),
          durationMinutes: z
            .number()
            .int()
            .min(15)
            .max(24 * 60),
          courtCount: z.number().int().min(1).max(12).default(2),
          playersPerGame: z.number().int().min(2).max(8).default(4),
          strategy: z.enum(["fair", "skill"]).default("fair"),
          groupMode: z.enum(["similar", "balanced"]).default("similar"),
          venue: z.string().max(180).default(""),
          notes: z.string().max(2000).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        openPlay.createSession(ctx.user.openId, input)
      ),
    start: protectedProcedure
      .input(z.object({ sessionId }))
      .mutation(({ ctx, input }) =>
        lifecycle.startSession(ctx.user.openId, input.sessionId)
      ),
    updateSchedule: protectedProcedure
      .input(
        z.object({
          sessionId,
          scheduledStartAt: z.string().min(1).max(80),
          durationMinutes: z
            .number()
            .int()
            .min(15)
            .max(24 * 60),
          notes: z.string().max(2000),
        })
      )
      .mutation(({ ctx, input }) =>
        lifecycle.updateSessionSchedule(ctx.user.openId, input.sessionId, {
          ...input,
          scheduledStartAt: new Date(input.scheduledStartAt),
        })
      ),
    adjustEnd: protectedProcedure
      .input(z.object({ sessionId, endsAt: z.string().min(1).max(80) }))
      .mutation(({ ctx, input }) =>
        lifecycle.adjustSessionEnd(
          ctx.user.openId,
          input.sessionId,
          new Date(input.endsAt)
        )
      ),
    extend: protectedProcedure
      .input(
        z.object({
          sessionId,
          extraMinutes: z
            .number()
            .int()
            .min(1)
            .max(24 * 60),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await lifecycle.extendSession(
          ctx.user.openId,
          input.sessionId,
          input.extraMinutes
        );
        if (result.session.status === "live")
          return openPlay.generateQueue(
            ctx.user.openId,
            input.sessionId,
            result.session.strategy
          );
        return openPlay.getDashboard(ctx.user.openId, input.sessionId);
      }),
    finish: protectedProcedure
      .input(z.object({ sessionId }))
      .mutation(({ ctx, input }) =>
        lifecycle.finishSession(ctx.user.openId, input.sessionId)
      ),
    finalize: protectedProcedure
      .input(z.object({ sessionId }))
      .mutation(({ ctx, input }) =>
        lifecycle.finalizeSession(ctx.user.openId, input.sessionId)
      ),
    cancel: protectedProcedure
      .input(z.object({ sessionId, reason: z.string().trim().min(3).max(500) }))
      .mutation(({ ctx, input }) =>
        lifecycle.cancelSession(ctx.user.openId, input.sessionId, input.reason)
      ),
    audit: protectedProcedure
      .input(z.object({ sessionId }))
      .query(({ ctx, input }) =>
        lifecycle.getSessionAudit(ctx.user.openId, input.sessionId)
      ),
    resultAudit: protectedProcedure
      .input(z.object({ sessionId, gameId }))
      .query(({ ctx, input }) =>
        lifecycle.getGameResultAudit(
          ctx.user.openId,
          input.sessionId,
          input.gameId
        )
      ),
    updateSettings: protectedProcedure
      .input(
        z.object({
          sessionId,
          courtCount: z.number().int().min(1).max(12),
          playersPerGame: z.number().int().min(2).max(8),
          strategy: z.enum(["fair", "skill"]),
          groupMode: z.enum(["similar", "balanced"]),
          tierConfig,
        })
      )
      .mutation(({ ctx, input }) =>
        openPlay.updateSessionSettings(ctx.user.openId, input.sessionId, input)
      ),
    publicView: publicProcedure
      .input(z.object({ token: inviteToken }))
      .query(({ input }) => openPlay.getPublicSession(input.token)),
  }),
  playerAccount: router({
    hub: protectedProcedure.query(({ ctx }) =>
      player.getPlayerHub(ctx.user.openId, ctx.user.name ?? "")
    ),
    updateProfile: protectedProcedure
      .input(z.object({ displayName: z.string().trim().min(1).max(160) }))
      .mutation(({ ctx, input }) =>
        player.updatePlayerProfile(ctx.user.openId, input.displayName)
      ),
    join: protectedProcedure
      .input(
        z.object({
          token: inviteToken,
          displayName: z.string().trim().min(1).max(160).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        player.joinSession(
          ctx.user.openId,
          ctx.user.name ?? "",
          input.token,
          input.displayName
        )
      ),
    myStatus: protectedProcedure
      .input(z.object({ token: inviteToken }))
      .query(({ ctx, input }) =>
        player.playerSessionStatus(ctx.user.openId, input.token)
      ),
    checkIn: protectedProcedure
      .input(z.object({ token: inviteToken, checkedIn: z.boolean() }))
      .mutation(({ ctx, input }) =>
        player.updateOwnCheckIn(ctx.user.openId, input.token, input.checkedIn)
      ),
    sessionRankings: protectedProcedure
      .input(z.object({ token: inviteToken }))
      .query(({ ctx, input }) =>
        player.sessionRankings(ctx.user.openId, input.token)
      ),
    notifications: protectedProcedure.query(({ ctx }) =>
      player.listNotifications(ctx.user.openId)
    ),
    markRead: protectedProcedure
      .input(z.object({ notificationId: z.number().int().positive() }))
      .mutation(({ ctx, input }) =>
        player.markNotificationRead(ctx.user.openId, input.notificationId)
      ),
  }),
  players: router({
    add: protectedProcedure
      .input(
        z.object({
          sessionId,
          name: z.string().trim().min(1).max(160),
          duprRating: z.string().max(32).optional(),
          selfRating: z.string().max(64).optional(),
          manualRating: z.string().max(64).optional(),
        })
      )
      .mutation(({ ctx, input }) => openPlay.addPlayer(ctx.user.openId, input)),
    import: protectedProcedure
      .input(
        z.object({
          sessionId,
          players: z
            .array(
              z.object({
                name: z.string().max(200),
                duprRating: z.string().max(32).optional(),
                selfRating: z.string().max(64).optional(),
                manualRating: z.string().max(64).optional(),
                registrationStatus: z.string().max(40).optional(),
                checkedIn: z.boolean().optional(),
              })
            )
            .max(300),
        })
      )
      .mutation(({ ctx, input }) =>
        openPlay.importPlayers(ctx.user.openId, input)
      ),
    checkIn: protectedProcedure
      .input(
        z.object({
          sessionId,
          participantId: z.number().int().positive(),
          checkedIn: z.boolean(),
        })
      )
      .mutation(({ ctx, input }) =>
        openPlay.updateCheckIn(
          ctx.user.openId,
          input.sessionId,
          input.participantId,
          input.checkedIn
        )
      ),
    updateRating: protectedProcedure
      .input(playerRatingInput)
      .mutation(({ ctx, input }) =>
        openPlay.updatePlayerRating(ctx.user.openId, input)
      ),
  }),
  queue: router({
    generate: protectedProcedure
      .input(z.object({ sessionId, strategy: z.enum(["fair", "skill"]) }))
      .mutation(({ ctx, input }) =>
        openPlay.generateQueue(ctx.user.openId, input.sessionId, input.strategy)
      ),
    move: protectedProcedure
      .input(
        z.object({
          sessionId,
          participantId: z.number().int().positive(),
          direction: z.union([z.literal(-1), z.literal(1)]),
        })
      )
      .mutation(({ ctx, input }) =>
        openPlay.movePlayer(
          ctx.user.openId,
          input.sessionId,
          input.participantId,
          input.direction
        )
      ),
    reset: protectedProcedure
      .input(z.object({ sessionId }))
      .mutation(({ ctx, input }) =>
        openPlay.resetQueue(ctx.user.openId, input.sessionId)
      ),
  }),
  games: router({
    start: protectedProcedure
      .input(z.object({ sessionId, gameId }))
      .mutation(({ ctx, input }) =>
        openPlay.startGame(ctx.user.openId, input.sessionId, input.gameId)
      ),
    finish: protectedProcedure
      .input(z.object({ sessionId, gameId, ...scoreInput.shape }))
      .mutation(({ ctx, input }) =>
        openPlay.finishGame(ctx.user.openId, input.sessionId, input.gameId, {
          teamAScore: input.teamAScore,
          teamBScore: input.teamBScore,
        })
      ),
    correct: protectedProcedure
      .input(
        z.object({
          sessionId,
          gameId,
          ...scoreInput.shape,
          reason: z.string().trim().min(3).max(500),
        })
      )
      .mutation(({ ctx, input }) =>
        openPlay.correctGameResult(
          ctx.user.openId,
          input.sessionId,
          input.gameId,
          {
            teamAScore: input.teamAScore,
            teamBScore: input.teamBScore,
            reason: input.reason,
          }
        )
      ),
    cancel: protectedProcedure
      .input(
        z.object({
          sessionId,
          gameId,
          reason: z.string().trim().min(3).max(500),
        })
      )
      .mutation(({ ctx, input }) =>
        openPlay.cancelGame(
          ctx.user.openId,
          input.sessionId,
          input.gameId,
          input.reason
        )
      ),
    returnToQueue: protectedProcedure
      .input(z.object({ sessionId, gameId }))
      .mutation(({ ctx, input }) =>
        openPlay.returnGame(ctx.user.openId, input.sessionId, input.gameId)
      ),
  }),
});

export type AppRouter = typeof appRouter;
