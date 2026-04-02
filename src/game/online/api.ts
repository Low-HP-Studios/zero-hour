import type { MapId } from "../types";
import type { OnlineLobby, OnlineUser } from "./types";

const DEFAULT_API_BASE_URL = "http://localhost:8787";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL)
  .replace(/\/$/, "");
const REALTIME_URL = API_BASE_URL.replace(/^http/i, "ws") + "/realtime";

type JsonValue = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: JsonValue;
  token?: string;
};

export class OnlineApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OnlineApiError";
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new OnlineApiError(
      "Unable to reach the Greytrace backend. Start the lobby service and try again.",
      0,
    );
  }

  const rawText = await response.text();
  let data: JsonValue = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText) as JsonValue;
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
      ? data.message
      : "Request failed.";

    throw new OnlineApiError(message, response.status);
  }

  return data as T;
}

export function signUpRequest(username: string, password: string) {
  return request<{ token: string; user: OnlineUser }>("/auth/signup", {
    method: "POST",
    body: { username, password },
  });
}

export function healthRequest() {
  return request<{ ok: true }>("/health");
}

export function signInRequest(username: string, password: string) {
  return request<{ token: string; user: OnlineUser }>("/auth/login", {
    method: "POST",
    body: { username, password },
  });
}

export function getSessionRequest(token: string) {
  return request<{ user: OnlineUser }>("/auth/session", {
    token,
  });
}

export function logoutRequest(token: string) {
  return request<{ ok: boolean }>("/auth/logout", {
    method: "POST",
    token,
  });
}

export function getCurrentLobbyRequest(token: string) {
  return request<{ lobby: OnlineLobby | null }>("/lobbies/current", {
    token,
  });
}

export function createMultiplayerLobbyRequest(
  token: string,
  maxPlayers: 2,
  selectedCharacterId: string,
  selectedMapId: MapId,
) {
  return request<OnlineLobby>("/lobbies", {
    method: "POST",
    token,
    body: { maxPlayers, selectedCharacterId, selectedMapId },
  });
}

export function joinLobbyRequest(token: string, code: string, selectedCharacterId: string) {
  return request<OnlineLobby>("/lobbies/join", {
    method: "POST",
    token,
    body: { code, selectedCharacterId },
  });
}

export function getLobbyRequest(token: string, code: string) {
  return request<OnlineLobby>(`/lobbies/${encodeURIComponent(code)}`, {
    token,
  });
}

export function setReadyRequest(token: string, code: string, ready: boolean) {
  return request<OnlineLobby>(`/lobbies/${encodeURIComponent(code)}/ready`, {
    method: "POST",
    token,
    body: { ready },
  });
}

export function setLobbyCharacterRequest(token: string, code: string, selectedCharacterId: string) {
  return request<OnlineLobby>(`/lobbies/${encodeURIComponent(code)}/character`, {
    method: "POST",
    token,
    body: { selectedCharacterId },
  });
}

export function setLobbyMapRequest(token: string, code: string, selectedMapId: MapId) {
  return request<OnlineLobby>(`/lobbies/${encodeURIComponent(code)}/map`, {
    method: "POST",
    token,
    body: { selectedMapId },
  });
}

export function startMatchRequest(token: string, code: string) {
  return request<{ ok: boolean }>(`/lobbies/${encodeURIComponent(code)}/start`, {
    method: "POST",
    token,
  });
}

export function endMatchRequest(token: string, code: string) {
  return request<{ ok: boolean }>(`/lobbies/${encodeURIComponent(code)}/end-match`, {
    method: "POST",
    token,
  });
}

export function leaveLobbyRequest(token: string, code: string) {
  return request<{ ok: boolean }>(`/lobbies/${encodeURIComponent(code)}/leave`, {
    method: "POST",
    token,
  });
}

export function disbandLobbyRequest(token: string, code: string) {
  return request<{ ok: boolean }>(`/lobbies/${encodeURIComponent(code)}`, {
    method: "DELETE",
    token,
  });
}

export function connectRealtimeSocket() {
  return new WebSocket(REALTIME_URL);
}
