import { useEffect, useRef, useState } from "react";
import {
  CHARACTER_REGISTRY,
  getCharacterById,
} from "./characters";
import type { OnlineController } from "./online/types";
import { SKY_OPTIONS, getSkyById, type SkyId } from "./sky-registry";
import { PRACTICE_MAP_OPTIONS, getPracticeMapById } from "./scene/practice-maps";
import type { MapId } from "./types";

type ExperienceMenuOverlayProps = {
  onEnterPractice: () => void;
  onOpenSettings: () => void;
  updateReadyToInstall: boolean;
  updateTargetVersion?: string;
  installingUpdate: boolean;
  onInstallUpdate: () => void;
  selectedCharacterId: string;
  onCharacterSelect: (characterId: string) => void;
  selectedSkyId: SkyId;
  onSkySelect: (skyId: SkyId) => void;
  selectedMapId: MapId;
  onMapSelect: (mapId: MapId) => void;
  online: OnlineController;
  onOpenStartupGate: () => void;
  updaterStatus: UpdaterStatusPayload;
  updaterBusyAction: "check" | "install" | "repair" | null;
  updaterAvailable: boolean;
  onCheckForUpdates: () => void;
};

type LobbyTab = "play" | "collection" | "store" | "updates";
type CollectionTab = "characters" | "skies";

type NavItem = {
  id: LobbyTab;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "play", label: "Play" },
  { id: "collection", label: "Collection" },
  { id: "store", label: "Store" },
  { id: "updates", label: "Updates" },
];

// Ring buffer of speed samples for the download graph
const SPEED_SAMPLES = 40;

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="btn-icon-expressive"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function getCatalogMonogram(label: string) {
  return label
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

function formatCatalogIndex(index: number) {
  return String(index + 1).padStart(2, "0");
}

function normalizeLobbyCode(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
}

function LobbyFpsCounter() {
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const rafIdRef = useRef(0);

  useEffect(() => {
    const loop = () => {
      frameCountRef.current++;
      const now = performance.now();
      if (now - lastTimeRef.current >= 1000) {
        setFps(Math.round(frameCountRef.current * 1000 / (now - lastTimeRef.current)));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
      rafIdRef.current = requestAnimationFrame(loop);
    };
    rafIdRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafIdRef.current);
  }, []);

  return <div className="lobby-fps-counter">{fps} fps</div>;
}

// SVG sparkline for download speed history
function DownloadSpeedGraph({ samples }: { samples: number[] }) {
  const W = 360;
  const H = 72;
  const pad = 4;

  if (samples.length < 2) {
    return (
      <div className="updates-graph-wrap-v2">
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2}
            stroke="rgba(147,220,192,0.12)" strokeWidth="1" strokeDasharray="4 4" />
        </svg>
        <span className="updates-graph-idle-v2">No download activity</span>
      </div>
    );
  }

  const max = Math.max(...samples, 0.01);
  const pts = samples.map((v, i) => {
    const x = pad + (i / (samples.length - 1)) * (W - pad * 2);
    const y = H - pad - (v / max) * (H - pad * 2);
    return `${x},${y}`;
  });

  const polyline = pts.join(" ");
  const areaPoints = [
    `${pad},${H - pad}`,
    ...pts,
    `${W - pad},${H - pad}`,
  ].join(" ");

  const currentRate = samples[samples.length - 1] ?? 0;

  return (
    <div className="updates-graph-wrap-v2">
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="speed-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#93dcc0" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#93dcc0" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <polygon points={areaPoints} fill="url(#speed-grad)" />
        <polyline points={polyline} fill="none" stroke="#93dcc0" strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className="updates-graph-rate-v2">
        {currentRate.toFixed(1)} <em>%/s</em>
      </span>
    </div>
  );
}

export function ExperienceMenuOverlay({
  onEnterPractice,
  onOpenSettings,
  updateReadyToInstall,
  updateTargetVersion,
  installingUpdate,
  onInstallUpdate,
  selectedCharacterId,
  onCharacterSelect,
  selectedSkyId,
  onSkySelect,
  selectedMapId,
  onMapSelect,
  online,
  onOpenStartupGate,
  updaterStatus,
  updaterBusyAction,
  updaterAvailable,
  onCheckForUpdates,
}: ExperienceMenuOverlayProps) {
  const [activeTab, setActiveTab] = useState<LobbyTab>("play");
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("characters");
  const [joinCode, setJoinCode] = useState("");

  // Track download speed as %/sec samples
  const speedSamplesRef = useRef<number[]>([]);
  const lastProgressRef = useRef<{ progress: number; time: number } | null>(null);
  const [speedSamples, setSpeedSamples] = useState<number[]>([]);

  useEffect(() => {
    if (updaterStatus.phase !== "downloading" || typeof updaterStatus.progress !== "number") {
      if (updaterStatus.phase !== "downloading") {
        lastProgressRef.current = null;
      }
      return;
    }

    const now = performance.now();
    const current = updaterStatus.progress;

    if (lastProgressRef.current !== null) {
      const dt = (now - lastProgressRef.current.time) / 1000;
      if (dt > 0.05) {
        const rate = (current - lastProgressRef.current.progress) / dt;
        const clamped = Math.max(0, rate);
        const next = [...speedSamplesRef.current, clamped].slice(-SPEED_SAMPLES);
        speedSamplesRef.current = next;
        setSpeedSamples([...next]);
        lastProgressRef.current = { progress: current, time: now };
      }
    } else {
      lastProgressRef.current = { progress: current, time: now };
    }
  }, [updaterStatus.phase, updaterStatus.progress]);

  const selectedCharacterDef = getCharacterById(selectedCharacterId);
  const selectedCharacterIndex = Math.max(
    0,
    CHARACTER_REGISTRY.findIndex((char) => char.id === selectedCharacterId),
  );
  const selectedSky = getSkyById(selectedSkyId);
  const selectedSkyIndex = Math.max(
    0,
    SKY_OPTIONS.findIndex((sky) => sky.id === selectedSkyId),
  );
  const selectedMap = getPracticeMapById(selectedMapId);

  const isDownloading = updaterStatus.phase === "downloading";
  const progress = typeof updaterStatus.progress === "number" ? updaterStatus.progress : null;
  const selectedCharacterMonogram = getCatalogMonogram(
    selectedCharacterDef.displayName,
  );
  const selectedSkyMonogram = getCatalogMonogram(selectedSky.label);
  const onlineBusy = online.authBusyAction !== null || online.lobbyBusyAction !== null;
  const currentLobbyPlayer = online.user && online.lobby
    ? (online.lobby.players.find((player) => player.userId === online.user?.id) ?? null)
    : null;
  const isCurrentPlayerHost = currentLobbyPlayer?.isHost ?? false;
  const onlineSelectedMap = getPracticeMapById(online.lobby?.selectedMapId ?? "map1");
  const allPlayersReady = online.lobby?.players.every((player) => player.isReady) ?? false;
  const canStartMatch = Boolean(
    online.lobby &&
      isCurrentPlayerHost &&
      online.lobby.status === "open" &&
      online.lobby.players.length === 2 &&
      allPlayersReady &&
      online.realtimeStatus === "connected",
  );

  const handleJoinSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const success = await online.joinLobby(joinCode, selectedCharacterId);
    if (success) {
      setJoinCode("");
    }
  };

  return (
    <div className="lobby-layout-v2 lobby-layout-v3">
      <header className="lobby-topbar-v2">
        <div className="lobby-brand-v2">
          <h1 className="lobby-logo-v2">GrayTrace</h1>
          <span className="lobby-alpha-chip-v2">α</span>
          {updateReadyToInstall && (
            <button
              type="button"
              className="lobby-update-ready-btn-v2"
              onClick={onInstallUpdate}
              disabled={installingUpdate}
            >
              {installingUpdate
                ? "Restarting..."
                : `Restart to install${updateTargetVersion ? ` ${updateTargetVersion}` : ""}`}
            </button>
          )}
        </div>

        <nav className="lobby-nav-v2" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`lobby-nav-btn-v2 ${activeTab === item.id ? "active" : ""}${item.id === "updates" && isDownloading ? " downloading" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
              {item.id === "updates" && isDownloading && (
                <span className="lobby-nav-dl-dot-v2" />
              )}
            </button>
          ))}
        </nav>

        <div className="lobby-utilities-v2">
          <button
            type="button"
            className="lobby-settings-btn-v2"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </div>
      </header>

      <main className="lobby-main-v2">
        {activeTab === "play" && (
          <div className="lobby-play-stage-v3">
            <section className="lobby-panel-v3 lobby-play-hero-v3">
              <div className="lobby-card-header-v2">
                <h2 className="lobby-card-title-v2">Practice</h2>
                <span className="lobby-card-badge-v2 ready">Ready</span>
              </div>
              <p className="lobby-hero-copy-v3">
                Live targets. No stakes. Enough room to miss in private.
              </p>
              <div className="lobby-map-panel-v3">
                <div className="lobby-map-selector-header-v2">
                  <span className="lobby-map-selector-label-v2">Map</span>
                  <span className="lobby-map-selector-value-v2">{selectedMap.label}</span>
                </div>
                <div className="segmented-row lobby-map-pills-v3">
                  {PRACTICE_MAP_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`chip-btn ${selectedMapId === option.id ? "active" : ""}`}
                      onClick={() => onMapSelect(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="lobby-map-selector-note-v2">
                  {selectedMap.description}
                </p>
              </div>
              <div className="lobby-card-actions-v2 lobby-card-actions-v3">
                <button
                  type="button"
                  className="lobby-play-btn-v2"
                  data-controller-default-focus="true"
                  onClick={onEnterPractice}
                >
                  <span>Enter Practice</span>
                  <ArrowIcon />
                </button>
              </div>
            </section>

            <section className="lobby-panel-v3 lobby-online-panel-v3">
              <div className="lobby-card-header-v2">
                <h2 className="online-panel-title-v3">Online Lobby</h2>
                <span className={`lobby-card-badge-v2 ${online.user ? "ready" : ""}`}>
                  {online.lobby
                    ? `${online.lobby.players.length}/${online.lobby.maxPlayers}`
                    : online.backendStatus === "checking" || online.authStatus === "checking"
                    ? "Syncing"
                    : online.user
                    ? "Signed in"
                    : online.backendStatus === "unavailable"
                    ? "Offline"
                    : "Locked"}
                </span>
              </div>

              <p className="lobby-hero-copy-v3">
                Room codes, ready checks, and just enough account plumbing to prove the backend
                exists. No chat, no matchmaking, no delusions of grandeur yet.
              </p>

              {online.notice ? (
                <p className="online-status-note-v3">{online.notice}</p>
              ) : null}

              {online.backendStatus === "checking" || online.authStatus === "checking"
                ? (
                  <div className="online-empty-state-v3">
                    <strong>Startup checks still running</strong>
                    <p>The pre-game gate is still deciding whether the backend trusts you.</p>
                  </div>
                )
                : null}

              {online.backendStatus === "unavailable"
                ? (
                  <div className="online-session-shell-v3">
                    <div className="online-empty-state-v3">
                      <strong>Backend offline</strong>
                      <p>Online access is locked until the backend stops ghosting the client.</p>
                    </div>
                    <button
                      type="button"
                      className="lobby-play-btn-v2 online-submit-btn-v3"
                      onClick={onOpenStartupGate}
                    >
                      Open startup gate
                    </button>
                  </div>
                )
                : null}

              {online.backendStatus === "connected" && online.authStatus === "signed_out"
                ? (
                  <div className="online-session-shell-v3">
                    <div className="online-empty-state-v3">
                      <strong>Login moved outside the game</strong>
                      <p>Use the startup gate to authenticate, then come back once the paperwork clears.</p>
                    </div>
                    <button
                      type="button"
                      className="lobby-play-btn-v2 online-submit-btn-v3"
                      onClick={onOpenStartupGate}
                    >
                      Open login
                    </button>
                  </div>
                )
                : null}

              {online.backendStatus === "connected" && online.authStatus === "authenticated" && online.user !== null && !online.lobby
                ? (
                  <div className="online-session-shell-v3">
                    <div className="online-session-head-v3">
                      <div>
                        <span className="lobby-section-label-v3">Signed in as</span>
                        <strong className="online-user-name-v3">{online.user.username}</strong>
                      </div>
                      <button
                        type="button"
                        className="online-secondary-btn-v3"
                        onClick={() => {
                          void online.signOut().then(() => {
                            onOpenStartupGate();
                          });
                        }}
                        disabled={onlineBusy}
                      >
                        {online.authBusyAction === "logout" ? "Switching..." : "Change account"}
                      </button>
                    </div>

                    <div className="online-create-card-v3">
                      <span className="online-block-label-v3">Create a room</span>
                      <p className="online-status-note-v3">
                        Creates a 2-player rifle skirmish on map1 using your currently selected operative.
                      </p>
                      <button
                        type="button"
                        className="lobby-play-btn-v2 online-submit-btn-v3"
                        onClick={() => { void online.createLobby(2, selectedCharacterId, "map1"); }}
                        disabled={onlineBusy}
                      >
                        {online.lobbyBusyAction === "create" ? "Creating..." : "Create lobby"}
                      </button>
                    </div>

                    <form className="online-join-form-v3" onSubmit={handleJoinSubmit}>
                      <label className="online-field-v3">
                        <span>Join by code</span>
                        <input
                          className="online-input-v3 online-code-input-v3"
                          type="text"
                          value={joinCode}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) => setJoinCode(normalizeLobbyCode(event.target.value))}
                          placeholder="ABC123"
                          disabled={onlineBusy}
                        />
                      </label>
                      <button
                        type="submit"
                        className="online-secondary-btn-v3 online-join-btn-v3"
                        disabled={onlineBusy || joinCode.length !== 6}
                      >
                        {online.lobbyBusyAction === "join" ? "Joining..." : "Join lobby"}
                      </button>
                    </form>
                  </div>
                )
                : null}

              {online.backendStatus === "connected" && online.authStatus === "authenticated" && online.user !== null && online.lobby
                ? (
                  <div className="online-session-shell-v3">
                    <div className="online-session-head-v3">
                      <div>
                        <span className="lobby-section-label-v3">Signed in as</span>
                        <strong className="online-user-name-v3">{online.user.username}</strong>
                      </div>
                      <button
                        type="button"
                        className="online-secondary-btn-v3"
                        onClick={() => {
                          void online.signOut().then(() => {
                            onOpenStartupGate();
                          });
                        }}
                        disabled={onlineBusy}
                      >
                        {online.authBusyAction === "logout" ? "Switching..." : "Change account"}
                      </button>
                    </div>

                    <div className="online-lobby-meta-v3">
                      <article className="online-meta-card-v3">
                        <span>Room code</span>
                        <strong>{online.lobby.code}</strong>
                      </article>
                      <article className="online-meta-card-v3">
                        <span>Capacity</span>
                        <strong>{online.lobby.players.length}/{online.lobby.maxPlayers}</strong>
                      </article>
                      <article className="online-meta-card-v3">
                        <span>Realtime</span>
                        <strong>{online.realtimeStatus}</strong>
                      </article>
                    </div>

                    <div className="lobby-map-panel-v3">
                      <div className="lobby-map-selector-header-v2">
                        <span className="lobby-map-selector-label-v2">Live combat map</span>
                        <span className="lobby-map-selector-value-v2">{onlineSelectedMap.label}</span>
                      </div>
                      <div className="segmented-row lobby-map-pills-v3">
                        <button
                          type="button"
                          className="chip-btn active"
                          disabled
                        >
                          {onlineSelectedMap.label}
                        </button>
                      </div>
                      <p className="lobby-map-selector-note-v2">
                        Live combat is locked to map1 and rifle-only for this version. Restraint is rare, but healthy.
                      </p>
                    </div>

                    <div className="online-roster-v3">
                      {online.lobby.players.map((player) => (
                        <article
                          key={player.userId}
                          className={`online-roster-card-v3 ${player.isHost ? "host" : ""} ${player.isReady ? "ready" : ""} ${player.userId === online.user?.id ? "self" : ""}`}
                        >
                          <div className="online-roster-top-v3">
                            <strong>{player.username}</strong>
                            <span className="online-roster-role-v3">
                              {player.isHost ? "Host" : player.isReady ? "Ready" : "Waiting"}
                            </span>
                          </div>
                          <div className="online-roster-bottom-v3">
                            <span>{player.userId === online.user?.id ? "You" : "Member"}</span>
                            <span>
                              {getCharacterById(player.selectedCharacterId).displayName}
                              {" · "}
                              {player.isReady ? "Locked in" : "Not ready"}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>

                    <div className="online-lobby-actions-v3">
                      {isCurrentPlayerHost ? (
                        <button
                          type="button"
                          className="lobby-play-btn-v2"
                          onClick={() => { void online.startMatch(); }}
                          disabled={onlineBusy || !canStartMatch}
                        >
                          {online.lobbyBusyAction === "start"
                            ? "Starting..."
                            : online.lobby.status === "in_match"
                            ? "Match live"
                            : "Start match"}
                        </button>
                      ) : null}
                      {currentLobbyPlayer ? (
                        <button
                          type="button"
                          className="lobby-play-btn-v2 secondary"
                          onClick={() => { void online.toggleReady(!currentLobbyPlayer.isReady); }}
                          disabled={onlineBusy}
                        >
                          {online.lobbyBusyAction === "ready"
                            ? "Updating..."
                            : currentLobbyPlayer.isReady
                            ? "Mark not ready"
                            : "Mark ready"}
                        </button>
                      ) : null}
                      {online.lobby.status === "in_match" ? (
                        <button
                          type="button"
                          className="online-secondary-btn-v3"
                          onClick={() => { void online.endMatch(); }}
                          disabled={onlineBusy}
                        >
                          {online.lobbyBusyAction === "end_match" ? "Ending..." : "End match"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="online-secondary-btn-v3"
                        onClick={() => { void online.leaveLobby(); }}
                        disabled={onlineBusy}
                      >
                        {online.lobbyBusyAction === "leave" ? "Leaving..." : "Leave lobby"}
                      </button>
                      {currentLobbyPlayer?.isHost ? (
                        <button
                          type="button"
                          className="updates-action-btn-v2 danger"
                          onClick={() => { void online.disbandLobby(); }}
                          disabled={onlineBusy}
                        >
                          {online.lobbyBusyAction === "disband" ? "Disbanding..." : "Disband lobby"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
                : null}
            </section>
          </div>
        )}

        {activeTab === "collection" && (
          <div className="lobby-collection-v2 lobby-collection-v3">
            <div className="lobby-collection-list-v2 lobby-panel-v3">
              <div className="lobby-collection-list-header-v2">
                <h2>{collectionTab === "characters" ? "Characters" : "Skies"}</h2>
                <span className="lobby-collection-count-v2">
                  {collectionTab === "characters" ? CHARACTER_REGISTRY.length : SKY_OPTIONS.length}
                </span>
              </div>
              <div className="lobby-collection-catalog-tabs-v3" role="tablist" aria-label="Collection categories">
                <button
                  type="button"
                  role="tab"
                  aria-selected={collectionTab === "characters"}
                  className={`lobby-collection-catalog-tab-v3 ${collectionTab === "characters" ? "active" : ""}`}
                  onClick={() => setCollectionTab("characters")}
                >
                  Characters
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={collectionTab === "skies"}
                  className={`lobby-collection-catalog-tab-v3 ${collectionTab === "skies" ? "active" : ""}`}
                  onClick={() => setCollectionTab("skies")}
                >
                  Skies
                </button>
              </div>
              <div className="lobby-collection-grid-v2">
                {collectionTab === "characters"
                  ? CHARACTER_REGISTRY.map((char) => (
                    <button
                      key={char.id}
                      type="button"
                      className={`lobby-char-card-v2 ${selectedCharacterId === char.id ? "equipped" : ""}`}
                      onClick={() => onCharacterSelect(char.id)}
                    >
                      <span className="lobby-char-name-v2">{char.displayName}</span>
                      {selectedCharacterId === char.id && (
                        <span className="lobby-char-equipped-v2">Equipped</span>
                      )}
                    </button>
                  ))
                  : SKY_OPTIONS.map((sky) => (
                    <button
                      key={sky.id}
                      type="button"
                      className={`lobby-sky-card-v3 ${selectedSkyId === sky.id ? "equipped" : ""}`}
                      onClick={() => onSkySelect(sky.id)}
                    >
                      <span className="lobby-sky-name-v3">{sky.label}</span>
                      <span className="lobby-sky-copy-v3">{sky.description}</span>
                      {selectedSkyId === sky.id && (
                        <span className="lobby-char-equipped-v2">Equipped</span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
            {collectionTab === "characters"
              ? (
                <section className="lobby-panel-v3 lobby-character-dossier-v3">
                  <div className="lobby-character-mark-v3">
                    {selectedCharacterMonogram}
                  </div>
                  <span className="lobby-section-label-v3">Selected Operative</span>
                  <h2 className="lobby-character-title-v3">{selectedCharacterDef.displayName}</h2>
                  <p className="lobby-character-copy-v3">
                    This selection drives the live lobby background now. One render,
                    one rifle, and fewer fake preview boxes cluttering the crime scene.
                  </p>
                  <div className="lobby-character-facts-v3">
                    <article className="lobby-meta-card-v3">
                      <span>Registry</span>
                      <strong>
                        {formatCatalogIndex(selectedCharacterIndex)}/{CHARACTER_REGISTRY.length}
                      </strong>
                    </article>
                    <article className="lobby-meta-card-v3">
                      <span>Status</span>
                      <strong>Equipped</strong>
                    </article>
                    <article className="lobby-meta-card-v3">
                      <span>Presentation</span>
                      <strong>Noir live feed</strong>
                    </article>
                  </div>
                </section>
              )
              : (
                <section className="lobby-panel-v3 lobby-character-dossier-v3 lobby-sky-dossier-v3">
                  <div className="lobby-character-mark-v3 lobby-sky-mark-v3">
                    {selectedSkyMonogram}
                  </div>
                  <span className="lobby-section-label-v3">Active Sky</span>
                  <h2 className="lobby-character-title-v3">{selectedSky.label}</h2>
                  <p className="lobby-character-copy-v3">
                    {selectedSky.description} Clicking a card swaps the live lobby backdrop
                    immediately, because extra confirmation buttons are just paperwork in disguise.
                  </p>
                  <div className="lobby-character-facts-v3">
                    <article className="lobby-meta-card-v3">
                      <span>Registry</span>
                      <strong>
                        {formatCatalogIndex(selectedSkyIndex)}/{SKY_OPTIONS.length}
                      </strong>
                    </article>
                    <article className="lobby-meta-card-v3">
                      <span>Status</span>
                      <strong>Equipped</strong>
                    </article>
                    <article className="lobby-meta-card-v3">
                      <span>Scope</span>
                      <strong>Lobby + Practice</strong>
                    </article>
                  </div>
                </section>
              )}
          </div>
        )}

        {activeTab === "store" && (
          <div className="lobby-store-v2 lobby-store-v3">
            <div className="lobby-store-header-v2">
              <div>
                <h2 className="lobby-store-title-v2">Character Store</h2>
                <p className="lobby-store-subtitle-v2">
                  All operatives are unlocked during Early Access, because fake scarcity is still fake.
                </p>
              </div>
              <span className="lobby-store-balance-v2">All Owned</span>
            </div>
            <div className="lobby-store-grid-v2">
              {CHARACTER_REGISTRY.map((char, index) => {
                const isEquipped = selectedCharacterId === char.id;
                const monogram = getCatalogMonogram(char.displayName);
                return (
                  <div
                    key={char.id}
                    className={`lobby-store-item-v2 ${isEquipped ? "equipped" : ""}`}
                  >
                    <div className="lobby-store-item-art-v2" aria-hidden="true">
                      <span className="lobby-store-item-seq-v3">{formatCatalogIndex(index)}</span>
                      <span className="lobby-store-item-monogram-v3">{monogram}</span>
                      <span className="lobby-store-item-owned-tag-v2">Owned</span>
                    </div>
                    <div className="lobby-store-item-info-v2">
                      <span className="lobby-store-item-name-v2">{char.displayName}</span>
                      <span className="lobby-store-item-price-v2">FREE</span>
                    </div>
                    <button
                      type="button"
                      className={`lobby-store-item-cta-v2 ${isEquipped ? "equipped" : ""}`}
                      onClick={() => onCharacterSelect(char.id)}
                    >
                      {isEquipped ? "Equipped" : "Equip"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "updates" && (
          <div className="updates-page-v2 updates-page-v3">
            <div className="updates-meta-row-v2">
              <div className="updates-version-grid-v2">
                <div className="updates-metric-v2">
                  <span>Current build</span>
                  <strong>{updaterStatus.currentVersion}</strong>
                </div>
                <div className="updates-metric-v2">
                  <span>Latest known</span>
                  <strong>{updaterStatus.targetVersion ?? "—"}</strong>
                </div>
                <div className="updates-metric-v2">
                  <span>Platform</span>
                  <strong>{window.electronAPI?.platform ?? "web"}</strong>
                </div>
                <div className="updates-metric-v2">
                  <span>Status</span>
                  <strong className={`updates-phase-label-v2 phase-${updaterStatus.phase}`}>
                    {updaterStatus.phase}
                  </strong>
                </div>
              </div>

              <div className="updates-actions-v2">
                <button
                  type="button"
                  className="updates-action-btn-v2"
                  onClick={onCheckForUpdates}
                  disabled={!updaterAvailable || updaterBusyAction !== null}
                >
                  {updaterBusyAction === "check" ? "Checking..." : "Check for updates"}
                </button>
                <button
                  type="button"
                  className="updates-action-btn-v2 primary"
                  onClick={onInstallUpdate}
                  disabled={!updaterAvailable || !updateReadyToInstall || updaterBusyAction !== null}
                >
                  {updaterBusyAction === "install" ? "Installing..." : "Restart to install"}
                </button>
                <button
                  type="button"
                  className="updates-action-btn-v2 danger"
                  disabled
                  title="Cancel not yet supported by the updater API"
                >
                  Cancel download
                </button>
              </div>
            </div>

            {/* Download progress + graph */}
            <div className="updates-download-section-v2">
              <div className="updates-download-header-v2">
                <span className="updates-download-title-v2">Download progress</span>
                {progress !== null && (
                  <span className="updates-download-pct-v2">{progress.toFixed(1)}%</span>
                )}
              </div>

              {/* Progress bar */}
              <div className="updates-progress-bar-v2">
                <div
                  className="updates-progress-fill-v2"
                  style={{ width: `${progress ?? 0}%` }}
                />
              </div>

              {/* Speed sparkline */}
              <DownloadSpeedGraph samples={speedSamples} />

              {isDownloading && (
                <p className="updates-download-note-v2">
                  Downloading update — do not quit the application.
                </p>
              )}
            </div>

            {/* Status message */}
            {updaterStatus.message && (
              <p className="updates-message-v2">{updaterStatus.message}</p>
            )}

            {!updaterAvailable && (
              <p className="updates-warning-v2">
                Updater API unavailable — running outside Electron or preload not loaded.
              </p>
            )}
          </div>
        )}
      </main>

      <LobbyFpsCounter />
    </div>
  );
}
