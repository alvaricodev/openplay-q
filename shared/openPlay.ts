export const RATING_TIERS = [
  "Developing",
  "Recreational",
  "Intermediate",
  "Advanced",
  "Competitive",
] as const;
export type Strategy = "fair" | "skill";
export type GroupMode = "similar" | "balanced";
export type RatingSource = "DUPR" | "Self-rating" | "Manual" | "Unrated";

export type TierConfig = {
  duprThresholds: number[];
  selfNumericThresholds: number[];
  selfLabels: Record<string, number>;
};

// These are editable club grouping defaults, not official DUPR cutoffs.
export const DEFAULT_TIER_CONFIG: TierConfig = {
  duprThresholds: [2.5, 3.0, 3.5, 4.0],
  selfNumericThresholds: [2, 3, 4, 4.5],
  selfLabels: {
    beginner: 0,
    developing: 0,
    recreational: 1,
    rec: 1,
    intermediate: 2,
    advanced: 3,
    competitive: 4,
  },
};

export type QueuePlayer = {
  id: number;
  name: string;
  duprRating: string | null;
  selfRating: string | null;
  manualRating: string | null;
  checkedIn: boolean;
  queuePosition: number;
  gamesPlayed: number;
  checkInOrder: number;
  waitingSince: Date | string | null;
  lastPlayedAt: Date | string | null;
  currentGameId: number | null;
};

export type ScheduledCourt = {
  courtNumber: number;
  players: QueuePlayer[];
  teams: Array<"A" | "B">;
};

export type Schedule = {
  ordered: QueuePlayer[];
  courts: ScheduledCourt[];
  waiting: QueuePlayer[];
};

export function ratingSource(
  player: Pick<QueuePlayer, "duprRating" | "selfRating" | "manualRating">
): RatingSource {
  if (player.duprRating?.trim()) return "DUPR";
  if (player.selfRating?.trim()) return "Self-rating";
  if (player.manualRating?.trim()) return "Manual";
  return "Unrated";
}

function numeric(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tierFromThresholds(
  value: number,
  thresholds: number[]
): number | null {
  if (
    thresholds.length !== RATING_TIERS.length - 1 ||
    thresholds.some(n => !Number.isFinite(n))
  )
    return null;
  let tier = 0;
  for (const threshold of thresholds) if (value >= threshold) tier += 1;
  return Math.min(tier, RATING_TIERS.length - 1);
}

export function playerTier(
  player: Pick<QueuePlayer, "duprRating" | "selfRating" | "manualRating">,
  config: TierConfig
): number | null {
  const source = ratingSource(player);
  if (source === "DUPR") {
    const value = numeric(player.duprRating);
    return value === null
      ? null
      : tierFromThresholds(value, config.duprThresholds);
  }
  if (source === "Self-rating") {
    const raw = player.selfRating!.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(config.selfLabels, raw))
      return config.selfLabels[raw] ?? null;
    const value = numeric(player.selfRating);
    return value === null
      ? null
      : tierFromThresholds(value, config.selfNumericThresholds);
  }
  if (source === "Manual") {
    const raw = player.manualRating!.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(config.selfLabels, raw))
      return config.selfLabels[raw] ?? null;
    const value = numeric(player.manualRating);
    return value === null
      ? null
      : tierFromThresholds(value, config.selfNumericThresholds);
  }
  return null;
}

function timeValue(value: Date | string | null): number {
  if (value === null) return 0;
  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function compareFair(a: QueuePlayer, b: QueuePlayer): number {
  return (
    a.gamesPlayed - b.gamesPlayed ||
    timeValue(a.waitingSince) - timeValue(b.waitingSince) ||
    timeValue(a.lastPlayedAt) - timeValue(b.lastPlayedAt) ||
    a.checkInOrder - b.checkInOrder ||
    a.queuePosition - b.queuePosition ||
    a.id - b.id
  );
}

function compareSkill(
  a: QueuePlayer,
  b: QueuePlayer,
  config: TierConfig
): number {
  const tierA = playerTier(a, config);
  const tierB = playerTier(b, config);
  if (tierA !== tierB) {
    if (tierA === null) return 1;
    if (tierB === null) return -1;
    return tierB - tierA;
  }
  if (ratingSource(a) === "DUPR" && ratingSource(b) === "DUPR") {
    const rawA = numeric(a.duprRating) ?? 0;
    const rawB = numeric(b.duprRating) ?? 0;
    if (rawA !== rawB) return rawB - rawA;
  }
  return compareFair(a, b);
}

function assignBalancedTeams(
  players: QueuePlayer[],
  mode: GroupMode,
  config: TierConfig
): Array<"A" | "B"> {
  if (mode !== "balanced" || players.length < 2)
    return players.map((_, index) => (index % 2 === 0 ? "A" : "B"));
  const ranked = [...players].sort((a, b) => compareSkill(a, b, config));
  const teamById = new Map<number, "A" | "B">();
  ranked.forEach((player, rank) => {
    const snake = Math.floor(rank / 2) % 2 === 0 ? rank % 2 : 1 - (rank % 2);
    teamById.set(player.id, snake === 0 ? "A" : "B");
  });
  return players.map(player => teamById.get(player.id) ?? "A");
}

export function buildSchedule(
  players: QueuePlayer[],
  options: {
    strategy: Strategy;
    groupMode: GroupMode;
    courtCount: number;
    playersPerGame: number;
    tierConfig: TierConfig;
    availableCourts?: number[];
  }
): Schedule {
  const eligible = players.filter(
    player => player.checkedIn && player.currentGameId === null
  );
  const strategyOrdered = [...eligible].sort(
    options.strategy === "skill"
      ? (a, b) => compareSkill(a, b, options.tierConfig)
      : compareFair
  );
  const size = Math.max(2, Math.min(8, Math.floor(options.playersPerGame)));
  const configuredCourtCount = Math.max(
    1,
    Math.min(12, Math.floor(options.courtCount))
  );
  const courtNumbers = (
    options.availableCourts ??
    Array.from({ length: configuredCourtCount }, (_, index) => index + 1)
  ).filter(court => court >= 1 && court <= configuredCourtCount);
  const gameCount = Math.min(
    courtNumbers.length,
    Math.floor(strategyOrdered.length / size)
  );
  const courts: ScheduledCourt[] = [];

  if (options.strategy === "fair") {
    for (let i = 0; i < gameCount; i += 1) {
      const group = strategyOrdered.slice(i * size, (i + 1) * size);
      courts.push({
        courtNumber: courtNumbers[i],
        players: group,
        teams: assignBalancedTeams(
          group,
          options.groupMode,
          options.tierConfig
        ),
      });
    }
  } else {
    const rated = strategyOrdered.filter(
      player => playerTier(player, options.tierConfig) !== null
    );
    const unrated = strategyOrdered
      .filter(player => playerTier(player, options.tierConfig) === null)
      .sort(compareFair);
    let ratedIndex = 0;
    let unratedIndex = 0;
    for (let i = 0; i < gameCount; i += 1) {
      const group: QueuePlayer[] = [];
      const unratedRemaining = unrated.length - unratedIndex;
      const gamesRemaining = gameCount - i;
      const targetUnrated = Math.min(
        size,
        Math.floor(unratedRemaining / gamesRemaining) +
          (unratedRemaining % gamesRemaining > 0 ? 1 : 0)
      );
      const targetRated = size - targetUnrated;
      while (group.length < targetRated && ratedIndex < rated.length)
        group.push(rated[ratedIndex++]);
      while (
        group.length < size &&
        unratedIndex < unrated.length &&
        group.filter(player => playerTier(player, options.tierConfig) === null)
          .length < targetUnrated
      )
        group.push(unrated[unratedIndex++]);
      while (group.length < size && ratedIndex < rated.length)
        group.push(rated[ratedIndex++]);
      while (group.length < size && unratedIndex < unrated.length)
        group.push(unrated[unratedIndex++]);
      if (group.length === size) {
        courts.push({
          courtNumber: courtNumbers[i],
          players: group,
          teams: assignBalancedTeams(
            group,
            options.groupMode,
            options.tierConfig
          ),
        });
      }
    }
  }

  const assignedOrder = courts.flatMap(court => court.players);
  const assignedIds = new Set(assignedOrder.map(player => player.id));
  const waiting = strategyOrdered.filter(player => !assignedIds.has(player.id));
  return { ordered: [...assignedOrder, ...waiting], courts, waiting };
}
