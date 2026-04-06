import type { MapId } from "../types";
import type { CharacterAnimState } from "../scene/scene-constants";

export type LobbySize = 2 | 4 | 8;

export type OnlineUser = {
  id: string;
  username: string;
  createdAt: string;
};

export type MatchEndedReason =
  | "host_disconnected"
  | "player_disconnected"
  | "host_left"
  | "player_left"
  | "host_ended_match"
  | "player_ended_match";

export type OnlineActiveMatchSlot = {
  userId: string;
  slotIndex: number;
  selectedCharacterId: string;
};

export type OnlineActiveMatch = {
  startedAt: string;
  hostAddress: string;
  hostPort: number;
  protocolVersion: number;
  slots: OnlineActiveMatchSlot[];
};

export type OnlineMatchPlayerState = {
  userId: string;
  slotIndex: number;
  health: number;
  alive: boolean;
  respawnAt: string | null;
  magAmmo: number;
  reloadingUntil: string | null;
};

export type OnlineMatchState = {
  startedAt: string;
  mapId: "map1";
  players: OnlineMatchPlayerState[];
};

export type OnlineRealtimePlayerState = {
  userId: string;
  slotIndex: number;
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  bodyYaw: number;
  pitch: number;
  moving: boolean;
  sprinting: boolean;
  crouched: boolean;
  grounded: boolean;
  ads: boolean;
  animState: CharacterAnimState;
  locomotionScale: number;
  lowerBodyState: CharacterAnimState | null;
  lowerBodyLocomotionScale: number;
  upperBodyState: CharacterAnimState | null;
  alive: boolean;
};

export type OnlineMatchInputFrame = Omit<
  OnlineRealtimePlayerState,
  "userId" | "slotIndex" | "alive"
>;

export type OnlineShotHit = {
  userId: string;
  zone: "head" | "body" | "leg";
  damage: number;
  remainingHealth: number;
  killed: boolean;
  impactPoint: [number, number, number];
};

export type OnlineShotFiredEvent = {
  userId: string;
  shotId: string;
  origin: [number, number, number];
  direction: [number, number, number];
  hit: OnlineShotHit | null;
};

export type OnlineFireIntent = {
  shotId: string;
  origin: [number, number, number];
  direction: [number, number, number];
};

export type OnlineHostedMatchSnapshot = {
  matchState: OnlineMatchState | null;
  playerStates: OnlineRealtimePlayerState[];
  latestShotEvent: OnlineShotFiredEvent | null;
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
  lastMatchEndedReason: MatchEndedReason | null;
  players: OnlineLobbyPlayer[];
};

export type HostedMatchRole = "idle" | "host" | "client";

export type HostedMatchConnectionState = {
  status: RealtimeStatus;
  role: HostedMatchRole;
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

export type StoredHostedMatchConfig = {
  hostAddress: string;
  hostPort: number;
};

export type OnlineController = {
  multiplayerSupported: boolean;
  backendStatus: BackendStatus;
  realtimeStatus: RealtimeStatus;
  pingMs: number | null;
  hostAddress: string;
  hostPort: number;
  bootstrapComplete: boolean;
  authStatus: AuthStatus;
  authBusyAction: AuthBusyAction;
  lobbyBusyAction: LobbyBusyAction;
  notice: string | null;
  user: OnlineUser | null;
  lobby: OnlineLobby | null;
  activeMatch: OnlineActiveMatch | null;
  matchState: OnlineMatchState | null;
  realtimePlayers: OnlineRealtimePlayerState[];
  latestShotEvent: OnlineShotFiredEvent | null;
  refreshConnection: () => Promise<boolean>;
  setHostAddress: (value: string) => void;
  setHostPort: (value: number) => void;
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
  sendInputFrame: (state: OnlineMatchInputFrame) => void;
  sendFireIntent: (intent: OnlineFireIntent) => void;
  sendReloadIntent: (requestId: string) => void;
};
