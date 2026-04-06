const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  quitApp: () => ipcRenderer.invoke("app:quit"),
  setGameplayActive: (active) =>
    ipcRenderer.send("app:set-gameplay-active", Boolean(active)),
  multiplayer: {
    getDefaultPort: () => ipcRenderer.invoke("multiplayer:get-default-port"),
    hostMatch: (payload) => ipcRenderer.invoke("multiplayer:host-match", payload),
    joinMatch: (payload) => ipcRenderer.invoke("multiplayer:join-match", payload),
    leaveMatch: (payload) => ipcRenderer.invoke("multiplayer:leave-match", payload),
    sendInputFrame: (payload) => ipcRenderer.invoke("multiplayer:send-input-frame", payload),
    sendFireIntent: (payload) => ipcRenderer.invoke("multiplayer:send-fire-intent", payload),
    sendReloadIntent: (payload) => ipcRenderer.invoke("multiplayer:send-reload-intent", payload),
    onConnectionState: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("multiplayer:connection-state", listener);
      return () => {
        ipcRenderer.removeListener("multiplayer:connection-state", listener);
      };
    },
    onSnapshot: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("multiplayer:snapshot", listener);
      return () => {
        ipcRenderer.removeListener("multiplayer:snapshot", listener);
      };
    },
    onMatchEnded: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("multiplayer:match-ended", listener);
      return () => {
        ipcRenderer.removeListener("multiplayer:match-ended", listener);
      };
    },
  },
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    installNow: () => ipcRenderer.invoke("updater:install-now"),
    repair: () => ipcRenderer.invoke("updater:repair"),
    getStatus: () => ipcRenderer.invoke("updater:get-status"),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("updater:status", listener);
      return () => {
        ipcRenderer.removeListener("updater:status", listener);
      };
    },
  },
});
