import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  DEFAULT_TIER_CONFIG,
  playerTier,
  type QueuePlayer,
} from "./openPlay";
import {
  parseParticipantText,
  parsePastedNames,
} from "../client/src/lib/openPlayImport";

function player(id: number, partial: Partial<QueuePlayer> = {}): QueuePlayer {
  return {
    id,
    name: `Player ${id}`,
    duprRating: null,
    selfRating: null,
    manualRating: null,
    checkedIn: true,
    queuePosition: id,
    gamesPlayed: 0,
    checkInOrder: id,
    waitingSince: new Date(2026, 0, 1, 12, 0, 0),
    lastPlayedAt: null,
    currentGameId: null,
    ...partial,
  };
}

describe("open-play queue rules", () => {
  it("sorts players with DUPR ratings on their normalized tier and compatible DUPR scale", () => {
    const schedule = buildSchedule(
      [
        player(1, { duprRating: "3.15" }),
        player(2, { duprRating: "4.15" }),
        player(3, { duprRating: "3.42" }),
        player(4, { duprRating: "4.02" }),
      ],
      {
        strategy: "skill",
        groupMode: "similar",
        courtCount: 1,
        playersPerGame: 4,
        tierConfig: DEFAULT_TIER_CONFIG,
      }
    );
    expect(schedule.courts[0].players.map(person => person.id)).toEqual([
      2, 4, 3, 1,
    ]);
  });

  it("maps DUPR and self-ratings through distinct source-specific cutoffs", () => {
    expect(
      playerTier(
        player(1, { duprRating: "3.75", selfRating: "Beginner" }),
        DEFAULT_TIER_CONFIG
      )
    ).toBe(3);
    expect(
      playerTier(player(2, { selfRating: "Advanced" }), DEFAULT_TIER_CONFIG)
    ).toBe(3);
    expect(playerTier(player(3), DEFAULT_TIER_CONFIG)).toBeNull();
  });

  it("spreads unrated players across courts instead of grouping them together", () => {
    const mixed = [
      player(1, { duprRating: "4.2" }),
      player(2, { duprRating: "4.0" }),
      player(3, { selfRating: "Intermediate" }),
      player(4, { duprRating: "3.0" }),
      player(5),
      player(6),
      player(7),
      player(8),
    ];
    const schedule = buildSchedule(mixed, {
      strategy: "skill",
      groupMode: "similar",
      courtCount: 2,
      playersPerGame: 4,
      tierConfig: DEFAULT_TIER_CONFIG,
    });
    expect(schedule.courts).toHaveLength(2);
    expect(
      schedule.courts.map(
        court =>
          court.players.filter(
            person => playerTier(person, DEFAULT_TIER_CONFIG) === null
          ).length
      )
    ).toEqual([2, 2]);
    const assigned = schedule.courts.flatMap(court =>
      court.players.map(person => person.id)
    );
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("uses fair rotation for an all-unrated session and creates disjoint court groups", () => {
    const players = [
      player(1, { gamesPlayed: 2 }),
      player(2),
      player(3, { gamesPlayed: 1 }),
      player(4),
      player(5, { gamesPlayed: 3 }),
      player(6),
      player(7),
      player(8),
    ];
    const schedule = buildSchedule(players, {
      strategy: "fair",
      groupMode: "similar",
      courtCount: 2,
      playersPerGame: 4,
      tierConfig: DEFAULT_TIER_CONFIG,
    });
    expect(schedule.courts).toHaveLength(2);
    expect(schedule.ordered.slice(0, 4).map(person => person.id)).toEqual([
      2, 4, 6, 7,
    ]);
    const assigned = schedule.courts.flatMap(court =>
      court.players.map(person => person.id)
    );
    expect(new Set(assigned).size).toBe(8);
    expect(schedule.waiting).toHaveLength(0);
  });

  it("assigns new groups only to available courts while another court is occupied", () => {
    const schedule = buildSchedule(
      Array.from({ length: 8 }, (_, index) => player(index + 1)),
      {
        strategy: "fair",
        groupMode: "similar",
        courtCount: 2,
        playersPerGame: 4,
        tierConfig: DEFAULT_TIER_CONFIG,
        availableCourts: [2],
      }
    );
    expect(schedule.courts).toHaveLength(1);
    expect(schedule.courts[0].courtNumber).toBe(2);
    expect(schedule.waiting).toHaveLength(4);
  });

  it("uses longer current waiting time to break ties when players have equal game counts", () => {
    const oldWait = new Date(2026, 0, 1, 11, 0, 0);
    const newWait = new Date(2026, 0, 1, 11, 30, 0);
    expect(
      buildSchedule(
        [
          player(1, { waitingSince: newWait }),
          player(2, { waitingSince: oldWait }),
        ],
        {
          strategy: "fair",
          groupMode: "similar",
          courtCount: 1,
          playersPerGame: 2,
          tierConfig: DEFAULT_TIER_CONFIG,
        }
      ).ordered.map(person => person.id)
    ).toEqual([2, 1]);
  });
});

describe("manual and CSV imports", () => {
  it("parses CSV with headers, ratings, check-in status, and quoted names", () => {
    const players = parseParticipantText(
      '\ufeffname,dupr_rating,self_rating,checked_in\n"Lee, Jordan",4.1,,yes\nCasey,,Advanced,false\n'
    );
    expect(players).toEqual([
      {
        name: "Lee, Jordan",
        duprRating: "4.1",
        selfRating: "",
        manualRating: "",
        registrationStatus: "",
        checkedIn: true,
      },
      {
        name: "Casey",
        duprRating: "",
        selfRating: "Advanced",
        manualRating: "",
        registrationStatus: "",
        checkedIn: false,
      },
    ]);
  });

  it("accepts a pasted participant list and ignores blank lines", () => {
    expect(
      parsePastedNames("Alex\n\nRobin, Taylor; Sam").map(person => person.name)
    ).toEqual(["Alex", "Robin", "Taylor", "Sam"]);
  });
});
