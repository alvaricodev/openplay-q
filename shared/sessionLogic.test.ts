import { describe, expect, it } from "vitest";
import {
  calculateRankings,
  hasTimerExpired,
  isWarningWindow,
  remainingMs,
  scoreMatch,
  type RankingMatch,
} from "./sessionLogic";

describe("server-backed session time", () => {
  const now = new Date("2026-10-12T10:00:00.000Z");
  it("uses persisted end time and server time", () => {
    expect(remainingMs("2026-10-12T14:00:00.000Z", now)).toBe(4 * 60 * 60_000);
  });
  it("only treats the real saved deadline/expiry as time-expired, not an early manual session finish", () => {
    expect(hasTimerExpired(null, new Date(now.getTime() + 60_000), now)).toBe(
      false
    );
    expect(hasTimerExpired(null, now, now)).toBe(true);
    expect(
      hasTimerExpired(
        new Date(now.getTime() - 60_000),
        new Date(now.getTime() + 60_000),
        now
      )
    ).toBe(true);
  });
  it("warns inside the final 15 minutes but not before or after zero", () => {
    expect(isWarningWindow(new Date(now.getTime() + 15 * 60_000), now)).toBe(
      true
    );
    expect(
      isWarningWindow(new Date(now.getTime() + 15 * 60_000 + 1), now)
    ).toBe(false);
    expect(isWarningWindow(now, now)).toBe(false);
    expect(isWarningWindow(new Date(now.getTime() - 1), now)).toBe(false);
  });
});

describe("match score rules", () => {
  it("accepts a normal first-to-11, win-by-2 score", () => {
    expect(scoreMatch(11, 9, "normal")).toMatchObject({
      winningTeam: "A",
      resultType: "normal",
    });
    expect(scoreMatch(13, 11, "normal").winningTeam).toBe("A");
  });
  it("rejects a normal score below the target, tied, or not won by two", () => {
    expect(() => scoreMatch(8, 6, "normal")).toThrow();
    expect(() => scoreMatch(11, 10, "normal")).toThrow();
    expect(() => scoreMatch(11, 11, "normal")).toThrow();
  });
  it("confirms a shortened 8–6 result and permits an explicit tie without inventing a winner", () => {
    expect(scoreMatch(8, 6, "time_expired")).toMatchObject({
      winningTeam: "A",
      resultType: "time_expired",
    });
    expect(scoreMatch(7, 7, "time_expired").winningTeam).toBeNull();
  });
  it("rejects negative, fractional, or excessive scores", () => {
    expect(() => scoreMatch(-1, 0, "time_expired")).toThrow();
    expect(() => scoreMatch(2.5, 0, "time_expired")).toThrow();
    expect(() => scoreMatch(100, 0, "time_expired")).toThrow();
  });
});

describe("confirmed-result rankings", () => {
  const match: RankingMatch = {
    teamAScore: 11,
    teamBScore: 9,
    winningTeam: "A",
    resultStatus: "confirmed",
    players: [
      { participantId: 1, playerOpenId: "acct-a", name: "A Player", team: "A" },
      { participantId: 2, playerOpenId: "acct-b", name: "B Player", team: "A" },
      { participantId: 3, playerOpenId: null, name: "Walk-in C", team: "B" },
      { participantId: 4, playerOpenId: null, name: "Walk-in D", team: "B" },
    ],
  };
  it("derives wins, losses, points, and account rankings only from confirmed results", () => {
    const rankings = calculateRankings([
      match,
      { ...match, resultStatus: "unresolved", teamAScore: 50, teamBScore: 0 },
      { ...match, resultStatus: "cancelled" },
    ]);
    expect(rankings.find(row => row.identity === "acct-a")).toMatchObject({
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      pointsScored: 11,
      pointsConceded: 9,
    });
    expect(rankings.find(row => row.identity === "walkin:3")).toMatchObject({
      gamesPlayed: 1,
      losses: 1,
      wins: 0,
    });
    expect(calculateRankings([match], true)).toHaveLength(2);
  });
  it("counts explicit tie results as ties, not fabricated wins or losses", () => {
    const tied: RankingMatch = {
      ...match,
      teamAScore: 6,
      teamBScore: 6,
      winningTeam: null,
    };
    expect(
      calculateRankings([tied]).every(
        row => row.ties === 1 && row.wins === 0 && row.losses === 0
      )
    ).toBe(true);
  });
});
