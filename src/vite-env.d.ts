/// <reference types="vite/client" />

import type {
  HostedMatchConnectionState,
  MatchEndedReason,
  OnlineFireIntent,
  OnlineHostedMatchSnapshot,
  OnlineMatchInputFrame,
} from "./game/online/types";

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_CONVEX_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  type UpdaterPhase =
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "none"
    | "error";

  type UpdaterStatusPayload = {
    phase: UpdaterPhase;
    progress?: number;
    message?: string;
    currentVersion: string;
    targetVersion?: string;
  };

  type UpdaterApi = {
    check: () => Promise<{ status: UpdaterPhase; version?: string }>;
    installNow: () => Promise<void>;
    repair: () => Promise<{ mode: "update" | "reinstall" | "manual" }>;
    getStatus: () => Promise<UpdaterStatusPayload>;
    onStatus: (callback: (payload: UpdaterStatusPayload) => void) => () => void;
  };

  type MultiplayerApi = {
    getDefaultPort: () => Promise<number>;
    hostMatch: (payload: {
      lobbyCode: string;
      mapId: "map1";
      startedAt: string;
      localUserId: string;
      hostPort: number;
      slots: Array<{
        userId: string;
        slotIndex: number;
        selectedCharacterId: string;
      }>;
    }) => Promise<{ ok: boolean; port?: number; protocolVersion?: number }>;
    joinMatch: (payload: {
      lobbyCode: string;
      localUserId: string;
      hostAddress: string;
      hostPort: number;
    }) => Promise<{ ok: boolean; protocolVersion?: number }>;
    leaveMatch: (payload?: {
      reason?: MatchEndedReason | null;
      notifyRemote?: boolean;
    }) => Promise<{ ok: boolean }>;
    sendInputFrame: (payload: OnlineMatchInputFrame) => Promise<{ ok: boolean }>;
    sendFireIntent: (payload: OnlineFireIntent) => Promise<{ ok: boolean }>;
    sendReloadIntent: (payload: { requestId: string }) => Promise<{ ok: boolean }>;
    onConnectionState: (callback: (payload: HostedMatchConnectionState) => void) => () => void;
    onSnapshot: (callback: (payload: OnlineHostedMatchSnapshot) => void) => () => void;
    onMatchEnded: (callback: (payload: { reason: MatchEndedReason }) => void) => () => void;
  };

  type ElectronApi = {
    platform: string;
    quitApp: () => Promise<void>;
    setGameplayActive: (active: boolean) => void;
    multiplayer: MultiplayerApi;
    updater: UpdaterApi;
  };

  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
