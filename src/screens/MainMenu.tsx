import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LobbyScene } from "./LobbyCharacter";

import { type AudioVolumeSettings } from "../game/Audio";
import {
  MenuSection,
  SwitchRow,
  RangeField,
  VolumeSlider,
  menuTitle,
  formatKeyCode,
} from "../game/SettingsPanels";
import type { GameSettings, HudOverlayToggles } from "../game/types";
import {
  type BindingKey,
  type PauseMenuTab,
  PIXEL_RATIO_OPTIONS,
  BINDING_ROWS,
  loadPersistedSettings,
  savePersistedSettings,
} from "../game/settings";

type MainMenuProps = {
  onStartGame: () => void;
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

const SETTINGS_TABS: Array<{ id: PauseMenuTab; label: string }> = [
  { id: "gameplay", label: "Gameplay" },
  { id: "audio", label: "Audio" },
  { id: "controls", label: "Controls" },
  { id: "graphics", label: "Graphics" },
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

export function MainMenu({ onStartGame }: MainMenuProps) {
  const [activeTab, setActiveTab] = useState<LobbyTab>("play");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<PauseMenuTab>("gameplay");
  const [bindingCapture, setBindingCapture] = useState<BindingKey | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const persisted = useMemo(loadPersistedSettings, []);
  const [settings, setSettings] = useState<GameSettings>(persisted.settings);
  const [hudPanels] = useState<HudOverlayToggles>(
    persisted.hudPanels,
  );
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumeSettings>(
    persisted.audioVolumes,
  );

  useEffect(() => {
    savePersistedSettings({ settings, hudPanels, audioVolumes, stressCount: 0 });
  }, [settings, hudPanels, audioVolumes]);

  useEffect(() => {
    if (!bindingCapture) return;
    const onCaptureKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setBindingCapture(null);
        return;
      }
      setSettings((prev) => ({
        ...prev,
        keybinds: { ...prev.keybinds, [bindingCapture]: event.code },
      }));
      setBindingCapture(null);
    };
    window.addEventListener("keydown", onCaptureKey, true);
    return () => window.removeEventListener("keydown", onCaptureKey, true);
  }, [bindingCapture]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape" && settingsOpen) {
        setSettingsOpen(false);
        setBindingCapture(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const duplicateBindingCodes = useMemo(() => {
    const codeCounts = new Map<string, number>();
    for (const code of Object.values(settings.keybinds)) {
      codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    }
    return new Set(
      [...codeCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([code]) => code),
    );
  }, [settings.keybinds]);

  const effectiveRifleAds = (
    settings.sensitivity.look * settings.sensitivity.rifleAds
  ).toFixed(2);
  const effectiveSniperAds = (
    settings.sensitivity.look * settings.sensitivity.sniperAds
  ).toFixed(2);

  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false);
    setBindingCapture(null);
  }, []);

  const handlePlayClick = useCallback(() => {
    setTransitioning(true);
  }, []);

  const handleTransitionComplete = useCallback(() => {
    onStartGame();
  }, [onStartGame]);

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
      return;
    }

    setActiveTab(item.id);
  }, [showAlphaToast]);

  const handleModeClick = useCallback((mode: LobbyMode) => {
    if (mode === "online") {
      showAlphaToast("Online Deployment");
    }
  }, [showAlphaToast]);

  return (
    <div className="lobby-screen">
      <LobbyScene
        transitioning={transitioning}
        onTransitionComplete={handleTransitionComplete}
      />

      <div className={`menu-layout-expressive ${transitioning ? "menu-transitioning" : ""}`}>
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
                className={`menu-nav-btn-expressive ${activeTab === item.id ? "active" : ""} ${item.locked ? "locked" : ""}`}
                onClick={() => handleNavClick(item)}
                aria-disabled={item.locked ? "true" : undefined}
              >
                <span className="nav-btn-text-expressive">{item.label}</span>
                {item.locked && <LockIcon />}
              </button>
            ))}
          </nav>

          <div className="menu-topbar-footer-expressive">
            <button
              type="button"
              className="menu-settings-btn-expressive"
              onClick={() => setSettingsOpen(true)}
            >
              <div className="settings-icon-wrapper-expressive">
                <SettingsIcon />
              </div>
              <span>Settings</span>
            </button>
          </div>
        </div>

        <main className="menu-main-expressive">
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
                    Online (Disabled)
                  </button>
                </div>
              </div>

              <div className="menu-play-card-expressive">
                <div className="play-card-content-expressive">
                  <div className="play-card-header-expressive">
                    <h3>Training Simulation</h3>
                    <span className="status-badge-expressive">Ready</span>
                  </div>
                  <p className="play-card-desc-expressive">Enter the firing range to test weapon mechanics, spray patterns, and advanced techniques in a controlled environment.</p>
                </div>
                <button type="button" className="play-btn-expressive" onClick={handlePlayClick}>
                  <span>Enter Practice</span>
                  <ArrowIcon />
                </button>
              </div>
            </div>
          ) : (
            <div className="menu-coming-soon-expressive">
              <div className="offline-badge-expressive">
                <span className="material-icon-placeholder">🚧</span>
                <span>Module Offline</span>
              </div>
              <p>This feature is currently locked in the early Alpha phase.</p>
            </div>
          )}
        </main>
      </div>

      {settingsOpen && (
        <div className="lobby-settings-overlay" onClick={handleSettingsClose}>
          <div
            className="lobby-settings-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Settings"
          >
            <div className="lobby-settings-header">
              <h2>{menuTitle(settingsTab)}</h2>
              <button
                type="button"
                className="lobby-settings-close"
                onClick={handleSettingsClose}
              >
                ×
              </button>
            </div>
            <div className="lobby-settings-body">
              <aside className="lobby-settings-sidebar">
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`lobby-settings-tab ${settingsTab === tab.id ? "active" : ""}`}
                    onClick={() => {
                      setSettingsTab(tab.id);
                      setBindingCapture(null);
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </aside>
              <section className="lobby-settings-content">
                {settingsTab === "gameplay" && (
                  <div className="menu-sections">
                    <MenuSection title="Look Sensitivity">
                      <RangeField
                        label="Camera / Free Look"
                        value={settings.sensitivity.look}
                        min={0.05}
                        max={3}
                        step={0.01}
                        onChange={(value) =>
                          setSettings((prev) => ({
                            ...prev,
                            sensitivity: { ...prev.sensitivity, look: value },
                          }))
                        }
                      />
                      <RangeField
                        label="Rifle ADS"
                        value={settings.sensitivity.rifleAds}
                        min={0.05}
                        max={2.5}
                        step={0.01}
                        onChange={(value) =>
                          setSettings((prev) => ({
                            ...prev,
                            sensitivity: {
                              ...prev.sensitivity,
                              rifleAds: value,
                            },
                          }))
                        }
                      />
                      <RangeField
                        label="Sniper ADS"
                        value={settings.sensitivity.sniperAds}
                        min={0.05}
                        max={2}
                        step={0.01}
                        onChange={(value) =>
                          setSettings((prev) => ({
                            ...prev,
                            sensitivity: {
                              ...prev.sensitivity,
                              sniperAds: value,
                            },
                          }))
                        }
                      />
                      <RangeField
                        label="Vertical Multiplier"
                        value={settings.sensitivity.vertical}
                        min={0.3}
                        max={2}
                        step={0.01}
                        onChange={(value) =>
                          setSettings((prev) => ({
                            ...prev,
                            sensitivity: {
                              ...prev.sensitivity,
                              vertical: value,
                            },
                          }))
                        }
                      />
                      <div className="settings-chip-wrap">
                        <span className="pill-chip">
                          Effective Rifle ADS: {effectiveRifleAds}
                        </span>
                        <span className="pill-chip">
                          Effective Sniper ADS: {effectiveSniperAds}
                        </span>
                      </div>
                    </MenuSection>
                    <MenuSection title="Field of View">
                      <RangeField
                        label="Base FOV"
                        value={settings.fov}
                        min={40}
                        max={120}
                        step={1}
                        suffix="°"
                        onChange={(value) =>
                          setSettings((prev) => ({ ...prev, fov: value }))
                        }
                      />
                    </MenuSection>
                  </div>
                )}

                {settingsTab === "audio" && (
                  <div className="menu-sections">
                    <MenuSection title="Volume Mixer">
                      <VolumeSlider
                        label="Master"
                        value={audioVolumes.master}
                        onChange={(value) =>
                          setAudioVolumes((prev) => ({
                            ...prev,
                            master: value,
                          }))
                        }
                      />
                      <VolumeSlider
                        label="Gunshots"
                        value={audioVolumes.gunshot}
                        onChange={(value) =>
                          setAudioVolumes((prev) => ({
                            ...prev,
                            gunshot: value,
                          }))
                        }
                      />
                      <VolumeSlider
                        label="Footsteps"
                        value={audioVolumes.footsteps}
                        onChange={(value) =>
                          setAudioVolumes((prev) => ({
                            ...prev,
                            footsteps: value,
                          }))
                        }
                      />
                      <VolumeSlider
                        label="Hit / Kill"
                        value={audioVolumes.hit}
                        onChange={(value) =>
                          setAudioVolumes((prev) => ({ ...prev, hit: value }))
                        }
                      />
                    </MenuSection>
                  </div>
                )}

                {settingsTab === "controls" && (
                  <div className="menu-sections">
                    <MenuSection title="Keyboard Shortcuts">
                      <div className="keybind-grid">
                        {BINDING_ROWS.map((row) => {
                          const code = settings.keybinds[row.key];
                          const duplicated = duplicateBindingCodes.has(code);
                          return (
                            <div
                              key={row.key}
                              className={`keybind-row ${bindingCapture === row.key ? "capturing" : ""} ${duplicated ? "duplicate" : ""}`}
                            >
                              <div>
                                <div className="keybind-label">{row.label}</div>
                                <div className="keybind-hint">{row.hint}</div>
                              </div>
                              <button
                                type="button"
                                className={`keybind-btn ${bindingCapture === row.key ? "active" : ""}`}
                                onClick={() =>
                                  setBindingCapture((prev) =>
                                    prev === row.key ? null : row.key,
                                  )
                                }
                              >
                                {bindingCapture === row.key
                                  ? "Press key..."
                                  : formatKeyCode(code)}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </MenuSection>
                  </div>
                )}

                {settingsTab === "graphics" && (
                  <div className="menu-sections">
                    <MenuSection title="Render Quality">
                      <SwitchRow
                        label="Shadows"
                        hint="Sun shadow maps for scene and targets"
                        checked={settings.shadows}
                        onChange={(checked) =>
                          setSettings((prev) => ({
                            ...prev,
                            shadows: checked,
                          }))
                        }
                      />
                      <SwitchRow
                        label="r3f-perf Overlay"
                        hint="Developer perf overlay"
                        checked={settings.showR3fPerf}
                        onChange={(checked) =>
                          setSettings((prev) => ({
                            ...prev,
                            showR3fPerf: checked,
                          }))
                        }
                      />
                      <div className="field-row">
                        <div>
                          <div className="field-label">Pixel Ratio</div>
                          <div className="field-hint">
                            Render scale multiplier
                          </div>
                        </div>
                        <div className="segmented-row compact">
                          {PIXEL_RATIO_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={`chip-btn ${settings.pixelRatioScale === option.value ? "active" : ""}`}
                              onClick={() =>
                                setSettings((prev) => ({
                                  ...prev,
                                  pixelRatioScale: option.value,
                                }))
                              }
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </MenuSection>
                  </div>
                )}

              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
