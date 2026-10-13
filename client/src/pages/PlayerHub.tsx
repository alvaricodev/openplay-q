import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  LoaderCircle,
  MapPin,
  Medal,
  Trophy,
  UserRound,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";

function dateLabel(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function scoreLabel(
  a: number | null,
  b: number | null,
  winner: "A" | "B" | null
) {
  if (a === null || b === null) return "No recorded score";
  return `${a}–${b}${winner ? ` · Team ${winner} wins` : " · Tie"}`;
}

export default function PlayerHub() {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const hub = trpc.playerAccount.hub.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchInterval: 20_000,
    retry: false,
  });
  const [displayName, setDisplayName] = useState("");
  const [rankingToken, setRankingToken] = useState<string | null>(null);
  const [browserAlerts, setBrowserAlerts] = useState(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );
  const rankingQuery = trpc.playerAccount.sessionRankings.useQuery(
    { token: rankingToken ?? "" },
    { enabled: Boolean(rankingToken), retry: false }
  );
  const updateProfile = trpc.playerAccount.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.playerAccount.hub.invalidate();
      toast.success("Profile name saved");
    },
  });
  const markRead = trpc.playerAccount.markRead.useMutation({
    onSuccess: async () => {
      await utils.playerAccount.hub.invalidate();
      await utils.playerAccount.notifications.invalidate();
    },
  });

  useEffect(() => {
    if (hub.data?.profile.displayName)
      setDisplayName(hub.data.profile.displayName);
  }, [hub.data?.profile.displayName]);

  useEffect(() => {
    if (!hub.data || browserAlerts !== "granted" || !("Notification" in window))
      return;
    const now = Date.now();
    for (const notice of hub.data.notifications) {
      if (
        notice.readAt ||
        now - new Date(notice.createdAt).getTime() > 5 * 60_000
      )
        continue;
      const key = `openplay:notified:${notice.id}`;
      if (localStorage.getItem(key)) continue;
      new Notification(notice.title, {
        body: notice.body,
        tag: `openplay-${notice.id}`,
      });
      localStorage.setItem(key, "1");
    }
  }, [hub.data?.notifications, browserAlerts]);

  const unreadCount = useMemo(
    () => hub.data?.notifications.filter(item => !item.readAt).length ?? 0,
    [hub.data?.notifications]
  );
  const playerRecord = hub.data?.rankings.find(row => row.isMe);
  const enableBrowserAlerts = async () => {
    if (!("Notification" in window)) {
      toast.message("This browser does not support notifications.");
      return;
    }
    const permission = await Notification.requestPermission();
    setBrowserAlerts(permission);
    if (permission === "granted")
      toast.success("Browser alerts enabled while this page is open");
    else
      toast.message(
        "Browser alerts remain off; in-app notifications are still available."
      );
  };

  if (auth.loading || (auth.isAuthenticated && hub.isLoading))
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" size={24} /> Loading your player account…
      </main>
    );
  if (!auth.isAuthenticated)
    return (
      <main className="player-shell">
        <header className="player-topbar">
          <Link href="/" className="button button-quiet">
            <ArrowLeft size={15} /> Organizer
          </Link>
          <div className="brand-title">Open Play Queue</div>
        </header>
        <section className="player-login-card">
          <span className="player-hero-icon">
            <UserRound size={23} />
          </span>
          <p className="eyebrow">PLAYER ACCOUNT</p>
          <h1>Your matches, attached to you</h1>
          <p>
            Use the free Manus sign-in to join sessions, check in, and keep your
            scored match history and rankings across sessions.
          </p>
          <button
            className="button button-primary button-wide"
            onClick={() => startLogin()}
          >
            Sign in with Manus
          </button>
          <small>
            Sign-in is free through Manus; use Manus account sign-in to recover
            access. No player fee. The project owner may have hosting or
            database charges. We don’t ask for a DUPR or Reclub password.
          </small>
        </section>
      </main>
    );
  if (hub.error || !hub.data)
    return (
      <main className="loading-screen">
        <section className="error-card">
          <strong>Couldn’t load your player account</strong>
          <p>{hub.error?.message ?? "Try again in a moment."}</p>
          <button
            className="button button-secondary"
            onClick={() => void hub.refetch()}
          >
            Try again
          </button>
        </section>
      </main>
    );

  const data = hub.data;
  const isBrowserAlertAvailable = browserAlerts !== "unsupported";
  return (
    <main className="player-shell">
      <header className="player-topbar">
        <Link href="/" className="button button-quiet">
          <ArrowLeft size={15} /> Organizer
        </Link>
        <div className="brand-lockup">
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <i />
          </span>
          <div>
            <p className="eyebrow">PLAYER ACCOUNT</p>
            <div className="brand-title">Open Play Queue</div>
          </div>
        </div>
        <button
          className="button button-quiet"
          onClick={() => void auth.logout()}
          title="Sign out"
        >
          Sign out
        </button>
      </header>

      <section className="player-welcome" id="my-account">
        <div>
          <p className="eyebrow">YOUR PLAYER HOME</p>
          <h1>Keep your game moving.</h1>
          <p>
            Sessions you’ve joined, verified results, and your player-owned
            record.
          </p>
        </div>
        <div className="player-profile-edit">
          <label htmlFor="player-display-name">Display name</label>
          <div className="input-with-button">
            <input
              id="player-display-name"
              maxLength={160}
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
            />
            <button
              className="button button-secondary"
              disabled={
                updateProfile.isPending ||
                !displayName.trim() ||
                displayName.trim() === data.profile.displayName
              }
              onClick={() =>
                void updateProfile
                  .mutateAsync({ displayName })
                  .catch(error => toast.error(error.message))
              }
            >
              Save
            </button>
          </div>
          <small>
            Your account stays private; only your chosen display name is shown
            on session boards.
          </small>
        </div>
      </section>

      <nav
        className="player-section-nav"
        aria-label="Player account navigation"
      >
        <a href="#my-status">My Status</a>
        <a href="#courts-queue">Courts &amp; Queue</a>
        <a href="#rankings">Rankings</a>
        <a href="#past-matches">Past Matches</a>
        <a href="#my-account">My Account</a>
      </nav>

      <section className="player-summary-strip" id="my-status">
        <article className="player-summary-card">
          <span>Joined sessions</span>
          <strong>{data.sessions.length}</strong>
        </article>
        <article className="player-summary-card">
          <span>Scored matches</span>
          <strong>
            {
              data.matches.filter(
                match =>
                  match.resultStatus === "confirmed" ||
                  match.resultStatus === "corrected"
              ).length
            }
          </strong>
        </article>
        <article className="player-summary-card">
          <span>All-time ladder</span>
          <strong>
            {data.rankings.length
              ? `#${data.rankings.find(row => row.isMe)?.rank ?? "—"}`
              : "—"}
          </strong>
        </article>
        <article className="player-summary-card">
          <span>Record · W–L–T</span>
          <strong>
            {playerRecord
              ? `${playerRecord.wins}–${playerRecord.losses}–${playerRecord.ties}`
              : "0–0–0"}
          </strong>
        </article>
        <article className="player-summary-card">
          <span>Unread notices</span>
          <strong>{unreadCount}</strong>
        </article>
      </section>

      <div className="player-content-grid">
        <section className="player-panel" id="courts-queue">
          <div className="player-section-heading">
            <div>
              <p className="eyebrow">YOUR SESSIONS</p>
              <h2>Joined open play</h2>
              <p>
                Open a live board for your personal check-in and court status.
              </p>
            </div>
            <CalendarDays size={19} />
          </div>
          {data.sessions.length ? (
            <div className="player-session-list">
              {data.sessions.map(session => (
                <article
                  className="player-session-card"
                  key={session.participantId}
                >
                  <div className="player-session-main">
                    <span
                      className={`session-status-dot session-status-${session.sessionStatus}`}
                    />
                    <div>
                      <strong>{session.sessionName}</strong>
                      <div className="player-session-meta">
                        <span>
                          <CalendarDays size={13} />
                          {dateLabel(session.sessionDate)}
                        </span>
                        <span>
                          <MapPin size={13} />
                          {session.venue || "Venue not set"}
                        </span>
                      </div>
                    </div>
                    <span className="player-session-status">
                      {session.sessionStatus}
                    </span>
                  </div>
                  <p className="player-session-state">
                    {session.checkedIn
                      ? session.currentCourt
                        ? `Checked in · Court ${session.currentCourt}`
                        : `Checked in · Queue position ${session.queuePosition}`
                      : "Not checked in"}
                  </p>
                  <div className="player-session-actions">
                    <Link
                      href={`/s/${session.shareToken}`}
                      className="button button-secondary"
                    >
                      Open live board <ChevronRight size={14} />
                    </Link>
                    <button
                      className="button button-quiet"
                      onClick={() =>
                        setRankingToken(
                          rankingToken === session.shareToken
                            ? null
                            : session.shareToken
                        )
                      }
                    >
                      <Trophy size={14} />{" "}
                      {rankingToken === session.shareToken
                        ? "Hide ladder"
                        : "Session ladder"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="player-empty">
              <strong>No sessions joined yet</strong>
              <p>
                Open a session invitation and sign in to join it. Your linked
                account will recognize you at future sessions.
              </p>
            </div>
          )}
          {rankingToken && (
            <div className="player-rankings-inline">
              <h3>Session ladder</h3>
              {rankingQuery.isLoading ? (
                <p>Loading results…</p>
              ) : rankingQuery.error ? (
                <p>{rankingQuery.error.message}</p>
              ) : rankingQuery.data?.length ? (
                <RankingTable rows={rankingQuery.data} />
              ) : (
                <p>
                  Confirmed match results will appear here. Unscored and
                  cancelled matches do not count.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="player-panel player-inbox-panel">
          <div className="player-section-heading">
            <div>
              <p className="eyebrow">PRIVATE TO YOUR ACCOUNT</p>
              <h2>
                Notifications <span className="count-chip">{unreadCount}</span>
              </h2>
              <p>
                Queue assignments, result confirmations, and session timer
                updates.
              </p>
            </div>
            <Bell size={19} />
          </div>
          {isBrowserAlertAvailable && browserAlerts !== "granted" && (
            <button
              className="button button-secondary player-alert-button"
              onClick={() => void enableBrowserAlerts()}
            >
              <Bell size={14} /> Enable browser alerts while page is open
            </button>
          )}
          {data.notifications.length ? (
            <div className="player-notice-list">
              {data.notifications.map(notice => (
                <article
                  className={`player-notice ${notice.readAt ? "player-notice-read" : ""}`}
                  key={notice.id}
                >
                  <span className="notice-icon">
                    <Bell size={14} />
                  </span>
                  <div>
                    <strong>{notice.title}</strong>
                    <p>{notice.body}</p>
                    <small>
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(notice.createdAt))}
                    </small>
                  </div>
                  {!notice.readAt && (
                    <button
                      className="icon-button"
                      title="Mark as read"
                      aria-label="Mark notification as read"
                      onClick={() =>
                        void markRead.mutateAsync({ notificationId: notice.id })
                      }
                    >
                      <Check size={16} />
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="player-empty">
              <strong>You’re all caught up</strong>
              <p>New assignments and scores will arrive here.</p>
            </div>
          )}
          <p className="field-help">
            <CircleAlert size={13} /> Browser alerts need permission and this
            page open. In-app notifications remain available in your account.
          </p>
        </section>
      </div>

      <section className="player-panel player-history-panel" id="past-matches">
        <div className="player-section-heading">
          <div>
            <p className="eyebrow">PERMANENT ACCOUNT HISTORY</p>
            <h2>My matches</h2>
            <p>
              Only confirmed or explicitly corrected scores count. Cancelled and
              unscored matches remain visible but don’t affect rankings.
            </p>
          </div>
          <Clock3 size={19} />
        </div>
        {data.matches.length ? (
          <div className="player-match-list">
            {data.matches.map(match => (
              <article
                className="player-match-card"
                key={`${match.gameId}-${match.sessionId}`}
              >
                <div className="player-match-top">
                  <div>
                    <strong>{match.sessionName}</strong>
                    <span>
                      {dateLabel(match.sessionDate)} ·{" "}
                      {match.venue || "Venue not set"} · Court{" "}
                      {match.courtNumber}
                    </span>
                  </div>
                  <span
                    className={`match-result-state match-result-${match.resultStatus}`}
                  >
                    {match.resultStatus}
                  </span>
                </div>
                <div className="player-match-score">
                  {scoreLabel(
                    match.teamAScore,
                    match.teamBScore,
                    match.winningTeam
                  )}
                </div>
                <div className="player-match-teams">
                  <div>
                    <small>TEAM A</small>
                    {match.players
                      .filter(person => person.team === "A")
                      .map(person => (
                        <span
                          className={person.isMe ? "is-me" : ""}
                          key={`${match.gameId}-A-${person.name}`}
                        >
                          {person.name}
                          {person.isMe ? " · You" : ""}
                        </span>
                      ))}
                  </div>
                  <div>
                    <small>TEAM B</small>
                    {match.players
                      .filter(person => person.team === "B")
                      .map(person => (
                        <span
                          className={person.isMe ? "is-me" : ""}
                          key={`${match.gameId}-B-${person.name}`}
                        >
                          {person.name}
                          {person.isMe ? " · You" : ""}
                        </span>
                      ))}
                  </div>
                </div>
                <div className="player-match-foot">
                  <span>
                    {match.resultType === "time_expired" ||
                    match.resultType === "tie"
                      ? "Time-Expired Result"
                      : match.resultType === "normal"
                        ? "Normal Match"
                        : "No settled result"}
                  </span>
                  {match.durationSeconds !== null &&
                    match.durationSeconds > 0 && (
                      <span>{Math.floor(match.durationSeconds / 60)} min</span>
                    )}
                  <button
                    className="button button-quiet button-small"
                    disabled={
                      match.teamAScore === null || match.teamBScore === null
                    }
                    onClick={() => {
                      const teamA = match.players
                        .filter(person => person.team === "A")
                        .map(person => person.name)
                        .join(" & ");
                      const teamB = match.players
                        .filter(person => person.team === "B")
                        .map(person => person.name)
                        .join(" & ");
                      const winner = match.winningTeam
                        ? `Team ${match.winningTeam}`
                        : match.resultType === "tie"
                          ? "Tie"
                          : "Not recorded";
                      const summary = [
                        `Open Play Match Summary`,
                        `Session: ${match.sessionName}`,
                        `Date: ${dateLabel(match.sessionDate)}`,
                        `Venue: ${match.venue || "Venue not set"}`,
                        `Court: ${match.courtNumber}`,
                        `Team A: ${teamA}`,
                        `Team B: ${teamB}`,
                        `Final Score: ${match.teamAScore}–${match.teamBScore}`,
                        `Winner: ${winner}`,
                        `Result: ${match.resultType === "time_expired" || match.resultType === "tie" ? "Time-Expired Result" : "Normal Match"}`,
                      ].join("\n");
                      void navigator.clipboard
                        .writeText(summary)
                        .then(() =>
                          toast.success("Actual match summary copied")
                        )
                        .catch(() =>
                          toast.error("Clipboard access is unavailable")
                        );
                    }}
                  >
                    <Copy size={13} /> Copy summary
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="player-empty">
            <span className="player-hero-icon">
              <Medal size={20} />
            </span>
            <strong>No match records yet</strong>
            <p>
              Your permanent match history begins when an organizer confirms a
              score for a game you played.
            </p>
          </div>
        )}
      </section>

      <section className="player-panel player-ladder-panel" id="rankings">
        <div className="player-section-heading">
          <div>
            <p className="eyebrow">ACCOUNT-LINKED RESULTS</p>
            <h2>All-time ladder</h2>
            <p>
              Calculated from confirmed/corrected matches you played with this
              account. Walk-ins and unscored games are excluded.
            </p>
          </div>
          <Trophy size={19} />
        </div>
        {data.rankings.length ? (
          <RankingTable rows={data.rankings} />
        ) : (
          <div className="player-empty">
            <strong>Rankings will build from real scores</strong>
            <p>
              No sample players, invented scores, or unrated placeholder
              accounts are added.
            </p>
          </div>
        )}
      </section>

      <footer className="player-page-footer">
        <span>Open Play Queue</span>
        <span>Free account sign-in · no DUPR or Reclub password requested</span>
      </footer>
    </main>
  );
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
    pointsScored: number;
    pointsConceded: number;
    pointDifferential: number;
    isMe?: boolean;
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
            <tr
              className={row.isMe ? "ranking-me" : ""}
              key={`${row.rank}-${row.name}`}
            >
              <td>{row.rank}</td>
              <td>
                {row.name}
                {row.isMe ? " · You" : ""}
              </td>
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
