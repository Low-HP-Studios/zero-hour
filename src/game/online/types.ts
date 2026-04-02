import type { MapId } from "../types";

export type LobbySize = 2 | 4 | 8;

export type OnlineUser = {
  id: string;
  username: string;
  createdAt: string;
};

export type OnlineMatchSpawnSlot = "host" | "guest";

export type OnlineActiveMatchSlot = {
  userId: string;
  spawnSlot: OnlineMatchSpawnSlot;
  selectedCharacterId: string;
};

export type OnlineActiveMatch = {
  startedAt: string;
  slots: OnlineActiveMatchSlot[];
};

export type OnlineLobbyPlayer = {
  userId: string;
  username: string;
  isHost: boolean;
  isReady: boolean;
  joinedAt: string;
  selectedCharacterId: string;
};

export type OnlineLobby = {
  code: string;
  status: "open" | "in_match";
  hostUserId: string;
  maxPlayers: 2;
  selectedMapId: MapId;
  createdAt: string;
  expiresAt: string;
  activeMatch: OnlineActiveMatch | null;
  players: OnlineLobbyPlayer[];
};

export type BackendStatus = "checking" | "connected" | "unavailable";
export type AuthStatus = "checking" | "signed_out" | "authenticated";
export type RealtimeStatus = "disconnected" | "connecting" | "connected";
export type AuthBusyAction = "signup" | "login" | "logout" | null;
export type LobbyBusyAction =
  | "create"
  | "join"
  | "ready"
  | "leave"
  | "disband"
  | "character"
  | "map"
  | "start"
  | "end_match"
  | null;

export type StoredOnlineAuth = {
  token: string;
  user: OnlineUser;
};

export type OnlineController = {
  backendStatus: BackendStatus;
  realtimeStatus: RealtimeStatus;
  bootstrapComplete: boolean;
  authStatus: AuthStatus;
  authBusyAction: AuthBusyAction;
  lobbyBusyAction: LobbyBusyAction;
  notice: string | null;
  user: OnlineUser | null;
  lobby: OnlineLobby | null;
  activeMatch: OnlineActiveMatch | null;
  refreshConnection: () => Promise<boolean>;
  signUp: (username: string, password: string) => Promise<boolean>;
  signIn: (username: string, password: string) => Promise<boolean>;
  signOut: () => Promise<boolean>;
  createLobby: (maxPlayers: 2, selectedCharacterId: string, selectedMapId: MapId) => Promise<boolean>;
  joinLobby: (code: string, selectedCharacterId: string) => Promise<boolean>;
  selectLobbyCharacter: (selectedCharacterId: string) => Promise<boolean>;
  selectLobbyMap: (selectedMapId: MapId) => Promise<boolean>;
  toggleReady: (ready: boolean) => Promise<boolean>;
  startMatch: () => Promise<boolean>;
  endMatch: () => Promise<boolean>;
  leaveLobby: () => Promise<boolean>;
  disbandLobby: () => Promise<boolean>;
};
