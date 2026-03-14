import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ExperienceMenuOverlayProps = {
  onEnterPractice: () => void;
  onOpenSettings: () => void;
  onOpenUpdates: () => void;
  updateReadyToInstall: boolean;
  updateTargetVersion?: string;
  installingUpdate: boolean;
  onInstallUpdate: () => void;
};

type LobbyTab = "play" | "friends" | "customise" | "store";
type LobbyMode = "practice" | "online";

type NavItem = {
  id: LobbyTab;
  label: string;
  hint: string;
  status: string;
  locked?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    id: "play",
    label: "Play",
    hint: "Practice lane online",
    status: "Live",
  },
  {
    id: "friends",
    label: "Squads",
    hint: "Party systems on deck",
    status: "Alpha",
    locked: true,
  },
  {
    id: "customise",
    label: "Loadout",
    hint: "Weapon tuning in progress",
    status: "Alpha",
    locked: true,
  },
  {
    id: "store",
    label: "Armory",
    hint: "Progression hooks in development",
    status: "Alpha",
    locked: true,
  },
];

const PRACTICE_METRICS = [
  { label: "Mode", value: "Solo drill" },
  { label: "Range", value: "Live" },
  { label: "Focus", value: "Recoil + pace" },
];

const PRACTICE_NOTES = [
  "Offline sandbox with instant restarts.",
  "Built for recoil control, snap aim, and movement reps.",
  "No fluff. Just enough UI to feel expensive.",
];

function LockIcon() {
  return (
    <svg
      className="menu-lock-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

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

export function ExperienceMenuOverlay({
  onEnterPractice,
  onOpenSettings,
  onOpenUpdates,
  updateReadyToInstall,
  updateTargetVersion,
  installingUpdate,
  onInstallUpdate,
}: ExperienceMenuOverlayProps) {
  const [activeTab, setActiveTab] = useState<LobbyTab>("play");
  const activeItem = NAV_ITEMS.find((item) => item.id === activeTab) ??
    NAV_ITEMS[0];
  const activeModuleDescription = activeItem.locked
    ? `${activeItem.hint}. Practice Range is still the only lane with a pulse.`
    : "A stripped-back firing range for testing mechanics, rhythm, and recoil without matchmaking clutter.";

  const showAlphaToast = useCallback((featureLabel: string) => {
    toast.warning(`${featureLabel} is in alpha`, {
      description:
        "This lane is still under development. Practice Range is the only live module in the current build.",
      duration: 4200,
    });
  }, []);

  const handleNavClick = useCallback((item: NavItem) => {
    if (item.locked) {
      showAlphaToast(item.label);
    }

    setActiveTab(item.id);
  }, [showAlphaToast]);

  const handleModeClick = useCallback((mode: LobbyMode) => {
    if (mode === "online") {
      showAlphaToast("Online Deployment");
    }
  }, [showAlphaToast]);

  return (
    <div className="menu-layout-expressive">
      <div className="menu-topbar-expressive">
        <div className="menu-brand-expressive">
          <h1 className="menu-logo-text-expressive">GrayTrace</h1>
          <span className="menu-brand-subtitle-expressive">ALPHA</span>
        </div>

        <nav className="menu-nav-expressive" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`menu-nav-btn-expressive ${
                activeTab === item.id ? "active" : ""
              } ${item.locked ? "locked" : ""}`}
              onClick={() => handleNavClick(item)}
            >
              <span className="nav-btn-text-expressive">{item.label}</span>
              {item.locked ? <LockIcon /> : null}
            </button>
          ))}
        </nav>

        <div className="menu-topbar-footer-expressive">
          {updateReadyToInstall ? (
            <button
              type="button"
              className="menu-settings-btn-expressive menu-restart-btn-expressive"
              onClick={onInstallUpdate}
              disabled={installingUpdate}
            >
              <span>
                {installingUpdate
                  ? "Restarting..."
                  : `Restart to install${
                    updateTargetVersion ? ` ${updateTargetVersion}` : ""
                  }`}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            className="menu-settings-btn-expressive menu-updates-btn-expressive"
            onClick={onOpenUpdates}
          >
            <span>Updates</span>
          </button>
          <button
            type="button"
            className="menu-settings-btn-expressive"
            onClick={onOpenSettings}
          >
            <div className="settings-icon-wrapper-expressive">
              <SettingsIcon />
            </div>
            <span>Settings</span>
          </button>
        </div>
      </div>

      <main className="menu-main-expressive">
        <div className="menu-grid-expressive">
          <section className="menu-hero-expressive">
            <div className="menu-hero-copy-expressive">
              <span className="menu-eyebrow-expressive">
                {activeItem.locked
                  ? `${activeItem.status} module`
                  : "Live practice module"}
              </span>
              <h2 className="menu-hero-title-expressive">
                {activeItem.locked
                  ? `${activeItem.label} is still in the workshop.`
                  : "Minimal by choice, not because we forgot the rest."}
              </h2>
              <p className="menu-hero-description-expressive">
                {activeModuleDescription}
              </p>
            </div>

            {activeTab === "play" ? (
              <div className="menu-play-section-expressive">
                <div className="menu-sub-nav-expressive">
                  <div className="sub-nav-track-expressive">
                    <button
                      type="button"
                      className="menu-sub-nav-btn-expressive active"
                      onClick={() => handleModeClick("practice")}
                    >
                      Practice Range
                    </button>
                    <button
                      type="button"
                      className="menu-sub-nav-btn-expressive locked"
                      onClick={() => handleModeClick("online")}
                      aria-disabled="true"
                    >
                      Online Queue
                    </button>
                  </div>
                </div>

                <div className="menu-play-card-expressive">
                  <div className="play-card-content-expressive">
                    <div className="play-card-kicker-expressive">
                      Current mission
                    </div>
                    <div className="play-card-header-expressive">
                      <h3>Training Simulation</h3>
                      <span className="status-badge-expressive">Ready</span>
                    </div>
                    <p className="play-card-desc-expressive">
                      Enter the firing range to tune spray control, warm up
                      aim, and abuse the reset loop until your bad habits file
                      a complaint.
                    </p>

                    <div className="play-card-metrics-expressive">
                      {PRACTICE_METRICS.map((metric) => (
                        <div
                          key={metric.label}
                          className="play-card-metric-expressive"
                        >
                          <span>{metric.label}</span>
                          <strong>{metric.value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="play-card-footer-expressive">
                    <p className="play-card-note-expressive">
                      Clean layout, live target work, no fake social layer.
                    </p>
                    <button
                      type="button"
                      className="play-btn-expressive"
                      onClick={onEnterPractice}
                    >
                      <span>Enter Practice</span>
                      <ArrowIcon />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="menu-coming-soon-expressive">
                <div className="offline-badge-expressive">
                  <span className="material-icon-placeholder">//</span>
                  <span>{activeItem.status} Module</span>
                </div>
                <h3 className="menu-coming-soon-title-expressive">
                  {activeItem.label} is staged, not shipped.
                </h3>
                <p>{activeModuleDescription}</p>
                <button
                  type="button"
                  className="menu-return-btn-expressive"
                  onClick={() => setActiveTab("play")}
                >
                  Return to Practice
                </button>
              </div>
            )}
          </section>

          <aside className="menu-side-panel-expressive">
            <div className="menu-side-card-expressive">
              <span className="menu-side-label-expressive">Build pulse</span>
              <strong className="menu-side-value-expressive">
                {activeItem.locked ? "Alpha holding pattern" : "Ready for reps"}
              </strong>
              <p className="menu-side-copy-expressive">
                {activeItem.locked
                  ? "The live lane is still Practice Range. The rest are promises with nicer typography."
                  : "The menu is quieter now. Your aim probably still is not."}
              </p>
            </div>

            <div className="menu-side-card-expressive">
              <span className="menu-side-label-expressive">
                {activeItem.locked ? "Roadmap note" : "Range notes"}
              </span>
              <ul className="menu-side-list-expressive">
                {(activeItem.locked
                  ? [
                    activeItem.hint,
                    "Social and progression systems are still in alpha.",
                    "Only the live practice module can be launched today.",
                  ]
                  : PRACTICE_NOTES).map((note) => (
                    <li key={note}>{note}</li>
                  ))}
              </ul>
            </div>
          </aside>
        </div>
      </main>
      <LobbyFpsCounter />
    </div>
  );
}
