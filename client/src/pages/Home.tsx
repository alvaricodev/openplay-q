import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  LoaderCircle,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Settings2,
  Share2,
  Sparkles,
  Upload,
  Users,
  Trophy,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  parseParticipantText,
  parsePastedNames,
  type ImportedPlayer,
} from "@/lib/openPlayImport";
import {
  DEFAULT_TIER_CONFIG,
  RATING_TIERS,
  playerTier,
  ratingSource,
  type TierConfig,
} from "@shared/openPlay";
import type { Participant } from "@shared/types";

type ModalName =
  | "import"
  | "add"
  | "settings"
  | "new-session"
  | "schedule"
  | "invite"
  | "score"
  | "correct-score"
  | "cancel-match"
  | "cancel-session"
  | "adjust-end"
  | null;
type EditablePlayer = Pick<
  Participant,
  "id" | "name" | "duprRating" | "selfRating" | "manualRating"
>;

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function shortDate(date: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function countdownLabel(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function safeName(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");
}

function waitLabel(waitingSince: Date | string | null) {
  if (!waitingSince) return null;
  const elapsed = Date.now() - new Date(waitingSince).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 1
    ? "<1m"
    : minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function csvCell(value: string | number | boolean | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export default function Home() {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const currentQuery = trpc.session.current.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
  });
  const notificationsQuery = trpc.playerAccount.notifications.useQuery(
    undefined,
    { enabled: auth.isAuthenticated, refetchInterval: 5000, retry: false }
  );
  const [selectedSessionId, setSelectedSessionId] = useState<number>();
  const selectedQuery = trpc.session.byId.useQuery(
    { sessionId: selectedSessionId ?? 1 },
    {
      enabled:
        auth.isAuthenticated &&
        selectedSessionId !== undefined &&
        selectedSessionId !== currentQuery.data?.session.id,
      retry: false,
      refetchInterval: 5000,
    }
  );
  const dashboard =
    selectedSessionId === undefined ||
    selectedSessionId === currentQuery.data?.session.id
      ? currentQuery.data
      : selectedQuery.data;
  const [modal, setModal] = useState<ModalName>(null);
  const [editingPlayer, setEditingPlayer] = useState<EditablePlayer | null>(
    null
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"csv" | "paste">("csv");
  const [importText, setImportText] = useState("");
  const [reclubUrl, setReclubUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [newDupr, setNewDupr] = useState("");
  const [newSelf, setNewSelf] = useState("");
  const [newManual, setNewManual] = useState("");
  const [sessionName, setSessionName] = useState("Open Play");
  const [sessionVenue, setSessionVenue] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState(() =>
    localDateTimeValue(new Date(Date.now() + 30 * 60_000))
  );
  const [sessionDuration, setSessionDuration] = useState(240);
  const [sessionCourtCount, setSessionCourtCount] = useState(2);
  const [sessionPlayersPerGame, setSessionPlayersPerGame] = useState(4);
  const [sessionStrategy, setSessionStrategy] = useState<"fair" | "skill">(
    "fair"
  );
  const [sessionGroupMode, setSessionGroupMode] = useState<
    "similar" | "balanced"
  >("similar");
  const [sessionNotes, setSessionNotes] = useState("");
  const [settingsDraft, setSettingsDraft] = useState({
    courtCount: 2,
    playersPerGame: 4,
    strategy: "fair" as "fair" | "skill",
    groupMode: "similar" as "similar" | "balanced",
    tierConfig: DEFAULT_TIER_CONFIG as TierConfig,
  });
  const [copied, setCopied] = useState(false);
  const [, setClockTick] = useState(0);
  const [clockAnchor, setClockAnchor] = useState({
    server: Date.now(),
    client: performance.now(),
  });
  const [scoreTarget, setScoreTarget] = useState<number | null>(null);
  const [scoreA, setScoreA] = useState("11");
  const [scoreB, setScoreB] = useState("0");
  const [scoreReason, setScoreReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [adjustEndValue, setAdjustEndValue] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [browserPermission, setBrowserPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );

  useEffect(() => {
    const timer = window.setInterval(
      () => setClockTick(value => value + 1),
      1000
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (dashboard?.serverNow)
      setClockAnchor({
        server: new Date(dashboard.serverNow).getTime(),
        client: performance.now(),
      });
  }, [dashboard?.serverNow]);

  useEffect(() => {
    if (
      !notificationsQuery.data ||
      browserPermission !== "granted" ||
      !("Notification" in window)
    )
      return;
    const now = Date.now();
    for (const notice of notificationsQuery.data) {
      if (
        notice.readAt ||
        now - new Date(notice.createdAt).getTime() > 5 * 60_000
      )
        continue;
      const key = `openplay:organizer-notified:${notice.id}`;
      if (localStorage.getItem(key)) continue;
      new Notification(notice.title, {
        body: notice.body,
        tag: `openplay-org-${notice.id}`,
      });
      localStorage.setItem(key, "1");
    }
  }, [notificationsQuery.data, browserPermission]);

  useEffect(() => {
    if (currentQuery.data && selectedSessionId === undefined)
      setSelectedSessionId(currentQuery.data.session.id);
  }, [currentQuery.data, selectedSessionId]);

  useEffect(() => {
    if (!dashboard) return;
    setSettingsDraft({
      courtCount: dashboard.session.courtCount,
      playersPerGame: dashboard.session.playersPerGame,
      strategy: dashboard.session.strategy,
      groupMode: dashboard.session.groupMode,
      tierConfig: (() => {
        try {
          return JSON.parse(dashboard.session.tierConfig) as TierConfig;
        } catch {
          return DEFAULT_TIER_CONFIG;
        }
      })(),
    });
  }, [dashboard?.session.id, dashboard?.session.updatedAt]);

  const refresh = async () => {
    await utils.session.current.invalidate();
    if (selectedSessionId !== undefined)
      await utils.session.byId.invalidate({ sessionId: selectedSessionId });
  };
  const addMutation = trpc.players.add.useMutation({ onSuccess: refresh });
  const importMutation = trpc.players.import.useMutation({
    onSuccess: refresh,
  });
  const checkInMutation = trpc.players.checkIn.useMutation({
    onSuccess: refresh,
  });
  const ratingMutation = trpc.players.updateRating.useMutation({
    onSuccess: refresh,
  });
  const queueMutation = trpc.queue.generate.useMutation({ onSuccess: refresh });
  const moveMutation = trpc.queue.move.useMutation({ onSuccess: refresh });
  const resetMutation = trpc.queue.reset.useMutation({ onSuccess: refresh });
  const settingsMutation = trpc.session.updateSettings.useMutation({
    onSuccess: refresh,
  });
  const createSessionMutation = trpc.session.create.useMutation({
    onSuccess: async result => {
      setSelectedSessionId(result.session.id);
      setModal(null);
      await utils.session.current.invalidate();
      toast.success("Session created");
    },
  });
  const startGameMutation = trpc.games.start.useMutation({
    onSuccess: refresh,
  });
  const finishGameMutation = trpc.games.finish.useMutation({
    onSuccess: refresh,
  });
  const returnGameMutation = trpc.games.returnToQueue.useMutation({
    onSuccess: refresh,
  });
  const startSessionMutation = trpc.session.start.useMutation({
    onSuccess: refresh,
  });
  const updateScheduleMutation = trpc.session.updateSchedule.useMutation({
    onSuccess: refresh,
  });
  const extendSessionMutation = trpc.session.extend.useMutation({
    onSuccess: refresh,
  });
  const adjustEndMutation = trpc.session.adjustEnd.useMutation({
    onSuccess: refresh,
  });
  const finishSessionMutation = trpc.session.finish.useMutation({
    onSuccess: refresh,
  });
  const finalizeSessionMutation = trpc.session.finalize.useMutation({
    onSuccess: refresh,
  });
  const cancelSessionMutation = trpc.session.cancel.useMutation({
    onSuccess: refresh,
  });
  const cancelGameMutation = trpc.games.cancel.useMutation({
    onSuccess: refresh,
  });
  const correctGameMutation = trpc.games.correct.useMutation({
    onSuccess: refresh,
  });
  const auditQuery = trpc.session.audit.useQuery(
    { sessionId: selectedSessionId ?? 1 },
    { enabled: auditOpen && Boolean(selectedSessionId), retry: false }
  );
  const correctionAuditQuery = trpc.session.resultAudit.useQuery(
    { sessionId: selectedSessionId ?? 1, gameId: scoreTarget ?? 1 },
    {
      enabled:
        modal === "correct-score" && Boolean(selectedSessionId && scoreTarget),
      retry: false,
    }
  );
  const markNotificationReadMutation = trpc.playerAccount.markRead.useMutation({
    onSuccess: async () => {
      await notificationsQuery.refetch();
    },
  });

  const players = dashboard?.participants ?? [];
  const currentSession = dashboard?.session;
  const activeGames = useMemo(
    () =>
      (dashboard?.games ?? []).filter(
        game => game.status === "ready" || game.status === "playing"
      ),
    [dashboard?.games]
  );
  const gameById = useMemo(
    () => new Map((dashboard?.games ?? []).map(game => [game.id, game])),
    [dashboard?.games]
  );
  const stats = useMemo(
    () => ({
      total: players.length,
      checkedIn: players.filter(person => person.checkedIn).length,
      playing: players.filter(person => person.status === "playing").length,
      waiting: players.filter(
        person => person.checkedIn && person.currentGameId === null
      ).length,
      unrated: players.filter(person => ratingSource(person) === "Unrated")
        .length,
    }),
    [players]
  );

  const openAdd = (person?: EditablePlayer) => {
    setEditingPlayer(person ?? null);
    setNewName(person?.name ?? "");
    setNewDupr(person?.duprRating ?? "");
    setNewSelf(person?.selfRating ?? "");
    setNewManual(person?.manualRating ?? "");
    setModal("add");
  };

  const closeModal = () => {
    setModal(null);
    setEditingPlayer(null);
    setImportText("");
    setToastMessage(null);
  };

  const submitPlayer = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentSession) return;
    try {
      if (editingPlayer) {
        await ratingMutation.mutateAsync({
          sessionId: currentSession.id,
          participantId: editingPlayer.id,
          duprRating: newDupr,
          selfRating: newSelf,
          manualRating: newManual,
        });
        toast.success("Rating updated");
      } else {
        await addMutation.mutateAsync({
          sessionId: currentSession.id,
          name: newName,
          duprRating: newDupr,
          selfRating: newSelf,
          manualRating: newManual,
        });
        toast.success("Player added — check them in when they arrive");
      }
      closeModal();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save player"
      );
    }
  };

  const importPlayers = async (rows: ImportedPlayer[]) => {
    if (!currentSession) return;
    if (!rows.length) {
      setToastMessage(
        "No participant rows found. Add a name column or paste a name per line."
      );
      return;
    }
    try {
      const result = await importMutation.mutateAsync({
        sessionId: currentSession.id,
        players: rows,
      });
      setToastMessage(
        `${result.added} added${result.duplicates ? ` · ${result.duplicates} duplicate or blank rows skipped` : ""}.`
      );
      setImportText("");
      toast.success("Import complete");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    }
  };

  const exportCsv = () => {
    if (!dashboard) return;
    const header = [
      "name",
      "dupr_rating",
      "self_rating",
      "manual_rating",
      "rating_source",
      "checked_in",
      "queue_position",
      "status",
      "court",
      "games_played",
    ];
    const rows = players.map(person =>
      [
        person.name,
        person.duprRating,
        person.selfRating,
        person.manualRating,
        ratingSource(person),
        person.checkedIn,
        person.queuePosition,
        person.status,
        person.currentCourt,
        person.gamesPlayed,
      ]
        .map(csvCell)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentSession?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "open-play"}-queue.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyGameSummary = async (
    game: NonNullable<typeof dashboard>["games"][number]
  ) => {
    if (game.teamAScore === null || game.teamBScore === null) {
      toast.message("This match has no confirmed score to copy.");
      return;
    }
    const teamA = game.players
      .filter(person => person.team === "A")
      .map(person => person.name)
      .join(" & ");
    const teamB = game.players
      .filter(person => person.team === "B")
      .map(person => person.name)
      .join(" & ");
    const result =
      game.resultType === "time_expired" || game.resultType === "tie"
        ? "Time-Expired Result"
        : "Normal Match";
    const summary = [
      "Open Play Match Summary",
      `Session: ${currentSession?.name ?? "Open Play"}`,
      `Date: ${currentSession ? shortDate(currentSession.sessionDate) : ""}`,
      `Venue: ${currentSession?.venue || "Venue not set"}`,
      `Court: ${game.courtNumber}`,
      `Team A: ${teamA}`,
      `Team B: ${teamB}`,
      `Final Score: ${game.teamAScore}–${game.teamBScore}`,
      `Winner: ${game.winningTeam ? `Team ${game.winningTeam}` : "Tie"}`,
      `Result: ${result}`,
      `Match ID: ${game.id}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      toast.success("Actual match summary copied");
    } catch {
      toast.error("Clipboard access is unavailable");
    }
  };

  const exportMatchHistoryCsv = () => {
    if (!dashboard || !currentSession) return;
    const gamesToExport = dashboard.games.filter(game =>
      ["finished", "cancelled", "returned"].includes(game.status)
    );
    const header = [
      "match_id",
      "session_name",
      "session_date",
      "venue",
      "court",
      "team_a",
      "team_b",
      "team_a_score",
      "team_b_score",
      "winning_team",
      "result_type",
      "result_status",
      "started_at",
      "finished_at",
      "duration_seconds",
      "match_status",
    ];
    const rows = gamesToExport.map(game =>
      [
        game.id,
        currentSession.name,
        shortDate(currentSession.sessionDate),
        currentSession.venue,
        game.courtNumber,
        game.players
          .filter(person => person.team === "A")
          .map(person => person.name)
          .join(" & "),
        game.players
          .filter(person => person.team === "B")
          .map(person => person.name)
          .join(" & "),
        game.teamAScore,
        game.teamBScore,
        game.winningTeam,
        game.resultType,
        game.resultStatus,
        game.startedAt ? new Date(game.startedAt).toISOString() : "",
        game.finishedAt ? new Date(game.finishedAt).toISOString() : "",
        game.durationSeconds,
        game.status,
      ]
        .map(csvCell)
        .join(",")
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentSession.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "open-play"}-matches.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(
      `Exported ${gamesToExport.length} session match record${gamesToExport.length === 1 ? "" : "s"}`
    );
  };

  const shareUrl = currentSession
    ? `${window.location.origin}/s/${currentSession.shareToken}`
    : "";
  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast.success("Read-only link copied");
    } catch {
      toast.error(
        "Clipboard access is unavailable. Copy the link from the address field in the share dialog."
      );
    }
  };

  if (!auth.isAuthenticated) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark">
            <span />
            <span />
            <span />
            <i />
          </div>
          <p className="eyebrow">COURTSIDE CONTROL</p>
          <h1>Open Play Queue</h1>
          <p className="auth-copy">
            A fair, simple way to keep open play moving. Sign in to manage your
            sessions and courts.
          </p>
          <button
            className="button button-primary button-wide"
            onClick={() => startLogin()}
          >
            Sign in with Manus
          </button>
          <p className="quiet-note">
            Sign-in is free through Manus; use Manus account support to recover
            access. Organizer actions are protected, while players can view
            session boards through a read-only link. There is no player fee, but
            hosting or database charges may apply to the project owner.
          </p>
        </section>
      </main>
    );
  }

  if (
    auth.loading ||
    currentQuery.isLoading ||
    (selectedSessionId !== undefined &&
      selectedSessionId !== currentQuery.data?.session.id &&
      selectedQuery.isLoading)
  ) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" size={25} /> Loading your session…
      </main>
    );
  }
  if (currentQuery.error)
    return (
      <main className="loading-screen">
        <section className="error-card">
          <strong>Couldn’t load sessions</strong>
          <p>{currentQuery.error.message}</p>
          <button
            className="button button-secondary"
            onClick={() => currentQuery.refetch()}
          >
            Try again
          </button>
        </section>
      </main>
    );
  if (!dashboard || !currentSession)
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" size={25} /> Setting up your open-play
        session…
      </main>
    );

  const estimatedServerNow =
    clockAnchor.server + (performance.now() - clockAnchor.client);
  const timerRemaining = currentSession.endsAt
    ? new Date(currentSession.endsAt).getTime() - estimatedServerNow
    : null;
  const scheduledStartRemaining = currentSession.scheduledStartAt
    ? new Date(
        currentSession.scheduledStartAt ?? currentSession.sessionDate
      ).getTime() - estimatedServerNow
    : null;
  const sessionIsEditable =
    currentSession.status === "scheduled" || currentSession.status === "live";
  const sessionIsPlayable =
    currentSession.status === "live" &&
    (timerRemaining === null || timerRemaining > 0);
  const timerMessage =
    currentSession.status === "scheduled"
      ? `Scheduled · ${currentSession.scheduledStartAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(currentSession.scheduledStartAt ?? currentSession.sessionDate)) : "start time not set"}`
      : currentSession.status === "live"
        ? timerRemaining === null
          ? "Session timer not started"
          : timerRemaining > 0
            ? `Time remaining · ${countdownLabel(timerRemaining)}`
            : "Time expired · settle active matches"
        : currentSession.status === "ending"
          ? "Ending — Matches Need Settlement"
          : currentSession.status === "finished"
            ? "Session finished · history is retained"
            : "Session cancelled";

  const queue = [...players].sort(
    (a, b) => a.queuePosition - b.queuePosition || a.id - b.id
  );
  const configuredCourts = Array.from(
    { length: currentSession.courtCount },
    (_, index) => activeGames.find(game => game.courtNumber === index + 1)
  );
  const busy =
    addMutation.isPending ||
    importMutation.isPending ||
    checkInMutation.isPending ||
    ratingMutation.isPending ||
    queueMutation.isPending ||
    moveMutation.isPending ||
    resetMutation.isPending ||
    settingsMutation.isPending ||
    createSessionMutation.isPending ||
    startGameMutation.isPending ||
    finishGameMutation.isPending ||
    returnGameMutation.isPending ||
    startSessionMutation.isPending ||
    updateScheduleMutation.isPending ||
    extendSessionMutation.isPending ||
    adjustEndMutation.isPending ||
    finishSessionMutation.isPending ||
    finalizeSessionMutation.isPending ||
    cancelSessionMutation.isPending ||
    cancelGameMutation.isPending ||
    correctGameMutation.isPending;
  const defaultTierConfig = (() => {
    try {
      return JSON.parse(currentSession.tierConfig) as TierConfig;
    } catch {
      return DEFAULT_TIER_CONFIG;
    }
  })();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <i />
          </div>
          <div>
            <p className="eyebrow">COURTSIDE CONTROL</p>
            <div className="brand-title">Open Play Queue</div>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="session-picker-label" htmlFor="session-picker">
            Session
          </label>
          <div className="select-wrap">
            <select
              id="session-picker"
              value={currentSession.id}
              onChange={event =>
                setSelectedSessionId(Number(event.target.value))
              }
            >
              {dashboard.sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <button
            className="button button-quiet organizer-notification-toggle"
            aria-label="Notifications"
            title="Notifications"
            aria-expanded={notificationsOpen}
            aria-controls="organizer-notifications"
            onClick={() => setNotificationsOpen(open => !open)}
          >
            <Bell size={15} />
            {Boolean(notificationsQuery.data?.some(item => !item.readAt)) && (
              <span className="notification-count">
                {notificationsQuery.data?.filter(item => !item.readAt).length}
              </span>
            )}
          </button>
          <Link
            className="button button-quiet player-home-link"
            href="/player"
            aria-label="Player home"
            title="Player home"
          >
            <Trophy size={14} /> Player home
          </Link>
          <button
            className="button button-quiet user-button"
            aria-label="Sign out"
            onClick={() => void auth.logout()}
            title="Sign out"
          >
            <span className="user-dot">
              {safeName(auth.user?.name || "Organizer")}
            </span>
            <span className="user-name">{auth.user?.name || "Organizer"}</span>
            <LogOut size={15} />
          </button>
        </div>
        {notificationsOpen && (
          <aside
            id="organizer-notifications"
            className="organizer-notifications"
            aria-label="Organizer notifications"
          >
            <div className="organizer-notifications-heading">
              <div>
                <strong>Recent notifications</strong>
                <small>Private to your organizer account</small>
              </div>
              {browserPermission !== "granted" &&
                browserPermission !== "unsupported" && (
                  <button
                    className="button button-secondary button-small"
                    onClick={async () => {
                      const permission = await Notification.requestPermission();
                      setBrowserPermission(permission);
                      if (permission === "granted")
                        toast.success(
                          "Browser alerts enabled while this dashboard is open"
                        );
                    }}
                  >
                    Enable browser alerts
                  </button>
                )}
            </div>
            {notificationsQuery.data?.length ? (
              notificationsQuery.data.slice(0, 8).map(notice => (
                <article
                  className={`organizer-notice ${notice.readAt ? "organizer-notice-read" : ""}`}
                  key={notice.id}
                >
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
                      title="Mark read"
                      aria-label="Mark notification read"
                      onClick={() =>
                        void markNotificationReadMutation.mutateAsync({
                          notificationId: notice.id,
                        })
                      }
                    >
                      <Check size={15} />
                    </button>
                  )}
                </article>
              ))
            ) : (
              <p className="history-empty">No notifications yet.</p>
            )}
            <p className="field-help">
              <Bell size={13} /> Browser alerts appear while this dashboard is
              open; persistent in-app notices remain in your account inbox.
            </p>
          </aside>
        )}
      </header>

      <section className="session-heading">
        <div className="session-meta">
          <span className={`live-dot session-dot-${currentSession.status}`} />{" "}
          {currentSession.status.toUpperCase()} SESSION{" "}
          <span className="session-separator">/</span>{" "}
          <span className="integration-pill">
            Reclub <b>Not connected</b>
          </span>
          <span className="integration-pill">
            DUPR <b>Not connected</b>
          </span>
        </div>
        <div className="session-title-row">
          <div>
            <h1>{currentSession.name}</h1>
            <div className="session-details">
              <span>
                <CalendarDays size={15} />
                {shortDate(currentSession.sessionDate)}
              </span>
              <span>
                <MapPin size={15} />
                {currentSession.venue || "Venue not set"}
              </span>
            </div>
          </div>
          <div className="session-actions">
            {currentSession.status === "scheduled" && (
              <button
                className="button button-secondary"
                onClick={() => {
                  setSessionStartTime(
                    localDateTimeValue(
                      new Date(
                        currentSession.scheduledStartAt ??
                          currentSession.sessionDate
                      )
                    )
                  );
                  setSessionDuration(currentSession.durationMinutes);
                  setSessionNotes(currentSession.sessionNotes);
                  setModal("schedule");
                }}
              >
                <CalendarDays size={15} /> Schedule
              </button>
            )}
            <button
              className="button button-secondary"
              onClick={() => setModal("new-session")}
            >
              <Plus size={16} /> New session
            </button>
            <button
              className="button button-secondary"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={16} /> Settings
            </button>
          </div>
        </div>
        <div
          className={`session-clock-card ${currentSession.status === "ending" || (timerRemaining !== null && timerRemaining > 0 && timerRemaining <= 15 * 60_000) ? "session-clock-warning" : currentSession.status === "finished" || currentSession.status === "cancelled" ? "session-clock-closed" : ""}`}
        >
          <div className="session-clock-face">
            <Clock3 size={18} />
            <div>
              <small>
                SESSION CLOCK ·{" "}
                {Math.floor(currentSession.durationMinutes / 60)}H{" "}
                {currentSession.durationMinutes % 60}M
              </small>
              <strong>{timerMessage}</strong>
              <span className="clock-schedule-meta">
                {currentSession.startedAt
                  ? `Started ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(currentSession.startedAt))}`
                  : `Scheduled ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(currentSession.scheduledStartAt ?? currentSession.sessionDate))}`}
                {currentSession.endsAt
                  ? ` · Ends ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(currentSession.endsAt))}`
                  : ""}
              </span>
              {currentSession.status === "live" &&
                timerRemaining !== null &&
                timerRemaining > 0 &&
                timerRemaining <= 15 * 60_000 && (
                  <span>
                    15-minute warning · queue remains playable until zero
                  </span>
                )}
            </div>
          </div>
          <div className="session-clock-actions">
            {(currentSession.status === "scheduled" ||
              (currentSession.status === "live" && !currentSession.endsAt)) && (
              <button
                className="button button-primary button-small"
                disabled={busy}
                onClick={() =>
                  void startSessionMutation
                    .mutateAsync({ sessionId: currentSession.id })
                    .then(() => toast.success("Session timer started"))
                    .catch(error => toast.error(error.message))
                }
              >
                Start session
              </button>
            )}
            {((currentSession.status === "live" &&
              Boolean(currentSession.endsAt)) ||
              currentSession.status === "ending") && (
              <>
                <button
                  className="button button-secondary button-small"
                  disabled={busy}
                  onClick={() =>
                    void extendSessionMutation
                      .mutateAsync({
                        sessionId: currentSession.id,
                        extraMinutes: 30,
                      })
                      .then(() =>
                        toast.success("Session extended by 30 minutes")
                      )
                      .catch(error => toast.error(error.message))
                  }
                >
                  +30 min
                </button>
                <button
                  className="button button-secondary button-small"
                  disabled={busy}
                  onClick={() => {
                    setAdjustEndValue(
                      localDateTimeValue(
                        new Date(currentSession.endsAt ?? Date.now())
                      )
                    );
                    setModal("adjust-end");
                  }}
                >
                  Adjust end
                </button>
              </>
            )}
            {(currentSession.status === "live" ||
              currentSession.status === "scheduled") && (
              <button
                className="button button-quiet button-small"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Stop creating new matches and let any active matches settle before closing this session?"
                    )
                  )
                    void finishSessionMutation
                      .mutateAsync({ sessionId: currentSession.id })
                      .then(() =>
                        toast.success(
                          "Session is ending; settle active games before final closure"
                        )
                      )
                      .catch(error => toast.error(error.message));
                }}
              >
                Finish session
              </button>
            )}
            {currentSession.status === "ending" && activeGames.length === 0 && (
              <button
                className="button button-primary button-small"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Finalize this session? It will become read-only while its match history remains available."
                    )
                  )
                    void finalizeSessionMutation
                      .mutateAsync({ sessionId: currentSession.id })
                      .then(() => toast.success("Session finalized"))
                      .catch(error => toast.error(error.message));
                }}
              >
                Finalize session
              </button>
            )}
            {!(["finished", "cancelled"] as string[]).includes(
              currentSession.status
            ) && (
              <button
                className="button button-quiet button-small cancel-session-control"
                disabled={busy}
                onClick={() => {
                  setCancelReason("");
                  setModal("cancel-session");
                }}
              >
                Cancel session
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="stats-strip" aria-label="Session summary">
        <Stat
          label="Participants"
          value={stats.total}
          icon={<Users size={17} />}
          detail="registered"
        />
        <Stat
          label="Checked in"
          value={stats.checkedIn}
          detail="ready to play"
          accent
        />
        <Stat label="On court" value={stats.playing} detail="in active games" />
        <Stat label="Waiting" value={stats.waiting} detail="in the queue" />
        <Stat
          label="Unrated"
          value={stats.unrated}
          detail="rotation still works"
          muted
        />
      </section>

      <section className="quick-actions">
        <div className="action-intro">
          <span className="action-kicker">NEXT UP</span>
          <strong>Get the courts moving</strong>
          <small>Generate a fair lineup from checked-in players.</small>
        </div>
        <div className="action-buttons">
          <button
            className="button button-primary generate-button"
            disabled={
              busy ||
              !sessionIsPlayable ||
              stats.checkedIn < currentSession.playersPerGame
            }
            onClick={async () => {
              try {
                await queueMutation.mutateAsync({
                  sessionId: currentSession.id,
                  strategy: settingsDraft.strategy,
                });
                toast.success("Queue and court assignments updated");
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not generate queue"
                );
              }
            }}
          >
            <Sparkles size={17} /> Generate queue
          </button>
          <button
            className="button button-secondary"
            disabled={!sessionIsEditable || busy}
            onClick={() => setModal("import")}
          >
            <Upload size={16} /> Import
          </button>
          <button
            className="button button-secondary"
            disabled={!sessionIsEditable || busy}
            onClick={() => openAdd()}
          >
            <Plus size={16} /> Add player
          </button>
          <button className="button button-secondary" onClick={exportCsv}>
            <Download size={16} /> Export CSV
          </button>
          <button
            className="button button-secondary"
            onClick={() => setModal("invite")}
          >
            <Share2 size={16} /> Invite players
          </button>
        </div>
        <p className="queue-hint">
          {stats.checkedIn < currentSession.playersPerGame
            ? `Check in ${currentSession.playersPerGame - stats.checkedIn} more to fill a game.`
            : `${stats.waiting} waiting · ${activeGames.length} court${activeGames.length === 1 ? "" : "s"} assigned`}
        </p>
      </section>

      <div className="workspace-grid">
        <section className="panel queue-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PLAYER LINEUP</p>
              <h2>
                Queue <span className="count-chip">{players.length}</span>
              </h2>
              <p className="panel-subtitle">
                Check players in as they arrive. Move the waiting order anytime.
              </p>
            </div>
            <button
              className="button button-small button-secondary"
              disabled={!sessionIsEditable || busy}
              onClick={() => setModal("settings")}
            >
              <Settings2 size={15} /> Rules
            </button>
          </div>
          <div className="queue-mode-bar">
            <span>Current strategy</span>
            <strong>
              {currentSession.strategy === "skill"
                ? "Skill-based"
                : "Fair rotation"}
            </strong>
            <span className="mode-divider" />{" "}
            <span>
              {currentSession.groupMode === "balanced"
                ? "Balanced teams"
                : "Similar skill"}
            </span>
            <button
              className="link-button"
              disabled={!sessionIsEditable || busy}
              onClick={() => setModal("settings")}
            >
              Change
            </button>
          </div>
          <div className="player-list">
            {queue.length === 0 ? (
              <EmptyState
                title="No players yet"
                copy="Add players manually or import a Reclub attendee CSV to get started."
              />
            ) : (
              queue.map((person, index) => {
                const source = ratingSource(person);
                const tier = playerTier(person, defaultTierConfig);
                const game = person.currentGameId
                  ? gameById.get(person.currentGameId)
                  : undefined;
                const waited =
                  person.checkedIn && person.currentGameId === null
                    ? waitLabel(person.waitingSince)
                    : null;
                const statusLabel = game
                  ? `${game.status === "playing" ? "Playing" : "On deck"} · Court ${game.courtNumber}`
                  : person.checkedIn
                    ? "Waiting"
                    : "Not checked in";
                const canMove =
                  person.checkedIn &&
                  person.currentGameId === null &&
                  person.status !== "playing";
                return (
                  <article
                    className={`player-row ${person.status === "playing" ? "player-row-playing" : ""}`}
                    key={person.id}
                  >
                    <div className="queue-position">{person.queuePosition}</div>
                    <div
                      className={`avatar avatar-${source.toLowerCase().replace(/[^a-z]+/g, "")}`}
                    >
                      {safeName(person.name)}
                    </div>
                    <div className="player-main">
                      <div className="player-name-line">
                        <strong>{person.name}</strong>
                        {person.status === "playing" && (
                          <span className="status-dot-label">
                            <span />
                            On court
                          </span>
                        )}
                      </div>
                      <div className="player-rating-line">
                        <span
                          className={`rating-source rating-${source.toLowerCase().replace(/[^a-z]+/g, "")}`}
                        >
                          {source}
                        </span>
                        {source === "DUPR" && <span>{person.duprRating}</span>}
                        {source === "Self-rating" && (
                          <span>{person.selfRating}</span>
                        )}
                        {source === "Manual" && (
                          <span>{person.manualRating}</span>
                        )}
                        {source === "Unrated" && <span>NR</span>}
                        {tier !== null && (
                          <span className="tier-pill">
                            {RATING_TIERS[tier]}
                          </span>
                        )}
                        {person.registrationStatus !== "registered" && (
                          <span className="registration-pill">
                            {person.registrationStatus}
                          </span>
                        )}
                        {waited && (
                          <span
                            className="wait-duration"
                            title="Time currently waiting"
                          >
                            Wait {waited}
                          </span>
                        )}
                        <span className="games-count">
                          {person.gamesPlayed}{" "}
                          {person.gamesPlayed === 1 ? "game" : "games"}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`player-status ${person.checkedIn ? (game?.status === "playing" ? "status-playing" : game ? "status-assigned" : "status-waiting") : "status-notchecked"}`}
                    >
                      {person.checkedIn && !game && <i />}
                      {statusLabel}
                    </span>
                    <div className="player-actions">
                      <button
                        className={`checkin-button ${person.checkedIn ? "is-checked" : ""}`}
                        disabled={
                          busy ||
                          !sessionIsEditable ||
                          person.currentGameId !== null
                        }
                        onClick={() =>
                          void checkInMutation
                            .mutateAsync({
                              sessionId: currentSession.id,
                              participantId: person.id,
                              checkedIn: !person.checkedIn,
                            })
                            .catch(error => toast.error(error.message))
                        }
                        aria-label={
                          person.checkedIn
                            ? `Check out ${person.name}`
                            : `Check in ${person.name}`
                        }
                        title={
                          person.currentGameId !== null
                            ? "Return this player from court first"
                            : person.checkedIn
                              ? "Check out"
                              : "Check in"
                        }
                      >
                        {person.checkedIn ? <Check size={15} /> : <span />}
                      </button>
                      <button
                        className="icon-button reorder-button"
                        disabled={
                          !sessionIsEditable || !canMove || index === 0 || busy
                        }
                        onClick={() =>
                          void moveMutation
                            .mutateAsync({
                              sessionId: currentSession.id,
                              participantId: person.id,
                              direction: -1,
                            })
                            .catch(error => toast.error(error.message))
                        }
                        aria-label={`Move ${person.name} up`}
                        title="Move up"
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        className="icon-button reorder-button"
                        disabled={
                          !sessionIsEditable ||
                          !canMove ||
                          index === queue.length - 1 ||
                          busy
                        }
                        onClick={() =>
                          void moveMutation
                            .mutateAsync({
                              sessionId: currentSession.id,
                              participantId: person.id,
                              direction: 1,
                            })
                            .catch(error => toast.error(error.message))
                        }
                        aria-label={`Move ${person.name} down`}
                        title="Move down"
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        className="icon-button edit-button"
                        disabled={!sessionIsEditable || busy}
                        onClick={() => openAdd(person)}
                        aria-label={`Edit ${person.name} ratings`}
                        title="Edit rating"
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <div className="queue-footer">
            <span>
              <span className="legend-dot legend-green" /> Checked in
            </span>
            <span>
              <span className="legend-dot legend-gray" /> Not checked in
            </span>
            <span>Games played and current wait guide Fair Rotation</span>
          </div>
        </section>

        <section className="panel courts-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LIVE COURT BOARD</p>
              <h2>
                Courts{" "}
                <span className="count-chip">{currentSession.courtCount}</span>
              </h2>
              <p className="panel-subtitle">
                {currentSession.playersPerGame} players per game · doubles by
                default
              </p>
            </div>
            <button
              className="link-button"
              onClick={() => setModal("settings")}
            >
              Configure
            </button>
          </div>
          <div className="court-list">
            {configuredCourts.map((game, index) => (
              <article
                className={`court-card ${game?.status === "playing" ? "court-active" : ""}`}
                key={index}
              >
                <div className="court-heading">
                  <div className="court-name">
                    <span className="court-mark">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <strong>Court {index + 1}</strong>
                  </div>
                  {game ? (
                    <span
                      className={`court-state ${game.status === "playing" ? "court-state-playing" : "court-state-ready"}`}
                    >
                      {game.status === "playing" ? "In play" : "Ready"}
                    </span>
                  ) : (
                    <span className="court-state court-state-empty">Open</span>
                  )}
                </div>
                {game ? (
                  <div className="court-players">
                    {game.players.map(person => (
                      <div className="court-player" key={person.participantId}>
                        <span
                          className={`team-mark team-${person.team.toLowerCase()}`}
                        >
                          {person.team}
                        </span>
                        <span>{person.name}</span>
                        <small>{person.gamesPlayed}g</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="court-empty">
                    <span className="empty-court-lines">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      Waiting for a full group of{" "}
                      {currentSession.playersPerGame}
                    </span>
                  </div>
                )}
                {game && (
                  <div className="court-actions">
                    {game.status === "ready" ? (
                      <button
                        className="button button-primary button-small"
                        disabled={busy || !sessionIsPlayable}
                        onClick={() =>
                          void startGameMutation
                            .mutateAsync({
                              sessionId: currentSession.id,
                              gameId: game.id,
                            })
                            .then(() =>
                              toast.success(`Court ${index + 1} started`)
                            )
                            .catch(error => toast.error(error.message))
                        }
                      >
                        Start game
                      </button>
                    ) : (
                      <button
                        className="button button-primary button-small"
                        disabled={busy}
                        onClick={() => {
                          setScoreTarget(game.id);
                          setScoreA("11");
                          setScoreB("0");
                          setScoreReason("");
                          setModal("score");
                        }}
                      >
                        Enter score & finish
                      </button>
                    )}
                    {game.status === "ready" ? (
                      <button
                        className="button button-small button-quiet"
                        disabled={busy || !sessionIsEditable}
                        onClick={() =>
                          void returnGameMutation
                            .mutateAsync({
                              sessionId: currentSession.id,
                              gameId: game.id,
                            })
                            .then(() =>
                              toast.success("Players returned to the queue")
                            )
                            .catch(error => toast.error(error.message))
                        }
                      >
                        Return players
                      </button>
                    ) : (
                      <button
                        className="button button-small button-quiet"
                        disabled={busy}
                        onClick={() => {
                          setScoreTarget(game.id);
                          setCancelReason("");
                          setModal("cancel-match");
                        }}
                      >
                        Cancel match
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="court-board-footer">
            <span>
              {activeGames.filter(game => game.status === "playing").length}{" "}
              active
            </span>
            <span>
              {activeGames.filter(game => game.status === "ready").length} ready
            </span>
            <button
              className="link-button"
              disabled={busy || !sessionIsEditable}
              onClick={() => {
                if (
                  window.confirm(
                    "Reset the waiting queue and clear ready courts? Finished game history and player records will be kept."
                  )
                )
                  void resetMutation
                    .mutateAsync({ sessionId: currentSession.id })
                    .then(() => toast.success("Queue reset; game history kept"))
                    .catch(error => toast.error(error.message));
              }}
            >
              Reset queue
            </button>
          </div>
          <div className="match-report-actions">
            <span>Session report</span>
            <button
              className="button button-secondary button-small"
              onClick={exportMatchHistoryCsv}
            >
              <Download size={13} /> Export matches CSV
            </button>
            <button
              className="button button-secondary button-small"
              onClick={() => window.print()}
            >
              Print / save report
            </button>
          </div>
          <details className="history-details">
            <summary>
              Recent game history{" "}
              <span>
                {
                  dashboard.games.filter(game =>
                    ["finished", "cancelled", "returned"].includes(game.status)
                  ).length
                }
              </span>
            </summary>
            <div className="history-list">
              {dashboard.games
                .filter(game =>
                  ["finished", "cancelled", "returned"].includes(game.status)
                )
                .map(game => (
                  <div className="history-row" key={game.id}>
                    <span>Court {game.courtNumber}</span>
                    <strong>
                      {game.players.map(person => person.name).join(" · ")}
                    </strong>
                    <span className="history-score">
                      {game.teamAScore !== null && game.teamBScore !== null
                        ? `${game.teamAScore}–${game.teamBScore}${game.winningTeam ? ` · ${game.winningTeam} wins` : " · tie"}`
                        : "No score recorded"}
                      {game.resultStatus === "corrected" ? " · corrected" : ""}
                    </span>
                    <small>
                      {game.finishedAt
                        ? new Intl.DateTimeFormat(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(game.finishedAt))
                        : "Finished"}
                    </small>
                    <span className="history-status-label">
                      {game.status === "cancelled"
                        ? "Cancelled · no result"
                        : game.status === "returned"
                          ? "Returned to queue"
                          : game.resultType === "time_expired" ||
                              game.resultType === "tie"
                            ? "Time-expired result"
                            : "Normal match"}
                    </span>
                    {game.teamAScore !== null &&
                      game.teamBScore !== null &&
                      game.resultStatus !== "cancelled" && (
                        <div className="history-actions">
                          <button
                            className="link-button"
                            onClick={() => void copyGameSummary(game)}
                          >
                            Copy summary
                          </button>
                          {currentSession.status !== "finished" &&
                            currentSession.status !== "cancelled" && (
                              <button
                                className="link-button history-correct-button"
                                onClick={() => {
                                  setScoreTarget(game.id);
                                  setScoreA(String(game.teamAScore));
                                  setScoreB(String(game.teamBScore));
                                  setScoreReason("");
                                  setModal("correct-score");
                                }}
                              >
                                Correct score
                              </button>
                            )}
                        </div>
                      )}
                  </div>
                ))}
              {dashboard.games.every(
                game =>
                  !["finished", "cancelled", "returned"].includes(game.status)
              ) && (
                <p className="history-empty">
                  Completed match records will appear here.
                </p>
              )}
            </div>
          </details>
          <details
            className="history-details"
            onToggle={event => setAuditOpen(event.currentTarget.open)}
          >
            <summary>
              Session audit trail <span>{auditQuery.data?.length ?? 0}</span>
            </summary>
            <div className="audit-list">
              {auditQuery.isLoading ? (
                <p className="history-empty">Loading audit…</p>
              ) : auditQuery.error ? (
                <p className="history-empty">{auditQuery.error.message}</p>
              ) : auditQuery.data?.length ? (
                auditQuery.data
                  .slice()
                  .reverse()
                  .map(event => (
                    <article className="audit-row" key={event.id}>
                      <div>
                        <strong>{event.kind.replace(/_/g, " ")}</strong>
                        <small>
                          {event.actorName} ·{" "}
                          {new Intl.DateTimeFormat(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(event.createdAt))}
                        </small>
                      </div>
                      <code>{event.details}</code>
                    </article>
                  ))
              ) : (
                <p className="history-empty">
                  Session actions and results will be recorded here.
                </p>
              )}
            </div>
          </details>
        </section>
      </div>
      <section
        className="printable-report"
        aria-label="Printable session match report"
      >
        <h1>Open Play Match Report</h1>
        <p>
          <strong>Session:</strong> {currentSession.name} ·{" "}
          <strong>Date:</strong> {shortDate(currentSession.sessionDate)} ·{" "}
          <strong>Venue:</strong> {currentSession.venue || "Venue not set"}
        </p>
        <p>
          <strong>Schedule:</strong>{" "}
          {currentSession.startedAt
            ? new Date(currentSession.startedAt).toLocaleString()
            : new Date(
                currentSession.scheduledStartAt ?? currentSession.sessionDate
              ).toLocaleString()}{" "}
          · <strong>Status:</strong> {currentSession.status}
        </p>
        <table>
          <thead>
            <tr>
              <th>Match</th>
              <th>Court</th>
              <th>Team A</th>
              <th>Team B</th>
              <th>Score</th>
              <th>Outcome</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Result state</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.games
              .filter(game =>
                ["finished", "cancelled", "returned"].includes(game.status)
              )
              .map(game => (
                <tr key={game.id}>
                  <td>#{game.id}</td>
                  <td>{game.courtNumber}</td>
                  <td>
                    {game.players
                      .filter(person => person.team === "A")
                      .map(person => person.name)
                      .join(" & ") || "—"}
                  </td>
                  <td>
                    {game.players
                      .filter(person => person.team === "B")
                      .map(person => person.name)
                      .join(" & ") || "—"}
                  </td>
                  <td>
                    {game.teamAScore !== null && game.teamBScore !== null
                      ? `${game.teamAScore}–${game.teamBScore}`
                      : "—"}
                  </td>
                  <td>
                    {game.winningTeam
                      ? `Team ${game.winningTeam} wins`
                      : game.teamAScore !== null && game.teamBScore !== null
                        ? "Tie"
                        : "No confirmed result"}
                  </td>
                  <td>
                    {game.startedAt
                      ? new Date(game.startedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    {game.finishedAt
                      ? new Date(game.finishedAt).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    {game.resultStatus} · {game.status}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <footer className="page-footer">
        <span>
          <span className="brand-mark brand-mark-small">
            <span />
            <span />
            <span />
            <i />
          </span>
          Open Play Queue
        </span>
        <span>
          Read-only player view refreshes automatically{" "}
          <button className="inline-link" onClick={() => void copyShare()}>
            <ExternalLink size={13} /> Copy share link
          </button>
        </span>
        <span className="cost-note">
          No player fee; hosting and database charges may apply to the project
          owner.
        </span>
      </footer>

      {modal === "import" && (
        <Modal
          title="Import players"
          description="Add attendees from a file, a pasted list, or a manual entry. Duplicate names are skipped."
          onClose={closeModal}
        >
          <div className="integration-notice">
            <strong>Reclub import isn’t connected</strong>
            <p>
              {reclubUrl.trim()
                ? `No authorized integration is available to retrieve ${reclubUrl.trim()}. No data was imported.`
                : "Paste a Reclub session URL to check its status. This build does not use private APIs or scrape session pages."}{" "}
              Use a CSV export from Reclub, or paste the player names below.
            </p>
          </div>
          <label className="field-label" htmlFor="reclub-url">
            Reclub session URL <span>optional</span>
          </label>
          <div className="input-with-button">
            <input
              id="reclub-url"
              type="url"
              value={reclubUrl}
              onChange={event => setReclubUrl(event.target.value)}
              placeholder="https://reclub.co/..."
            />
            <button
              className="button button-secondary"
              type="button"
              onClick={() =>
                setToastMessage(
                  reclubUrl.trim()
                    ? "Not imported: no authorized Reclub integration is connected. Use CSV or paste a list."
                    : "Paste a session URL to check import availability."
                )
              }
            >
              Check status
            </button>
          </div>
          {toastMessage && (
            <p className="import-feedback" role="status">
              {toastMessage}
            </p>
          )}
          <div className="tab-row">
            <button
              className={importMode === "csv" ? "tab-active" : ""}
              onClick={() => setImportMode("csv")}
            >
              CSV list
            </button>
            <button
              className={importMode === "paste" ? "tab-active" : ""}
              onClick={() => setImportMode("paste")}
            >
              Paste names
            </button>
          </div>
          <div className="upload-row">
            <label className="button button-secondary file-label">
              <Upload size={15} /> Upload CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={async event => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  if (!file) return;
                  input.value = "";
                  try {
                    const text = await file.text();
                    setImportMode("csv");
                    setImportText(text);
                    setToastMessage(
                      `${file.name} loaded — review the preview, then import.`
                    );
                  } catch {
                    toast.error("Could not read that file.");
                  }
                }}
              />
            </label>
            <button
              className="link-button"
              onClick={() => {
                const blob = new Blob(
                  [
                    "name,dupr_rating,self_rating,manual_rating,registration_status,checked_in\n",
                  ],
                  { type: "text/csv" }
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "open-play-participants-template.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download blank CSV template
            </button>
          </div>
          <textarea
            className="import-textarea"
            value={importText}
            onChange={event => setImportText(event.target.value)}
            placeholder={
              importMode === "csv"
                ? "Paste CSV here. Recommended columns: name, dupr_rating, self_rating, manual_rating, registration_status, checked_in"
                : "Paste one player name per line (commas and semicolons also work)."
            }
            rows={7}
          />
          <p className="field-help">
            DUPR and self-ratings keep their source. Ratings are never guessed.
          </p>
          <div className="modal-actions">
            <button className="button button-quiet" onClick={closeModal}>
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={!importText.trim() || importMutation.isPending}
              onClick={() =>
                void importPlayers(
                  importMode === "csv"
                    ? parseParticipantText(importText)
                    : parsePastedNames(importText)
                )
              }
            >
              {importMutation.isPending ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Upload size={15} />
              )}{" "}
              Import participants
            </button>
          </div>
        </Modal>
      )}

      {modal === "add" && (
        <Modal
          title={
            editingPlayer ? `Ratings · ${editingPlayer.name}` : "Add a player"
          }
          description={
            editingPlayer
              ? "Keep original values and rating source; DUPR takes display priority when both are present."
              : "Add a player now, then check them in when they arrive."
          }
          onClose={closeModal}
        >
          <form className="form-stack" onSubmit={submitPlayer}>
            {!editingPlayer && (
              <label className="field-label">
                Player name
                <input
                  required
                  maxLength={160}
                  value={newName}
                  onChange={event => setNewName(event.target.value)}
                  placeholder="Player name"
                  autoFocus
                />
              </label>
            )}
            <label className="field-label">
              DUPR rating <span>if available</span>
              <input
                inputMode="decimal"
                value={newDupr}
                onChange={event => setNewDupr(event.target.value)}
                placeholder="e.g. 3.75"
              />
            </label>
            <label className="field-label">
              Self-rating <span>if no DUPR rating</span>
              <select
                value={newSelf}
                onChange={event => setNewSelf(event.target.value)}
              >
                <option value="">No self-rating</option>
                {[
                  "Beginner",
                  "Recreational",
                  "Intermediate",
                  "Advanced",
                  "Competitive",
                ].map(tier => (
                  <option key={tier}>{tier}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Manual rating / tier <span>optional</span>
              <select
                value={newManual}
                onChange={event => setNewManual(event.target.value)}
              >
                <option value="">None</option>
                {[
                  "Beginner",
                  "Recreational",
                  "Intermediate",
                  "Advanced",
                  "Competitive",
                ].map(tier => (
                  <option key={tier}>{tier}</option>
                ))}
              </select>
            </label>
            <p className="field-help">
              Rating source is preserved. Skill-based groups use your session’s
              separate, editable DUPR and self-rating cutoffs.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={addMutation.isPending || ratingMutation.isPending}
              >
                {editingPlayer ? "Save rating" : "Add player"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "settings" && (
        <Modal
          title="Session rules"
          description="Make the grouping fit your club. These settings apply the next time you generate a queue."
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              if (!currentSession) return;
              try {
                await settingsMutation.mutateAsync({
                  sessionId: currentSession.id,
                  ...settingsDraft,
                });
                toast.success("Session rules saved");
                closeModal();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not save rules"
                );
              }
            }}
          >
            <div className="form-row">
              <label className="field-label">
                Courts
                <select
                  value={settingsDraft.courtCount}
                  onChange={event =>
                    setSettingsDraft({
                      ...settingsDraft,
                      courtCount: Number(event.target.value),
                    })
                  }
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "court" : "courts"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Players per game
                <select
                  value={settingsDraft.playersPerGame}
                  onChange={event =>
                    setSettingsDraft({
                      ...settingsDraft,
                      playersPerGame: Number(event.target.value),
                    })
                  }
                >
                  {[2, 3, 4, 5, 6, 7, 8].map(n => (
                    <option key={n} value={n}>
                      {n} players
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field-label">
              Queue strategy
              <select
                value={settingsDraft.strategy}
                onChange={event =>
                  setSettingsDraft({
                    ...settingsDraft,
                    strategy: event.target.value as "fair" | "skill",
                  })
                }
              >
                <option value="fair">Fair Rotation · fewer repeat waits</option>
                <option value="skill">
                  Skill-Based · similar levels together
                </option>
              </select>
            </label>
            <label className="field-label">
              Court grouping
              <select
                value={settingsDraft.groupMode}
                onChange={event =>
                  setSettingsDraft({
                    ...settingsDraft,
                    groupMode: event.target.value as "similar" | "balanced",
                  })
                }
              >
                <option value="similar">Similar skill</option>
                <option value="balanced">Balanced teams</option>
              </select>
            </label>
            <div className="tier-config-card">
              <strong>Skill-tier cutoffs</strong>
              <p>
                Club-adjustable grouping bands, not official DUPR ratings. Four
                increasing values map into {RATING_TIERS.join(" → ")}.
              </p>
              <label className="field-label">
                DUPR cutoffs
                <input
                  value={settingsDraft.tierConfig.duprThresholds.join(", ")}
                  onChange={event =>
                    setSettingsDraft({
                      ...settingsDraft,
                      tierConfig: {
                        ...settingsDraft.tierConfig,
                        duprThresholds: event.target.value
                          .split(",")
                          .map(part => Number(part.trim())),
                      },
                    })
                  }
                />
              </label>
              <label className="field-label">
                Self-rating numeric cutoffs
                <input
                  value={settingsDraft.tierConfig.selfNumericThresholds.join(
                    ", "
                  )}
                  onChange={event =>
                    setSettingsDraft({
                      ...settingsDraft,
                      tierConfig: {
                        ...settingsDraft.tierConfig,
                        selfNumericThresholds: event.target.value
                          .split(",")
                          .map(part => Number(part.trim())),
                      },
                    })
                  }
                />
              </label>
              <p className="field-help">
                Text self-ratings (Beginner through Competitive) use their own
                label mapping; no raw cross-scale comparison.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={settingsMutation.isPending}
              >
                Save rules
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "new-session" && (
        <Modal
          title="Create a session"
          description="Your existing open-play sessions stay available from the session selector."
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              try {
                await createSessionMutation.mutateAsync({
                  name: sessionName,
                  sessionDate: new Date(sessionStartTime).toISOString(),
                  scheduledStartAt: new Date(sessionStartTime).toISOString(),
                  durationMinutes: sessionDuration,
                  courtCount: sessionCourtCount,
                  playersPerGame: sessionPlayersPerGame,
                  strategy: sessionStrategy,
                  groupMode: sessionGroupMode,
                  venue: sessionVenue,
                  notes: sessionNotes,
                });
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not create session"
                );
              }
            }}
          >
            <label className="field-label">
              Session name
              <input
                required
                value={sessionName}
                onChange={event => setSessionName(event.target.value)}
                maxLength={160}
              />
            </label>
            <label className="field-label">
              Scheduled date and time
              <input
                required
                type="datetime-local"
                value={sessionStartTime}
                onChange={event => setSessionStartTime(event.target.value)}
              />
            </label>
            <div className="form-row">
              <label className="field-label">
                Duration · hours
                <input
                  required
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={Math.floor(sessionDuration / 60)}
                  onChange={event =>
                    setSessionDuration(
                      Math.min(
                        1440,
                        Math.max(
                          15,
                          Number(event.target.value) * 60 +
                            (sessionDuration % 60)
                        )
                      )
                    )
                  }
                />
              </label>
              <label className="field-label">
                Duration · minutes
                <select
                  value={sessionDuration % 60}
                  onChange={event =>
                    setSessionDuration(
                      Math.min(
                        1440,
                        Math.max(
                          15,
                          Math.floor(sessionDuration / 60) * 60 +
                            Number(event.target.value)
                        )
                      )
                    )
                  }
                >
                  <option value={0}>00</option>
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={45}>45</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label className="field-label">
                Number of courts
                <input
                  required
                  type="number"
                  min={1}
                  max={12}
                  step={1}
                  value={sessionCourtCount}
                  onChange={event =>
                    setSessionCourtCount(Number(event.target.value))
                  }
                />
              </label>
              <label className="field-label">
                Players per match
                <input
                  required
                  type="number"
                  min={2}
                  max={8}
                  step={2}
                  value={sessionPlayersPerGame}
                  onChange={event =>
                    setSessionPlayersPerGame(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field-label">
                Queue strategy
                <select
                  value={sessionStrategy}
                  onChange={event =>
                    setSessionStrategy(event.target.value as "fair" | "skill")
                  }
                >
                  <option value="fair">Fair rotation</option>
                  <option value="skill">Skill-based</option>
                </select>
              </label>
              <label className="field-label">
                Team grouping
                <select
                  value={sessionGroupMode}
                  onChange={event =>
                    setSessionGroupMode(
                      event.target.value as "similar" | "balanced"
                    )
                  }
                >
                  <option value="similar">Similar skill</option>
                  <option value="balanced">Balanced teams</option>
                </select>
              </label>
            </div>
            <label className="field-label">
              Venue
              <input
                value={sessionVenue}
                onChange={event => setSessionVenue(event.target.value)}
                maxLength={180}
                placeholder="Court or club name"
              />
            </label>
            <label className="field-label">
              Session notes
              <textarea
                className="session-notes-input"
                rows={3}
                maxLength={2000}
                value={sessionNotes}
                onChange={event => setSessionNotes(event.target.value)}
                placeholder="Optional organizer notes"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={createSessionMutation.isPending}
              >
                Create session
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "score" && currentSession && scoreTarget !== null && (
        <Modal
          title="Confirm match score"
          description={`Court ${gameById.get(scoreTarget)?.courtNumber ?? "—"} · enter the final team scores.`}
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              try {
                await finishGameMutation.mutateAsync({
                  sessionId: currentSession.id,
                  gameId: scoreTarget,
                  teamAScore: Number(scoreA),
                  teamBScore: Number(scoreB),
                });
                toast.success("Score confirmed; player records updated");
                closeModal();
                setScoreTarget(null);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not settle this match"
                );
              }
            }}
          >
            <div className="score-team-labels">
              <span>
                <b>TEAM A</b>
                {gameById
                  .get(scoreTarget)
                  ?.players.filter(person => person.team === "A")
                  .map(person => person.name)
                  .join(" & ") || "—"}
              </span>
              <span>
                <b>TEAM B</b>
                {gameById
                  .get(scoreTarget)
                  ?.players.filter(person => person.team === "B")
                  .map(person => person.name)
                  .join(" & ") || "—"}
              </span>
            </div>
            <div className="form-row">
              <label className="field-label">
                Team A score
                <input
                  required
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  value={scoreA}
                  onChange={event => setScoreA(event.target.value)}
                />
              </label>
              <label className="field-label">
                Team B score
                <input
                  required
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  value={scoreB}
                  onChange={event => setScoreB(event.target.value)}
                />
              </label>
            </div>
            <p className="field-help">
              {currentSession.status === "ending" ||
              (timerRemaining !== null && timerRemaining <= 0)
                ? "Session time has expired: enter the score when the clock ended. Any non-negative whole-number score or tie is accepted."
                : "Standard match: the winner must reach at least 11 and lead by 2. A tie is not a normal result."}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={finishGameMutation.isPending}
              >
                Confirm score & finish
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "correct-score" && currentSession && scoreTarget !== null && (
        <Modal
          title="Correct a recorded result"
          description="The prior result remains in the audit log; enter a reason for this correction."
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              try {
                await correctGameMutation.mutateAsync({
                  sessionId: currentSession.id,
                  gameId: scoreTarget,
                  teamAScore: Number(scoreA),
                  teamBScore: Number(scoreB),
                  reason: scoreReason,
                });
                toast.success("Corrected score saved to the session audit");
                closeModal();
                setScoreTarget(null);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not correct score"
                );
              }
            }}
          >
            <div className="form-row">
              <label className="field-label">
                Team A score
                <input
                  required
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  value={scoreA}
                  onChange={event => setScoreA(event.target.value)}
                />
              </label>
              <label className="field-label">
                Team B score
                <input
                  required
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  value={scoreB}
                  onChange={event => setScoreB(event.target.value)}
                />
              </label>
            </div>
            <label className="field-label">
              Reason for correction
              <textarea
                className="session-notes-input"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={scoreReason}
                onChange={event => setScoreReason(event.target.value)}
                placeholder="Explain what was corrected"
              />
            </label>
            <div className="audit-correction-list">
              <strong>Previous corrections</strong>
              {correctionAuditQuery.isLoading ? (
                <small>Loading result audit…</small>
              ) : correctionAuditQuery.data?.length ? (
                correctionAuditQuery.data.map(entry => (
                  <small key={entry.id}>
                    {entry.actorName}: {entry.oldTeamAScore}–
                    {entry.oldTeamBScore} → {entry.newTeamAScore}–
                    {entry.newTeamBScore} · {entry.reason}
                  </small>
                ))
              ) : (
                <small>
                  No earlier corrections. The original score remains visible in
                  match history.
                </small>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={correctGameMutation.isPending || !scoreReason.trim()}
              >
                Save correction
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "cancel-match" && currentSession && scoreTarget !== null && (
        <Modal
          title="Cancel active match"
          description="No score, games-played count, or win/loss will be recorded; players return to the queue."
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              try {
                await cancelGameMutation.mutateAsync({
                  sessionId: currentSession.id,
                  gameId: scoreTarget,
                  reason: cancelReason,
                });
                toast.success("Match cancelled without a result");
                closeModal();
                setScoreTarget(null);
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not cancel match"
                );
              }
            }}
          >
            <label className="field-label">
              Reason for cancellation
              <textarea
                className="session-notes-input"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={cancelReason}
                onChange={event => setCancelReason(event.target.value)}
                placeholder="e.g. Court became unavailable"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Keep match
              </button>
              <button
                className="button button-danger"
                disabled={cancelGameMutation.isPending}
              >
                Cancel match
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "cancel-session" && currentSession && (
        <Modal
          title="Cancel session"
          description="This closes the session, cancels active courts, and preserves all settled results and audit history."
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              try {
                await cancelSessionMutation.mutateAsync({
                  sessionId: currentSession.id,
                  reason: cancelReason,
                });
                toast.success("Session cancelled; history retained");
                closeModal();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not cancel session"
                );
              }
            }}
          >
            <label className="field-label">
              Reason for cancellation
              <textarea
                className="session-notes-input"
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={cancelReason}
                onChange={event => setCancelReason(event.target.value)}
                placeholder="Add a short reason for the session record"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Keep session
              </button>
              <button
                className="button button-danger"
                disabled={cancelSessionMutation.isPending}
              >
                Cancel session
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "adjust-end" && currentSession && (
        <Modal
          title="Adjust session end"
          description="The timer is stored on the server and continues independently of this screen."
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              try {
                await adjustEndMutation.mutateAsync({
                  sessionId: currentSession.id,
                  endsAt: new Date(adjustEndValue).toISOString(),
                });
                toast.success("Session end time updated");
                closeModal();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not adjust end time"
                );
              }
            }}
          >
            <label className="field-label">
              New end date and time
              <input
                required
                type="datetime-local"
                value={adjustEndValue}
                onChange={event => setAdjustEndValue(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={adjustEndMutation.isPending}
              >
                Save end time
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "invite" && currentSession && (
        <Modal
          title="Invite players"
          description="Players can scan the code or open the link. The board is read-only; joining and check-in require a free account sign-in."
          onClose={closeModal}
        >
          <div className="invite-share-modal">
            <div className="invite-qr">
              <QRCodeSVG
                value={shareUrl}
                size={224}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#163a2b"
              />
            </div>
            <p>
              Scan to open <strong>{currentSession.name}</strong>
            </p>
            <label className="field-label">
              Session invitation link
              <input
                readOnly
                value={shareUrl}
                onFocus={event => event.currentTarget.select()}
              />
            </label>
            <button
              className="button button-primary button-wide"
              onClick={() => void copyShare()}
            >
              <Share2 size={15} /> {copied ? "Copied" : "Copy invitation link"}
            </button>
          </div>
        </Modal>
      )}
      {modal === "schedule" && currentSession && (
        <Modal
          title="Edit session schedule"
          description="Update the planned start, duration, and organizer notes before starting the timer."
          onClose={closeModal}
        >
          <form
            className="form-stack"
            onSubmit={async event => {
              event.preventDefault();
              try {
                await updateScheduleMutation.mutateAsync({
                  sessionId: currentSession.id,
                  scheduledStartAt: new Date(sessionStartTime).toISOString(),
                  durationMinutes: sessionDuration,
                  notes: sessionNotes,
                });
                toast.success("Session schedule saved");
                closeModal();
              } catch (error) {
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Could not update schedule"
                );
              }
            }}
          >
            <label className="field-label">
              Scheduled date and time
              <input
                required
                type="datetime-local"
                value={sessionStartTime}
                onChange={event => setSessionStartTime(event.target.value)}
              />
            </label>
            <div className="form-row">
              <label className="field-label">
                Duration · hours
                <input
                  required
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={Math.floor(sessionDuration / 60)}
                  onChange={event =>
                    setSessionDuration(
                      Math.min(
                        1440,
                        Math.max(
                          15,
                          Number(event.target.value) * 60 +
                            (sessionDuration % 60)
                        )
                      )
                    )
                  }
                />
              </label>
              <label className="field-label">
                Duration · minutes
                <select
                  value={sessionDuration % 60}
                  onChange={event =>
                    setSessionDuration(
                      Math.min(
                        1440,
                        Math.max(
                          15,
                          Math.floor(sessionDuration / 60) * 60 +
                            Number(event.target.value)
                        )
                      )
                    )
                  }
                >
                  <option value={0}>00</option>
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={45}>45</option>
                </select>
              </label>
            </div>
            <label className="field-label">
              Organizer notes
              <textarea
                className="session-notes-input"
                rows={4}
                maxLength={2000}
                value={sessionNotes}
                onChange={event => setSessionNotes(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button button-quiet"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={updateScheduleMutation.isPending}
              >
                Save schedule
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  detail,
  icon,
  accent,
  muted,
}: {
  label: string;
  value: number;
  detail: string;
  icon?: ReactNode;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <article
      className={`stat-card ${accent ? "stat-accent" : ""} ${muted ? "stat-muted" : ""}`}
    >
      <div className="stat-top">
        <span>{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
    </article>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-mark">
        <Users size={19} />
      </div>
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}
