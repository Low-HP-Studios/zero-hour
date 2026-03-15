import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

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
import { CHARACTER_REGISTRY, getCharacterById } from "../game/characters";
import { CharacterPreviewCanvas } from "./LobbyCharacter";

type MainMenuProps = {
  onStartGame: () => void;
};

type LobbyTab = "play" | "collection" | "store";

type NavItem = {
  id: LobbyTab;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "play", label: "Play" },
  { id: "collection", label: "Collection" },
  { id: "store", label: "Store" },
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

  const persisted = useMemo(loadPersistedSettings, []);
  const [settings, setSettings] = useState<GameSettings>(persisted.settings);
  const [hudPanels] = useState<HudOverlayToggles>(persisted.hudPanels);
  const [audioVolumes, setAudioVolumes] = useState<AudioVolumeSettings>(persisted.audioVolumes);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>(persisted.selectedCharacterId);

  useEffect(() => {
    savePersistedSettings({ settings, hudPanels, audioVolumes, stressCount: 0, selectedCharacterId });
  }, [settings, hudPanels, audioVolumes, selectedCharacterId]);

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

  const showOnlineToast = useCallback(() => {
    toast.warning("Online Deployment is in alpha", {
      description:
        "This lane is still under development. Practice Range is the only live module in the current build.",
      duration: 4200,
    });
  }, []);

  const previewCharacterDef = useMemo(
    () => getCharacterById(selectedCharacterId),
    [selectedCharacterId],
  );

  return (
    <div className="lobby-screen">
      {/* Background character art */}
      <div className="lobby-scene-viewport" aria-hidden="true" />

      <div className="lobby-layout-v2">
        {/* ── Topbar: three-zone ── */}
        <header className="lobby-topbar-v2">
          <div className="lobby-brand-v2">
            <h1 className="lobby-logo-v2">GrayTrace</h1>
            <span className="lobby-alpha-chip-v2">α</span>
          </div>

          <nav className="lobby-nav-v2" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`lobby-nav-btn-v2 ${activeTab === item.id ? "active" : ""}`}
                onClick={() => setActiveTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="lobby-utilities-v2">
            <button
              type="button"
              className="lobby-settings-btn-v2"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
            >
              <SettingsIcon />
              <span>Settings</span>
            </button>
          </div>
        </header>

        {/* ── Main content ── */}
        <main className="lobby-main-v2">

          {/* PLAY TAB — three-card hero layout */}
          {activeTab === "play" && (
            <div className="lobby-hero-v2">
              <div className="lobby-mode-card-v2 teaser">
                <div className="lobby-teaser-lock-v2">
                  <LockIcon />
                </div>
                <div className="lobby-teaser-label-v2">Coming Soon</div>
                <div className="lobby-teaser-name-v2">Ranked Mode</div>
              </div>

              <div className="lobby-mode-card-v2 active">
                <div className="lobby-card-header-v2">
                  <h2 className="lobby-card-title-v2">Training Simulation</h2>
                  <span className="lobby-card-badge-v2 ready">Ready</span>
                </div>
                <p className="lobby-card-desc-v2">
                  Enter the firing range to test weapon mechanics, spray
                  patterns, and advanced techniques in a controlled environment.
                </p>
                <div className="lobby-card-actions-v2">
                  <button
                    type="button"
                    className="lobby-play-btn-v2"
                    onClick={onStartGame}
                  >
                    <span>Enter Practice</span>
                    <ArrowIcon />
                  </button>
                  <button
                    type="button"
                    className="lobby-play-btn-v2 secondary"
                    onClick={showOnlineToast}
                  >
                    Online Match — Coming Soon
                  </button>
                </div>
              </div>

              <div className="lobby-mode-card-v2 teaser">
                <div className="lobby-teaser-lock-v2">
                  <LockIcon />
                </div>
                <div className="lobby-teaser-label-v2">Coming Soon</div>
                <div className="lobby-teaser-name-v2">Custom Match</div>
              </div>
            </div>
          )}

          {/* COLLECTION TAB — character selection + 3D preview */}
          {activeTab === "collection" && (
            <div className="lobby-collection-v2">
              <div className="lobby-collection-list-v2">
                <div className="lobby-collection-list-header-v2">
                  <h2>Characters</h2>
                  <span className="lobby-collection-count-v2">
                    {CHARACTER_REGISTRY.length}
                  </span>
                </div>
                <div className="lobby-collection-grid-v2">
                  {CHARACTER_REGISTRY.map((char) => (
                    <button
                      key={char.id}
                      type="button"
                      className={`lobby-char-card-v2 ${selectedCharacterId === char.id ? "equipped" : ""}`}
                      onClick={() => setSelectedCharacterId(char.id)}
                    >
                      <span className="lobby-char-name-v2">
                        {char.displayName}
                      </span>
                      {selectedCharacterId === char.id && (
                        <span className="lobby-char-equipped-v2">Equipped</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lobby-collection-preview-v2">
                <CharacterPreviewCanvas
                  characterDef={previewCharacterDef}
                  transparent
                />
                <div className="lobby-collection-preview-name-v2">
                  {previewCharacterDef.displayName}
                </div>
              </div>
            </div>
          )}

          {/* STORE TAB — pre-owned character store */}
          {activeTab === "store" && (
            <div className="lobby-store-v2">
              <div className="lobby-store-header-v2">
                <div>
                  <h2 className="lobby-store-title-v2">Character Store</h2>
                  <p className="lobby-store-subtitle-v2">
                    All characters are available during Early Access
                  </p>
                </div>
                <span className="lobby-store-balance-v2">All Owned</span>
              </div>
              <div className="lobby-store-grid-v2">
                {CHARACTER_REGISTRY.map((char) => {
                  const isEquipped = selectedCharacterId === char.id;
                  return (
                    <div key={char.id} className="lobby-store-item-v2">
                      <div className="lobby-store-item-art-v2" aria-hidden="true">
                        <span className="lobby-store-item-owned-tag-v2">OWNED</span>
                      </div>
                      <div className="lobby-store-item-info-v2">
                        <span className="lobby-store-item-name-v2">
                          {char.displayName}
                        </span>
                        <span className="lobby-store-item-price-v2">FREE</span>
                      </div>
                      <button
                        type="button"
                        className={`lobby-store-item-cta-v2 ${isEquipped ? "equipped" : ""}`}
                        onClick={() => setSelectedCharacterId(char.id)}
                      >
                        {isEquipped ? "Equipped" : "Equip"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Settings modal — unchanged */}
      {settingsOpen && createPortal(
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
                <div style={{ marginTop: "auto" }}>
                  <button
                    type="button"
                    className="btn-quit-app"
                    onClick={() => {
                      const api = (window as unknown as { electronAPI?: { quitApp?: () => void } }).electronAPI;
                      if (api?.quitApp) {
                        api.quitApp();
                      } else {
                        window.close();
                      }
                    }}
                  >
                    Quit Game
                  </button>
                </div>
              </aside>
              <section className="lobby-settings-content">
                {settingsTab === "gameplay" && (
                  <div className="menu-sections">
                    <MenuSection title="Look Sensitivity">
                      <RangeField
                        label="Camera / Free Look"
                        value={settings.sensitivity.look}
                        min={0.05} max={3} step={0.01}
                        onChange={(value) => setSettings((prev) => ({ ...prev, sensitivity: { ...prev.sensitivity, look: value } }))}
                      />
                      <RangeField
                        label="Rifle ADS"
                        value={settings.sensitivity.rifleAds}
                        min={0.05} max={2.5} step={0.01}
                        onChange={(value) => setSettings((prev) => ({ ...prev, sensitivity: { ...prev.sensitivity, rifleAds: value } }))}
                      />
                      <RangeField
                        label="Sniper ADS"
                        value={settings.sensitivity.sniperAds}
                        min={0.05} max={2} step={0.01}
                        onChange={(value) => setSettings((prev) => ({ ...prev, sensitivity: { ...prev.sensitivity, sniperAds: value } }))}
                      />
                      <RangeField
                        label="Vertical Multiplier"
                        value={settings.sensitivity.vertical}
                        min={0.3} max={2} step={0.01}
                        onChange={(value) => setSettings((prev) => ({ ...prev, sensitivity: { ...prev.sensitivity, vertical: value } }))}
                      />
                      <div className="settings-chip-wrap">
                        <span className="pill-chip">Effective Rifle ADS: {effectiveRifleAds}</span>
                        <span className="pill-chip">Effective Sniper ADS: {effectiveSniperAds}</span>
                      </div>
                    </MenuSection>
                    <MenuSection title="Field of View">
                      <RangeField
                        label="Base FOV"
                        value={settings.fov}
                        min={40} max={120} step={1} suffix="°"
                        onChange={(value) => setSettings((prev) => ({ ...prev, fov: value }))}
                      />
                    </MenuSection>
                  </div>
                )}
                {settingsTab === "audio" && (
                  <div className="menu-sections">
                    <MenuSection title="Volume Mixer">
                      <VolumeSlider label="Master" value={audioVolumes.master}
                        onChange={(value) => setAudioVolumes((prev) => ({ ...prev, master: value }))} />
                      <VolumeSlider label="Gunshots" value={audioVolumes.gunshot}
                        onChange={(value) => setAudioVolumes((prev) => ({ ...prev, gunshot: value }))} />
                      <VolumeSlider label="Footsteps" value={audioVolumes.footsteps}
                        onChange={(value) => setAudioVolumes((prev) => ({ ...prev, footsteps: value }))} />
                      <VolumeSlider label="Hit / Kill" value={audioVolumes.hit}
                        onChange={(value) => setAudioVolumes((prev) => ({ ...prev, hit: value }))} />
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
                                onClick={() => setBindingCapture((prev) => prev === row.key ? null : row.key)}
                              >
                                {bindingCapture === row.key ? "Press key..." : formatKeyCode(code)}
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
                        onChange={(checked) => setSettings((prev) => ({ ...prev, shadows: checked }))}
                      />
                      <SwitchRow
                        label="r3f-perf Overlay"
                        hint="Developer perf overlay"
                        checked={settings.showR3fPerf}
                        onChange={(checked) => setSettings((prev) => ({ ...prev, showR3fPerf: checked }))}
                      />
                      <div className="field-row">
                        <div>
                          <div className="field-label">Pixel Ratio</div>
                          <div className="field-hint">Render scale multiplier</div>
                        </div>
                        <div className="segmented-row compact">
                          {PIXEL_RATIO_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={`chip-btn ${settings.pixelRatioScale === option.value ? "active" : ""}`}
                              onClick={() => setSettings((prev) => ({ ...prev, pixelRatioScale: option.value }))}
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
        </div>,
        document.body,
      )}
    </div>
  );
}
