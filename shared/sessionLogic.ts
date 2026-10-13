export type ScoreResult = {
  teamAScore: number;
  teamBScore: number;
  winningTeam: "A" | "B" | null;
  resultType: "normal" | "time_expired";
};

export type RankingMatch = {
  teamAScore: number | null;
  teamBScore: number | null;
  winningTeam: "A" | "B" | null;
  resultStatus: string;
  players: Array<{
    participantId: number;
    playerOpenId: string | null;
    name: string;
    team: "A" | "B";
  }>;
};

export type RankingRow = {
  identity: string;
  playerOpenId: string | null;
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  winPercentage: number;
  pointsScored: number;
  pointsConceded: number;
  pointDifferential: number;
  rank: number;
};

export function remainingMs(
  endsAt: Date | string | null,
  serverNow: Date | string
): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  const now = new Date(serverNow).getTime();
  return Number.isFinite(end) && Number.isFinite(now) ? end - now : null;
}

export function hasTimerExpired(
  expiredAt: Date | string | null,
  endsAt: Date | string | null,
  serverNow: Date | string
): boolean {
  if (expiredAt) return true;
  const remaining = remainingMs(endsAt, serverNow);
  return remaining !== null && remaining <= 0;
}

export function isWarningWindow(
  endsAt: Date | string | null,
  serverNow: Date | string
): boolean {
  const remaining = remainingMs(endsAt, serverNow);
  return remaining !== null && remaining > 0 && remaining <= 15 * 60_000;
}

export function scoreMatch(
  teamAScore: number,
  teamBScore: number,
  mode: "normal" | "time_expired"
): ScoreResult {
  for (const score of [teamAScore, teamBScore]) {
    if (!Number.isInteger(score) || score < 0 || score > 99)
      throw new Error("Scores must be whole numbers from 0 to 99.");
  }
  if (mode === "normal") {
    const high = Math.max(teamAScore, teamBScore);
    const low = Math.min(teamAScore, teamBScore);
    if (teamAScore === teamBScore || high < 11 || high - low < 2)
      throw new Error(
        "A normal match requires a winner at 11 points or more, winning by 2."
      );
  }
  return {
    teamAScore,
    teamBScore,
    winningTeam:
      teamAScore === teamBScore ? null : teamAScore > teamBScore ? "A" : "B",
    resultType: mode,
  };
}

export function calculateRankings(
  matches: RankingMatch[],
  allTime = false
): RankingRow[] {
  const rows = new Map<
    string,
    Omit<RankingRow, "rank" | "winPercentage" | "pointDifferential">
  >();
  for (const match of matches) {
    if (
      !(
        match.resultStatus === "confirmed" || match.resultStatus === "corrected"
      ) ||
      match.teamAScore === null ||
      match.teamBScore === null
    )
      continue;
    for (const player of match.players) {
      if (allTime && !player.playerOpenId) continue;
      const identity = player.playerOpenId ?? `walkin:${player.participantId}`;
      const current = rows.get(identity) ?? {
        identity,
        playerOpenId: player.playerOpenId,
        name: player.name,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsScored: 0,
        pointsConceded: 0,
      };
      const own = player.team === "A" ? match.teamAScore : match.teamBScore;
      const other = player.team === "A" ? match.teamBScore : match.teamAScore;
      current.gamesPlayed += 1;
      current.pointsScored += own;
      current.pointsConceded += other;
      if (match.winningTeam === null) current.ties += 1;
      else if (match.winningTeam === player.team) current.wins += 1;
      else current.losses += 1;
      rows.set(identity, current);
    }
  }
  const sorted = [...rows.values()]
    .map(row => ({
      ...row,
      winPercentage: row.gamesPlayed ? (row.wins / row.gamesPlayed) * 100 : 0,
      pointDifferential: row.pointsScored - row.pointsConceded,
    }))
    .sort(
      (a, b) =>
        b.winPercentage - a.winPercentage ||
        b.wins - a.wins ||
        b.pointDifferential - a.pointDifferential ||
        b.pointsScored - a.pointsScored ||
        a.name.localeCompare(b.name)
    );
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}
