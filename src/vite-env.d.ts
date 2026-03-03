/// <reference types="vite/client" />

declare global {
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

  type ElectronApi = {
    platform: string;
    updater: UpdaterApi;
  };

  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
