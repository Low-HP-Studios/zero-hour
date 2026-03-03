const { app, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

const REPO_OWNER = "ayushrameja";
const REPO_NAME = "threeJS";
const LATEST_RELEASE_URL =
  `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const WINDOWS_LATEST_YML_URL =
  `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/latest.yml`;

/**
 * @typedef {"idle"|"checking"|"available"|"downloading"|"downloaded"|"none"|"error"} UpdaterPhase
 *
 * @typedef {{
 *   phase: UpdaterPhase;
 *   progress?: number;
 *   message?: string;
 *   currentVersion: string;
 *   targetVersion?: string;
 * }} UpdaterStatusPayload
 */

/**
 * @param {{ getMainWindow: () => import("electron").BrowserWindow | null }} options
 */
function createUpdaterService(options) {
  const { getMainWindow } = options;
  let repairInFlight = false;

  /** @type {UpdaterStatusPayload} */
  let currentStatus = {
    phase: "idle",
    message: "Updater idle.",
    currentVersion: app.getVersion(),
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  /**
   * @param {Partial<UpdaterStatusPayload>} patch
   * @returns {UpdaterStatusPayload}
   */
  function emitStatus(patch) {
    currentStatus = {
      ...currentStatus,
      ...patch,
      currentVersion: app.getVersion(),
    };

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("updater:status", currentStatus);
    }

    return currentStatus;
  }

  function wireEvents() {
    autoUpdater.on("checking-for-update", () => {
      emitStatus({
        phase: "checking",
        progress: undefined,
        message: "Checking for updates...",
      });
    });

    autoUpdater.on("update-available", (info) => {
      emitStatus({
        phase: "available",
        targetVersion: info?.version,
        progress: 0,
        message: `Update ${info?.version ?? "available"} found. Downloading...`,
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      emitStatus({
        phase: "downloading",
        progress: Math.max(0, Math.min(100, Math.round(progress.percent))),
        message: "Downloading update package...",
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      emitStatus({
        phase: "downloaded",
        progress: 100,
        targetVersion: info?.version,
        message: "Update downloaded. Restart to finish install.",
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      emitStatus({
        phase: "none",
        progress: undefined,
        targetVersion: info?.version,
        message: "No update found. You are on the latest version.",
      });
    });

    autoUpdater.on("error", (error) => {
      emitStatus({
        phase: "error",
        progress: undefined,
        message: `Updater error: ${error?.message ?? "unknown failure"}`,
      });
    });
  }

  /**
   * @returns {Promise<{ status: UpdaterPhase; version?: string }>}
   */
  async function checkForUpdates() {
    if (!app.isPackaged) {
      const status = emitStatus({
        phase: "none",
        progress: undefined,
        message: "Update checks are disabled in development builds.",
      });
      return { status: status.phase, version: status.targetVersion };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      const status = emitStatus({});
      return {
        status: status.phase,
        version: result?.updateInfo?.version,
      };
    } catch (error) {
      const status = emitStatus({
        phase: "error",
        progress: undefined,
        message: `Update check failed: ${error?.message ?? "unknown failure"}`,
      });
      return { status: status.phase, version: status.targetVersion };
    }
  }

  async function installNow() {
    if (!app.isPackaged) {
      emitStatus({
        phase: "none",
        message: "Install action is unavailable in development builds.",
      });
      return;
    }

    autoUpdater.quitAndInstall();
  }

  /**
   * @returns {Promise<{ mode: "update" | "reinstall" | "manual" }>}
   */
  async function repairInstallation() {
    if (repairInFlight) {
      return { mode: "manual" };
    }

    repairInFlight = true;
    try {
      const checkResult = await checkForUpdates();
      if (
        checkResult.status === "available" ||
        checkResult.status === "downloading" ||
        checkResult.status === "downloaded"
      ) {
        return { mode: "update" };
      }

      if (process.platform !== "win32") {
        await shell.openExternal(LATEST_RELEASE_URL);
        emitStatus({
          phase: "none",
          message:
            "No newer update. Opened latest release page for manual reinstall.",
        });
        return { mode: "manual" };
      }

      emitStatus({
        phase: "checking",
        progress: undefined,
        message: "Downloading repair installer...",
      });
      const installerPath = await downloadLatestWindowsInstaller();
      emitStatus({
        phase: "none",
        progress: undefined,
        message: "Launching repair installer...",
      });
      spawn(installerPath, [], { detached: true, stdio: "ignore" }).unref();
      setTimeout(() => app.quit(), 250);
      return { mode: "reinstall" };
    } catch (error) {
      emitStatus({
        phase: "error",
        progress: undefined,
        message: `Repair failed: ${error?.message ?? "unknown failure"}`,
      });
      return { mode: "manual" };
    } finally {
      repairInFlight = false;
    }
  }

  /**
   * @returns {UpdaterStatusPayload}
   */
  function getStatus() {
    return currentStatus;
  }

  function scheduleStartupCheck() {
    if (!app.isPackaged) {
      return;
    }

    setTimeout(() => {
      void checkForUpdates();
    }, 6000);
  }

  /**
   * @returns {Promise<string>}
   */
  async function downloadLatestWindowsInstaller() {
    const yml = await fetchText(WINDOWS_LATEST_YML_URL);
    const metadata = parseLatestYml(yml);
    const installerUrl =
      `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/${metadata.path}`;
    const tempDir = path.join(app.getPath("temp"), "ZeroHourRepair");
    await fsPromises.mkdir(tempDir, { recursive: true });
    const installerPath = path.join(tempDir, metadata.path);
    await downloadFile(installerUrl, installerPath);
    await verifySha512(installerPath, metadata.sha512);
    return installerPath;
  }

  wireEvents();

  return {
    checkForUpdates,
    installNow,
    repairInstallation,
    getStatus,
    scheduleStartupCheck,
  };
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/plain, text/yaml, */*" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.text();
}

/**
 * @param {string} url
 * @param {string} destinationPath
 * @returns {Promise<void>}
 */
async function downloadFile(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }

  const writeStream = fs.createWriteStream(destinationPath);
  await pipeline(Readable.fromWeb(response.body), writeStream);
}

/**
 * @param {string} filePath
 * @param {string} expectedSha512
 * @returns {Promise<void>}
 */
async function verifySha512(filePath, expectedSha512) {
  const file = await fsPromises.readFile(filePath);
  const digest = createHash("sha512").update(file).digest("base64");
  if (digest !== expectedSha512) {
    throw new Error("Installer checksum verification failed.");
  }
}

/**
 * @param {string} content
 * @returns {{ path: string; sha512: string }}
 */
function parseLatestYml(content) {
  const pathMatch = content.match(/^path:\s*(.+)$/m);
  const shaMatch = content.match(/^sha512:\s*(.+)$/m);
  if (!pathMatch || !shaMatch) {
    throw new Error("Invalid latest.yml metadata for repair.");
  }

  return {
    path: pathMatch[1].trim().replace(/^["']|["']$/g, ""),
    sha512: shaMatch[1].trim().replace(/^["']|["']$/g, ""),
  };
}

module.exports = {
  createUpdaterService,
};
