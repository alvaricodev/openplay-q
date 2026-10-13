import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  CircleAlert,
  Clock3,
  LoaderCircle,
  MapPin,
  Medal,
  Radio,
  Trophy,
  UserRound,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";

function sessionDate(date: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function durationText(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function SharedSession({
  params,
}: {
  params: { token: string };
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.session.publicView.useQuery(
    { token: params.token },
    { refetchInterval: 5000, retry: false }
  );
  const statusQuery = trpc.playerAccount.myStatus.useQuery(
    { token: params.token },
    { enabled: auth.isAuthenticated, refetchInterval: 5000, retry: false }
  );
  const [displayName, setDisplayName] = useState("");
  const [showRankings, setShowRankings] = useState(false);
  const [, setTick] = useState(0);
  const [clockAnchor, setClockAnchor] = useState({
    server: Date.now(),
    client: performance.now(),
  });
  const joinMutation = trpc.playerAccount.join.useMutation({
    onSuccess: async () => {
      await statusQuery.refetch();
      await utils.playerAccount.hub.invalidate();
      await query.refetch();
      toast.success("You joined this session");
    },
  });
  const checkInMutation = trpc.playerAccount.checkIn.useMutation({
    onSuccess: async () => {
      await statusQuery.refetch();
      await query.refetch();
      toast.success("Your check-in was updated");
    },
  });
  const rankings = trpc.playerAccount.sessionRankings.useQuery(
    { token: params.token },
    {
      enabled: showRankings && Boolean(statusQuery.data?.participant),
      retry: false,
    }
  );
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (query.data?.session.serverNow)
      setClockAnchor({
        server: new Date(query.data.session.serverNow).getTime(),
        client: performance.now(),
      });
  }, [query.data?.session.serverNow]);
  useEffect(() => {
    if (auth.user?.name && !displayName) setDisplayName(auth.user.name);
  }, [auth.user?.name, displayName]);
  const now = clockAnchor.server + (performance.now() - clockAnchor.client);

  if (query.isLoading)
    return (
      <main className="public-shell">
        <div className="public-loading">
          <LoaderCircle className="spin" size={24} /> Opening live session…
        </div>
      </main>
    );
  if (query.error || !query.data)
    return (
      <main className="public-shell">
        <section className="public-error">
          <CircleAlert size={25} />
          <h1>Session link unavailable</h1>
          <p>
            This read-only link may have expired or be incorrect. Ask the
            organizer for the current session link.
          </p>
          <Link href="/" className="button button-secondary">
            <ArrowLeft size={15} /> Back
          </Link>
        </section>
      </main>
    );

  const data = query.data;
  const mine = statusQuery.data?.participant ?? null;
  const courtByNumber = new Map(
    data.courts.map(court => [court.courtNumber, court])
  );
  const session = data.session;
  const sessionRemaining = session.endsAt
    ? new Date(session.endsAt).getTime() - now
    : null;
  const untilStart = session.scheduledStartAt
    ? new Date(session.scheduledStartAt ?? session.sessionDate).getTime() - now
    : null;
  const activeGames = data.courts.filter(
    court => court.status === "playing"
  ).length;
  const timerLabel =
    session.status === "scheduled"
      ? untilStart !== null && untilStart > 0
        ? `Starts in ${durationText(untilStart)}`
        : "Ready to start"
      : session.status === "live"
        ? sessionRemaining === null
          ? "Timer not started"
          : sessionRemaining > 0
            ? `Ends in ${durationText(sessionRemaining)}`
            : "Time expired"
        : session.status === "ending"
          ? "Ending — Matches Need Settlement"
          : session.status === "finished"
            ? "Session finished"
            : "Session cancelled";
  const timerClass =
    session.status === "ending" ||
    (sessionRemaining !== null &&
      sessionRemaining <= 15 * 60_000 &&
      sessionRemaining > 0)
      ? "session-clock-warning"
      : session.status === "finished" || session.status === "cancelled"
        ? "session-clock-closed"
        : "";

  return (
    <main className="public-shell">
      <header className="public-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <i />
          </div>
          <div>
            <p className="eyebrow">PLAYER VIEW</p>
            <div className="brand-title">Open Play Queue</div>
          </div>
        </div>
        <div className="public-header-actions">
          <span className="public-live">
            <Radio size={14} /> Live · refreshes every 5s
          </span>
          {auth.isAuthenticated ? (
            <Link
              className="button button-secondary button-small"
              href="/player"
            >
              My account
            </Link>
          ) : (
            <button
              className="button button-primary button-small"
              onClick={() => startLogin()}
            >
              Sign in to join
            </button>
          )}
        </div>
      </header>

      <section className="public-session-heading">
        <p className="eyebrow">SHARED SESSION BOARD · READ-ONLY</p>
        <h1>{session.name}</h1>
        <div className="session-details">
          <span>
            <CalendarDays size={15} />
            {sessionDate(session.sessionDate)}
          </span>
          <span>
            <MapPin size={15} />
            {session.venue || "Venue not set"}
          </span>
        </div>
        <div className={`session-clock ${timerClass}`}>
          <Clock3 size={17} />
          <div>
            <small>SESSION CLOCK</small>
            <strong>{timerLabel}</strong>
            <span className="clock-schedule-meta">
              {session.startedAt
                ? `Started ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(session.startedAt))}`
                : `Scheduled ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(session.scheduledStartAt ?? session.sessionDate))}`}
              {session.endsAt
                ? ` · Ends ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(session.endsAt))}`
                : ""}
            </span>
          </div>
          {session.status === "live" &&
            sessionRemaining !== null &&
            sessionRemaining <= 15 * 60_000 &&
            sessionRemaining > 0 && (
              <span className="clock-warning-tag">
                15 minutes left · finish active games
              </span>
            )}
        </div>
        <div className="public-counts">
          <span>
            <b>{data.checkedInCount}</b> checked in
          </span>
          <span>
            <b>{activeGames}</b> on court
          </span>
          <span>
            <b>{data.waiting.length}</b> waiting
          </span>
          <span>
            <b>{session.activeMatchCount}</b> active matches
          </span>
        </div>
      </section>

      {!auth.isAuthenticated ? (
        <section className="player-join-banner">
          <span className="player-hero-icon">
            <UserRoundIcon />
          </span>
          <div>
            <strong>Keep your matches connected to you</strong>
            <p>
              Sign in with a free Manus account to join, check in, receive court
              notices, and build a permanent match history.
            </p>
          </div>
          <button
            className="button button-primary"
            onClick={() => startLogin()}
          >
            Sign in to join
          </button>
        </section>
      ) : statusQuery.isLoading ? (
        <div className="player-join-banner">
          <LoaderCircle className="spin" size={18} /> Checking your session
          membership…
        </div>
      ) : mine ? (
        <section className="player-join-banner player-joined-banner">
          <span className="player-hero-icon">
            <Medal size={18} />
          </span>
          <div>
            <strong>You’re in this session, {mine.name}</strong>
            <p>
              {mine.currentCourt
                ? `You’re assigned to Court ${mine.currentCourt}.`
                : mine.checkedIn
                  ? `You’re checked in · queue position ${mine.queuePosition} · ${mine.gamesPlayed} games played.`
                  : "You’re registered and not checked in yet."}
            </p>
          </div>
          {(session.status === "scheduled" || session.status === "live") && (
            <button
              className={`button ${mine.checkedIn ? "button-secondary" : "button-primary"}`}
              disabled={checkInMutation.isPending || Boolean(mine.currentCourt)}
              onClick={() =>
                void checkInMutation
                  .mutateAsync({
                    token: params.token,
                    checkedIn: !mine.checkedIn,
                  })
                  .catch(error => toast.error(error.message))
              }
            >
              {mine.currentCourt
                ? `On Court ${mine.currentCourt}`
                : mine.checkedIn
                  ? "Check out"
                  : "Check in"}
            </button>
          )}
          <button
            className="button button-quiet"
            onClick={() => setShowRankings(value => !value)}
          >
            <Trophy size={14} />{" "}
            {showRankings ? "Hide ladder" : "Session ladder"}
          </button>
        </section>
      ) : (
        <section className="player-join-banner">
          <span className="player-hero-icon">
            <UserRoundIcon />
          </span>
          <div className="join-copy">
            <strong>Join this open-play session</strong>
            <p>
              Choose the display name the organizer and other players should
              see.
            </p>
          </div>
          <div className="join-controls">
            <input
              aria-label="Player display name"
              maxLength={160}
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              placeholder="Your player name"
            />
            <button
              className="button button-primary"
              disabled={
                !displayName.trim() ||
                joinMutation.isPending ||
                session.status === "ending" ||
                session.status === "finished" ||
                session.status === "cancelled"
              }
              onClick={() =>
                void joinMutation
                  .mutateAsync({ token: params.token, displayName })
                  .catch(error => toast.error(error.message))
              }
            >
              {joinMutation.isPending ? (
                <LoaderCircle className="spin" size={15} />
              ) : null}{" "}
              Join session
            </button>
          </div>
        </section>
      )}

      {showRankings && mine && (
        <section className="player-rankings-inline public-rankings">
          <div className="player-section-heading">
            <div>
              <p className="eyebrow">SESSION RESULTS</p>
              <h2>Session ladder</h2>
            </div>
            <Trophy size={17} />
          </div>
          {rankings.isLoading ? (
            <p>Loading confirmed scores…</p>
          ) : rankings.error ? (
            <p>{rankings.error.message}</p>
          ) : rankings.data?.length ? (
            <RankingTable rows={rankings.data} />
          ) : (
            <p>
              No confirmed matches yet. Unscored and cancelled matches don’t
              affect this ladder.
            </p>
          )}
        </section>
      )}

      <div className="public-board">
        <section className="public-panel">
          <div className="public-panel-heading">
            <div>
              <p className="eyebrow">LIVE COURTS</p>
              <h2>Court board</h2>
            </div>
          </div>
          <div className="court-list public-court-list">
            {Array.from({ length: session.courtCount }, (_, index) => {
              const number = index + 1;
              const court = courtByNumber.get(number);
              return (
                <article
                  className={`court-card ${court?.status === "playing" ? "court-active" : ""}`}
                  key={number}
                >
                  <div className="court-heading">
                    <div className="court-name">
                      <span className="court-mark">
                        <i />
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>Court {number}</strong>
                    </div>
                    <span
                      className={`court-state ${court ? (court.status === "playing" ? "court-state-playing" : "court-state-ready") : "court-state-empty"}`}
                    >
                      {court
                        ? court.status === "playing"
                          ? "In play"
                          : "Ready"
                        : "Open"}
                    </span>
                  </div>
                  {court ? (
                    <>
                      <div className="court-players">
                        {court.players.map((person, i) => (
                          <div
                            className="court-player"
                            key={`${person.name}-${i}`}
                          >
                            <span
                              className={`team-mark team-${person.team.toLowerCase()}`}
                            >
                              {person.team}
                            </span>
                            <span>{person.name}</span>
                          </div>
                        ))}
                      </div>
                      {court.teamAScore !== null &&
                        court.teamBScore !== null && (
                          <div className="public-court-score">
                            Final score{" "}
                            <strong>
                              {court.teamAScore}–{court.teamBScore}
                            </strong>
                            {court.winningTeam ? (
                              <span>Team {court.winningTeam} won</span>
                            ) : (
                              <span>Tie at time</span>
                            )}
                          </div>
                        )}
                    </>
                  ) : (
                    <div className="court-empty">
                      <span className="empty-court-lines">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>Waiting for a full group</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
        <section className="public-panel">
          <div className="public-panel-heading">
            <div>
              <p className="eyebrow">UP NEXT</p>
              <h2>
                Waiting queue{" "}
                <span className="count-chip">{data.waiting.length}</span>
              </h2>
            </div>
          </div>
          {data.waiting.length ? (
            <ol className="public-queue-list">
              {data.waiting.map(person => (
                <li
                  className={
                    mine?.name === person.name ? "public-queue-me" : ""
                  }
                  key={`${person.position}-${person.name}`}
                >
                  <span className="queue-position">{person.position}</span>
                  <span className="avatar">
                    {person.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map(part => part[0]?.toUpperCase() ?? "")
                      .join("")}
                  </span>
                  <strong>
                    {person.name}
                    {mine?.name === person.name ? " · You" : ""}
                  </strong>
                  <span className="status-waiting public-waiting-label">
                    Waiting
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <strong>No one waiting</strong>
              <p>Check this board again shortly for the next assignments.</p>
            </div>
          )}
        </section>
      </div>
      <footer className="public-footer">
        <Link href="/player">
          {auth.isAuthenticated
            ? "Open your player account"
            : "Player account sign-in"}
        </Link>
        <span> · Read-only view · organizer controls stay private</span>
        <span className="public-refresh">
          <Bell size={12} /> Account notices are private
        </span>
      </footer>
    </main>
  );
}

function UserRoundIcon() {
  return <UserRound size={19} />;
}

function RankingTable({
  rows,
}: {
  rows: Array<{
    rank: number;
    name: string;
    gamesPlayed: number;
    wins: number;
    losses: number;
    ties: number;
    winPercentage: number;
    pointDifferential: number;
  }>;
}) {
  return (
    <div className="ranking-table-wrap">
      <table className="ranking-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>W–L–T</th>
            <th>Win %</th>
            <th>Pts ±</th>
            <th>Games</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={`${row.rank}-${row.name}`}>
              <td>{row.rank}</td>
              <td>{row.name}</td>
              <td>
                {row.wins}–{row.losses}–{row.ties}
              </td>
              <td>{row.winPercentage.toFixed(0)}%</td>
              <td>
                {row.pointDifferential > 0 ? "+" : ""}
                {row.pointDifferential}
              </td>
              <td>{row.gamesPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
