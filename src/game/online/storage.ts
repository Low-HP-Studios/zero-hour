import type { StoredHostedMatchConfig, StoredOnlineAuth } from "./types";

const ONLINE_AUTH_STORAGE_KEY = "greytrace:online-auth:v1";
const HOSTED_MATCH_CONFIG_STORAGE_KEY = "greytrace:hosted-match-config:v1";

export function loadStoredOnlineAuth(): StoredOnlineAuth | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(ONLINE_AUTH_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredOnlineAuth>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.user?.id !== "string" ||
      typeof parsed.user?.username !== "string" ||
      typeof parsed.user?.createdAt !== "string"
    ) {
      return null;
    }

    return {
      token: parsed.token,
      user: {
        id: parsed.user.id,
        username: parsed.user.username,
        createdAt: parsed.user.createdAt,
      },
    };
  } catch {
    return null;
  }
}

export function saveStoredOnlineAuth(value: StoredOnlineAuth) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ONLINE_AUTH_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep the menu usable.
  }
}

export function clearStoredOnlineAuth() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(ONLINE_AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep the menu usable.
  }
}

export function loadStoredHostedMatchConfig(): StoredHostedMatchConfig | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(HOSTED_MATCH_CONFIG_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredHostedMatchConfig>;
    if (
      typeof parsed.hostAddress !== "string" ||
      typeof parsed.hostPort !== "number" ||
      !Number.isInteger(parsed.hostPort)
    ) {
      return null;
    }

    return {
      hostAddress: parsed.hostAddress,
      hostPort: parsed.hostPort,
    };
  } catch {
    return null;
  }
}

export function saveStoredHostedMatchConfig(value: StoredHostedMatchConfig) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(HOSTED_MATCH_CONFIG_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures and keep the menu usable.
  }
}
