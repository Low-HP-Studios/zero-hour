import { ConvexHttpClient } from "convex/browser";
import { ConvexReactClient } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../../greytrace-backend/convex/_generated/api.js";
import type { MapId } from "../types";
import type {
  HostedMatchConnectionState,
  MatchEndedReason,
  OnlineFireIntent,
  OnlineHostedMatchSnapshot,
  OnlineLobby,
  OnlineMatchInputFrame,
  OnlineMatchState,
  OnlineRealtimePlayerState,
  OnlineShotFiredEvent,
  OnlineUser,
} from "./types";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL?.trim() || "";
const NETWORK_ERROR_MESSAGE =
  "Unable to reach the Greytrace Convex backend. Start it or point VITE_CONVEX_URL at a live deployment.";

type StructuredErrorData = {
  statusCode: number;
  message: string;
};

type QueryWatch<TResult> = {
  onUpdate: (callback: () => void) => () => void;
  localQueryResult: () => TResult | undefined;
};

type WatchCallbacks<TResult> = {
  onResult: (result: TResult) => void;
  onError: (error: OnlineApiError) => void;
};

export type RealtimeConnectionState = ReturnType<ConvexReactClient["connectionState"]>;

type ServerActiveMatch = NonNullable<OnlineLobby["activeMatch"]>;
type ServerLobby = Omit<OnlineLobby, "selectedMapId" | "activeMatch"> & {
  selectedMapId: string;
  activeMatch: ServerActiveMatch | null;
};

type ServerRealtimePlayerState = Omit<
  OnlineRealtimePlayerState,
  "animState" | "lowerBodyState" | "upperBodyState"
> & {
  animState: string;
  lowerBodyState: string | null;
  upperBodyState: string | null;
};

type ServerMatchState = Omit<OnlineMatchState, "mapId"> & {
  mapId: string;
};

type ServerShotFiredEvent = OnlineShotFiredEvent;

let httpClient: ConvexHttpClient | null = null;
let realtimeClient: ConvexReactClient | null = null;

export class OnlineApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OnlineApiError";
    this.status = status;
  }
}

function isStructuredErrorData(value: unknown): value is StructuredErrorData {
  return typeof value === "object" &&
    value !== null &&
    "statusCode" in value &&
    typeof value.statusCode === "number" &&
    "message" in value &&
    typeof value.message === "string";
}

function normalizeError(error: unknown, fallbackMessage = NETWORK_ERROR_MESSAGE) {
  if (error instanceof OnlineApiError) {
    return error;
  }

  if (error instanceof ConvexError) {
    const { data } = error as ConvexError<any>;
    if (isStructuredErrorData(data)) {
      return new OnlineApiError(data.message, data.statusCode);
    }
    if (typeof data === "string" && data.trim()) {
      return new OnlineApiError(data, 500);
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      !message ||
      message === "Failed to fetch" ||
      message.includes("NetworkError") ||
      message.includes("fetch failed")
    ) {
      return new OnlineApiError(fallbackMessage, 0);
    }
    return new OnlineApiError(message, 500);
  }

  return new OnlineApiError(fallbackMessage, 0);
}

function requireConvexUrl() {
  if (!CONVEX_URL) {
    throw new OnlineApiError(
      "VITE_CONVEX_URL is missing. Point the game client at the Convex deployment first.",
      0,
    );
  }

  return CONVEX_URL;
}

function getHttpClient() {
  const url = requireConvexUrl();
  if (!httpClient) {
    httpClient = new ConvexHttpClient(url, {
      logger: false,
    });
  }
  return httpClient;
}

function getRealtimeClient() {
  const url = requireConvexUrl();
  if (!realtimeClient) {
    realtimeClient = new ConvexReactClient(url, {
      logger: false,
      unsavedChangesWarning: false,
    });
  }
  return realtimeClient;
}

function requireHostedMultiplayerApi() {
  const hostedApi = window.electronAPI?.multiplayer;
  if (!hostedApi) {
    throw new OnlineApiError(
      "Hosted multiplayer is only available in the Electron desktop build.",
      400,
    );
  }
  return hostedApi;
}

async function runQuery<TResult>(callback: () => Promise<TResult>) {
  try {
    return await callback();
  } catch (error) {
    throw normalizeError(error);
  }
}

async function runHosted<TResult>(callback: () => Promise<TResult>) {
  try {
    return await callback();
  } catch (error) {
    throw normalizeError(
      error,
      "Hosted multiplayer service failed. The desktop shell is having a networking moment.",
    );
  }
}

async function runMutation<TResult>(callback: () => Promise<TResult>) {
  try {
    return await callback();
  } catch (error) {
    throw normalizeError(error);
  }
}

function watchQuery<TResult>(
  createWatch: () => QueryWatch<TResult>,
  callbacks: WatchCallbacks<TResult>,
) {
  const watch = createWatch();
  const applyCurrentResult = () => {
    try {
      const result = watch.localQueryResult();
      if (result !== undefined) {
        callbacks.onResult(result);
      }
    } catch (error) {
      callbacks.onError(normalizeError(error));
    }
  };

  const unsubscribe = watch.onUpdate(applyCurrentResult);
  applyCurrentResult();
  return unsubscribe;
}

function normalizeLobby(lobby: ServerLobby | null): OnlineLobby | null {
  if (!lobby) {
    return null;
  }

  return {
    ...lobby,
    selectedMapId: lobby.selectedMapId as MapId,
  };
}

function normalizeMatchState(matchState: ServerMatchState | null): OnlineMatchState | null {
  if (!matchState) {
    return null;
  }

  return {
    ...matchState,
    mapId: matchState.mapId as OnlineMatchState["mapId"],
  };
}

function normalizeRealtimePlayerState(
  player: ServerRealtimePlayerState,
): OnlineRealtimePlayerState {
  return {
    ...player,
    animState: player.animState as OnlineRealtimePlayerState["animState"],
    lowerBodyState: player.lowerBodyState as OnlineRealtimePlayerState["lowerBodyState"],
    upperBodyState: player.upperBodyState as OnlineRealtimePlayerState["upperBodyState"],
  };
}

function normalizeShotFiredEvent(shot: ServerShotFiredEvent | null): OnlineShotFiredEvent | null {
  return shot;
}

function normalizeHostedSnapshot(view: OnlineHostedMatchSnapshot | null): OnlineHostedMatchSnapshot | null {
  if (!view) {
    return null;
  }

  return {
    matchState: normalizeMatchState(view.matchState as ServerMatchState | null),
    playerStates: view.playerStates.map(normalizeRealtimePlayerState),
    latestShotEvent: normalizeShotFiredEvent(view.latestShotEvent),
  };
}

export function subscribeRealtimeConnectionState(
  callback: (state: RealtimeConnectionState) => void,
) {
  const client = getRealtimeClient();
  callback(client.connectionState());
  return client.subscribeToConnectionState(callback);
}

export function signUpRequest(username: string, password: string) {
  return runMutation(() =>
    getHttpClient().mutation(api.auth.signUp, {
      username,
      password,
    })
  );
}

export function healthRequest() {
  return runQuery(async () => {
    await getHttpClient().query(api.auth.getSession, {
      sessionToken: "",
    });
    return { ok: true as const };
  });
}

export function signInRequest(username: string, password: string) {
  return runMutation(() =>
    getHttpClient().mutation(api.auth.signIn, {
      username,
      password,
    })
  );
}

export function getSessionRequest(token: string) {
  return runQuery<{ user: OnlineUser } | null>(() =>
    getHttpClient().query(api.auth.getSession, {
      sessionToken: token,
    })
  );
}

export function logoutRequest(token: string) {
  return runMutation(() =>
    getHttpClient().mutation(api.auth.logout, {
      sessionToken: token,
    })
  );
}

export function getCurrentLobbyRequest(token: string) {
  return runQuery(async () => {
    const result = await getHttpClient().query(api.lobbies.getCurrentLobby, {
      sessionToken: token,
    });
    return { lobby: normalizeLobby(result.lobby as ServerLobby | null) };
  });
}

export function createMultiplayerLobbyRequest(
  token: string,
  maxPlayers: 2,
  selectedCharacterId: string,
  selectedMapId: MapId,
) {
  return runMutation(async () =>
    normalizeLobby(await getHttpClient().mutation(api.lobbies.createLobby, {
      sessionToken: token,
      maxPlayers,
      selectedCharacterId,
      selectedMapId,
    }) as ServerLobby)!
  );
}

export function joinLobbyRequest(token: string, code: string, selectedCharacterId: string) {
  return runMutation(async () =>
    normalizeLobby(await getHttpClient().mutation(api.lobbies.joinLobby, {
      sessionToken: token,
      code,
      selectedCharacterId,
    }) as ServerLobby)!
  );
}

export function getLobbyRequest(token: string, code: string) {
  return runQuery(async () =>
    normalizeLobby(await getHttpClient().query(api.lobbies.getLobby, {
      sessionToken: token,
      code,
    }) as ServerLobby)
  );
}

export function setReadyRequest(token: string, code: string, ready: boolean) {
  return runMutation(async () =>
    normalizeLobby(await getHttpClient().mutation(api.lobbies.setReady, {
      sessionToken: token,
      code,
      ready,
    }) as ServerLobby)!
  );
}

export function setLobbyCharacterRequest(token: string, code: string, selectedCharacterId: string) {
  return runMutation(async () =>
    normalizeLobby(await getHttpClient().mutation(api.lobbies.setCharacter, {
      sessionToken: token,
      code,
      selectedCharacterId,
    }) as ServerLobby)!
  );
}

export function setLobbyMapRequest(token: string, code: string, selectedMapId: MapId) {
  return runMutation(async () =>
    normalizeLobby(await getHttpClient().mutation(api.lobbies.setMap, {
      sessionToken: token,
      code,
      selectedMapId,
    }) as ServerLobby)!
  );
}

export function startMatchRequest(
  token: string,
  code: string,
  hostAddress: string,
  hostPort: number,
) {
  return runMutation(() =>
    getHttpClient().mutation(api.lobbies.startMatch, {
      sessionToken: token,
      code,
      hostAddress,
      hostPort,
    })
  );
}

export function endMatchRequest(token: string, code: string) {
  return runMutation(() =>
    getHttpClient().mutation(api.lobbies.endMatch, {
      sessionToken: token,
      code,
    })
  );
}

export function leaveLobbyRequest(token: string, code: string) {
  return runMutation(() =>
    getHttpClient().mutation(api.lobbies.leaveLobby, {
      sessionToken: token,
      code,
    })
  );
}

export function disbandLobbyRequest(token: string, code: string) {
  return runMutation(() =>
    getHttpClient().mutation(api.lobbies.disbandLobby, {
      sessionToken: token,
      code,
    })
  );
}

export function finalizeHostedMatchRequest(
  token: string,
  code: string,
  reason: MatchEndedReason,
) {
  return runMutation(() =>
    getHttpClient().mutation(api.lobbies.finalizeHostedMatch, {
      sessionToken: token,
      code,
      reason,
    })
  );
}

export function heartbeatRequest(token: string, lobbyCode: string) {
  return runMutation(() =>
    getRealtimeClient().mutation(api.presence.heartbeat, {
      sessionToken: token,
      lobbyCode,
    })
  );
}

export function watchCurrentLobby(
  token: string,
  callbacks: WatchCallbacks<{ lobby: OnlineLobby | null }>,
) {
  return watchQuery(
    () =>
      getRealtimeClient().watchQuery(api.lobbies.getCurrentLobby, {
        sessionToken: token,
      }),
    {
      onResult: (result) => callbacks.onResult({
        lobby: normalizeLobby(result.lobby as ServerLobby | null),
      }),
      onError: callbacks.onError,
    },
  );
}

export function hostMatchRequest(payload: {
  lobbyCode: string;
  mapId: "map1";
  startedAt: string;
  localUserId: string;
  hostPort: number;
  slots: NonNullable<OnlineLobby["activeMatch"]>["slots"];
}) {
  return runHosted(() => requireHostedMultiplayerApi().hostMatch(payload));
}

export function joinHostedMatchRequest(payload: {
  lobbyCode: string;
  localUserId: string;
  hostAddress: string;
  hostPort: number;
}) {
  return runHosted(() => requireHostedMultiplayerApi().joinMatch(payload));
}

export function leaveHostedMatchRequest(payload?: {
  reason?: MatchEndedReason | null;
  notifyRemote?: boolean;
}) {
  return runHosted(() => requireHostedMultiplayerApi().leaveMatch(payload ?? {}));
}

export function sendHostedInputFrameRequest(frame: OnlineMatchInputFrame) {
  return runHosted(() => requireHostedMultiplayerApi().sendInputFrame(frame));
}

export function sendHostedFireIntentRequest(intent: OnlineFireIntent) {
  return runHosted(() => requireHostedMultiplayerApi().sendFireIntent(intent));
}

export function sendHostedReloadIntentRequest(requestId: string) {
  return runHosted(() =>
    requireHostedMultiplayerApi().sendReloadIntent({ requestId })
  );
}

export function subscribeHostedConnectionState(
  callback: (state: HostedMatchConnectionState) => void,
) {
  return requireHostedMultiplayerApi().onConnectionState(callback);
}

export function subscribeHostedSnapshot(
  callback: (snapshot: OnlineHostedMatchSnapshot) => void,
) {
  return requireHostedMultiplayerApi().onSnapshot((snapshot) => {
    const normalized = normalizeHostedSnapshot(snapshot as OnlineHostedMatchSnapshot | null);
    if (normalized) {
      callback(normalized);
    }
  });
}

export function subscribeHostedMatchEnded(
  callback: (reason: MatchEndedReason) => void,
) {
  return requireHostedMultiplayerApi().onMatchEnded((payload) => {
    callback(payload.reason as MatchEndedReason);
  });
}
