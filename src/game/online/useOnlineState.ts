import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MapId } from "../types";
import {
  finalizeHostedMatchRequest,
  heartbeatRequest,
  healthRequest,
  hostMatchRequest,
  joinHostedMatchRequest,
  leaveHostedMatchRequest,
  OnlineApiError,
  createMultiplayerLobbyRequest,
  disbandLobbyRequest,
  endMatchRequest,
  getSessionRequest,
  joinLobbyRequest,
  leaveLobbyRequest,
  logoutRequest,
  sendHostedFireIntentRequest,
  sendHostedInputFrameRequest,
  sendHostedReloadIntentRequest,
  setLobbyCharacterRequest,
  setLobbyMapRequest,
  setReadyRequest,
  signInRequest,
  signUpRequest,
  startMatchRequest,
  subscribeHostedConnectionState,
  subscribeHostedMatchEnded,
  subscribeHostedSnapshot,
  subscribeRealtimeConnectionState,
  watchCurrentLobby,
} from "./api";
import {
  clearStoredOnlineAuth,
  loadStoredHostedMatchConfig,
  loadStoredOnlineAuth,
  saveStoredHostedMatchConfig,
  saveStoredOnlineAuth,
} from "./storage";
import type {
  AuthBusyAction,
  AuthStatus,
  BackendStatus,
  HostedMatchConnectionState,
  LobbyBusyAction,
  MatchEndedReason,
  OnlineActiveMatch,
  OnlineController,
  OnlineFireIntent,
  OnlineHostedMatchSnapshot,
  OnlineLobby,
  OnlineMatchInputFrame,
  OnlineMatchState,
  OnlineRealtimePlayerState,
  OnlineShotFiredEvent,
  OnlineUser,
  RealtimeStatus,
} from "./types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof OnlineApiError ? error.message : fallback;
}

const PRESENCE_HEARTBEAT_INTERVAL_MS = 3_000;
const PLAYER_STATE_SEND_INTERVAL_MS = 100;
const PING_SMOOTHING_FACTOR = 0.35;
const DEFAULT_HOST_PORT = 7777;

type UseOnlineStateOptions = {
  pollEnabled: boolean;
};

function buildHostedSlots(lobby: OnlineLobby) {
  const orderedPlayers = [...lobby.players].sort((left, right) => {
    if (left.isHost && !right.isHost) {
      return -1;
    }
    if (!left.isHost && right.isHost) {
      return 1;
    }
    return left.joinedAt.localeCompare(right.joinedAt);
  });

  return orderedPlayers.map((player, index) => ({
    userId: player.userId,
    slotIndex: index,
    selectedCharacterId: player.selectedCharacterId,
  }));
}

function normalizeHostPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65_535
    ? value
    : DEFAULT_HOST_PORT;
}

export function useOnlineState({ pollEnabled: _pollEnabled }: UseOnlineStateOptions): OnlineController {
  void _pollEnabled;

  const multiplayerSupported = Boolean(window.electronAPI?.multiplayer);
  const storedHostedConfig = loadStoredHostedMatchConfig();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("disconnected");
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [hostAddress, setHostAddressState] = useState<string>(
    storedHostedConfig?.hostAddress ?? "127.0.0.1",
  );
  const [hostPort, setHostPortState] = useState<number>(
    normalizeHostPort(storedHostedConfig?.hostPort ?? DEFAULT_HOST_PORT),
  );
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authBusyAction, setAuthBusyAction] = useState<AuthBusyAction>(null);
  const [lobbyBusyAction, setLobbyBusyAction] = useState<LobbyBusyAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [user, setUser] = useState<OnlineUser | null>(null);
  const [lobby, setLobby] = useState<OnlineLobby | null>(null);
  const [activeMatch, setActiveMatch] = useState<OnlineActiveMatch | null>(null);
  const [matchState, setMatchState] = useState<OnlineMatchState | null>(null);
  const [realtimePlayers, setRealtimePlayers] = useState<OnlineRealtimePlayerState[]>([]);
  const [latestShotEvent, setLatestShotEvent] = useState<OnlineShotFiredEvent | null>(null);

  const tokenRef = useRef<string | null>(null);
  const lobbyRef = useRef<OnlineLobby | null>(null);
  const authStatusRef = useRef<AuthStatus>("checking");
  const backendStatusRef = useRef<BackendStatus>("checking");
  const lobbyBusyActionRef = useRef<LobbyBusyAction>(null);
  const realtimeConnectionCleanupRef = useRef<(() => void) | null>(null);
  const lobbyWatchCleanupRef = useRef<(() => void) | null>(null);
  const hostedConnectionCleanupRef = useRef<(() => void) | null>(null);
  const hostedSnapshotCleanupRef = useRef<(() => void) | null>(null);
  const hostedMatchEndedCleanupRef = useRef<(() => void) | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const playerStateFlushTimeoutRef = useRef<number | null>(null);
  const socketConnectedRef = useRef(false);
  const heartbeatHealthyRef = useRef(false);
  const lastPlayerStateSentAtRef = useRef(0);
  const queuedInputFrameRef = useRef<OnlineMatchInputFrame | null>(null);
  const hostedConnectionStateRef = useRef<HostedMatchConnectionState>({
    status: "disconnected",
    role: "idle",
  });

  useEffect(() => {
    authStatusRef.current = authStatus;
  }, [authStatus]);

  useEffect(() => {
    backendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    lobbyBusyActionRef.current = lobbyBusyAction;
  }, [lobbyBusyAction]);

  const setHostAddress = useCallback((value: string) => {
    setHostAddressState(value);
    saveStoredHostedMatchConfig({
      hostAddress: value,
      hostPort: normalizeHostPort(hostPort),
    });
  }, [hostPort]);

  const setHostPort = useCallback((value: number) => {
    const nextPort = normalizeHostPort(value);
    setHostPortState(nextPort);
    saveStoredHostedMatchConfig({
      hostAddress,
      hostPort: nextPort,
    });
  }, [hostAddress]);

  const clearMatchRuntime = useCallback(() => {
    setMatchState(null);
    setRealtimePlayers([]);
    setLatestShotEvent(null);
  }, []);

  const clearHeartbeatInterval = useCallback(() => {
    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const clearPlayerStateFlushTimeout = useCallback(() => {
    if (playerStateFlushTimeoutRef.current !== null) {
      window.clearTimeout(playerStateFlushTimeoutRef.current);
      playerStateFlushTimeoutRef.current = null;
    }
  }, []);

  const clearRealtimeConnectionSubscription = useCallback(() => {
    if (realtimeConnectionCleanupRef.current) {
      realtimeConnectionCleanupRef.current();
      realtimeConnectionCleanupRef.current = null;
    }
  }, []);

  const clearLobbyWatch = useCallback(() => {
    if (lobbyWatchCleanupRef.current) {
      lobbyWatchCleanupRef.current();
      lobbyWatchCleanupRef.current = null;
    }
  }, []);

  const clearHostedMatchSubscriptions = useCallback(() => {
    if (hostedConnectionCleanupRef.current) {
      hostedConnectionCleanupRef.current();
      hostedConnectionCleanupRef.current = null;
    }
    if (hostedSnapshotCleanupRef.current) {
      hostedSnapshotCleanupRef.current();
      hostedSnapshotCleanupRef.current = null;
    }
    if (hostedMatchEndedCleanupRef.current) {
      hostedMatchEndedCleanupRef.current();
      hostedMatchEndedCleanupRef.current = null;
    }
  }, []);

  const updateRealtimeStatus = useCallback(() => {
    if (
      backendStatusRef.current === "unavailable" ||
      authStatusRef.current !== "authenticated" ||
      !tokenRef.current
    ) {
      setRealtimeStatus("disconnected");
      return;
    }

    if (lobbyRef.current?.status === "in_match") {
      setRealtimeStatus(hostedConnectionStateRef.current.status);
      return;
    }

    if (lobbyRef.current) {
      setRealtimeStatus(
        socketConnectedRef.current && heartbeatHealthyRef.current
          ? "connected"
          : "connecting",
      );
      return;
    }

    setRealtimeStatus(socketConnectedRef.current ? "connected" : "connecting");
  }, []);

  const syncLobbyState = useCallback((nextLobby: OnlineLobby | null) => {
    const previousLobby = lobbyRef.current;
    if (!nextLobby || previousLobby?.code !== nextLobby.code) {
      heartbeatHealthyRef.current = false;
    }

    lobbyRef.current = nextLobby;
    setLobby(nextLobby);
    setActiveMatch(nextLobby?.activeMatch ?? null);

    if (!nextLobby || nextLobby.status !== "in_match") {
      clearMatchRuntime();
    }

    updateRealtimeStatus();
  }, [clearMatchRuntime, updateRealtimeStatus]);

  const clearRealtimeState = useCallback(() => {
    clearLobbyWatch();
    clearHostedMatchSubscriptions();
    clearHeartbeatInterval();
    clearPlayerStateFlushTimeout();
    clearRealtimeConnectionSubscription();
    socketConnectedRef.current = false;
    heartbeatHealthyRef.current = false;
    queuedInputFrameRef.current = null;
    lastPlayerStateSentAtRef.current = 0;
    hostedConnectionStateRef.current = {
      status: "disconnected",
      role: "idle",
    };
    setPingMs(null);
    setRealtimeStatus("disconnected");
  }, [
    clearHeartbeatInterval,
    clearHostedMatchSubscriptions,
    clearLobbyWatch,
    clearPlayerStateFlushTimeout,
    clearRealtimeConnectionSubscription,
  ]);

  const resetAuthState = useCallback((clearStorage: boolean) => {
    if (clearStorage) {
      clearStoredOnlineAuth();
    }

    tokenRef.current = null;
    clearRealtimeState();
    setUser(null);
    syncLobbyState(null);
    setAuthStatus("signed_out");
    setAuthBusyAction(null);
    setLobbyBusyAction(null);
    clearMatchRuntime();
  }, [clearMatchRuntime, clearRealtimeState, syncLobbyState]);

  const applyAuthState = useCallback((token: string, nextUser: OnlineUser) => {
    tokenRef.current = token;
    saveStoredOnlineAuth({
      token,
      user: nextUser,
    });
    setBackendStatus("connected");
    setUser(nextUser);
    setAuthStatus("authenticated");
  }, []);

  const handleUnauthorized = useCallback((message: string) => {
    setBackendStatus("connected");
    resetAuthState(true);
    setNotice(message);
    toast.warning(message);
  }, [resetAuthState]);

  const applyHostedSnapshot = useCallback((snapshot: OnlineHostedMatchSnapshot | null | undefined) => {
    if (!snapshot) {
      return;
    }
    setMatchState(snapshot.matchState);
    setRealtimePlayers(snapshot.playerStates);
    setLatestShotEvent((previous) =>
      previous?.shotId === snapshot.latestShotEvent?.shotId
        ? previous
        : snapshot.latestShotEvent
    );
  }, []);

  const leaveHostedMatch = useCallback(async (
    reason: MatchEndedReason | null,
    notifyRemote: boolean,
  ) => {
    if (!multiplayerSupported) {
      hostedConnectionStateRef.current = {
        status: "disconnected",
        role: "idle",
      };
      updateRealtimeStatus();
      return;
    }

    try {
      await leaveHostedMatchRequest({
        reason,
        notifyRemote,
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("[Online] Hosted match shutdown failed", error);
      }
    } finally {
      hostedConnectionStateRef.current = {
        status: "disconnected",
        role: "idle",
      };
      updateRealtimeStatus();
    }
  }, [multiplayerSupported, updateRealtimeStatus]);

  const finalizeHostedMatch = useCallback(async (reason: MatchEndedReason) => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    if (!token || !currentLobby) {
      return;
    }

    try {
      await finalizeHostedMatchRequest(token, currentLobby.code, reason);
      setBackendStatus("connected");
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
        return;
      }

      if (import.meta.env.DEV) {
        console.warn("[Online] Failed to finalize hosted match", error);
      }
    }
  }, [handleUnauthorized]);

  const refreshConnection = useCallback(async () => {
    setBackendStatus("checking");
    setAuthStatus("checking");
    setAuthBusyAction(null);
    setLobbyBusyAction(null);
    setNotice(null);
    clearRealtimeState();

    const storedAuth = loadStoredOnlineAuth();
    tokenRef.current = storedAuth?.token ?? null;

    try {
      await healthRequest();
      setBackendStatus("connected");
    } catch (error) {
      setBackendStatus("unavailable");
      resetAuthState(false);
      setNotice(
        getErrorMessage(
          error,
          "Greytrace backend is unreachable right now. Multiplayer remains a rumor.",
        ),
      );
      return false;
    }

    if (!storedAuth) {
      setUser(null);
      syncLobbyState(null);
      setAuthStatus("signed_out");
      return true;
    }

    try {
      const session = await getSessionRequest(storedAuth.token);
      setBackendStatus("connected");

      if (!session) {
        resetAuthState(true);
        setNotice("Session expired. Please sign in again.");
        return true;
      }

      applyAuthState(storedAuth.token, session.user);
      setNotice(null);
      return true;
    } catch (error) {
      setBackendStatus("unavailable");
      resetAuthState(false);
      setNotice(
        getErrorMessage(
          error,
          "Greytrace backend is unreachable right now. Multiplayer remains a rumor.",
        ),
      );
      return false;
    }
  }, [applyAuthState, clearRealtimeState, resetAuthState, syncLobbyState]);

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    clearRealtimeConnectionSubscription();

    if (authStatus !== "authenticated" || !tokenRef.current) {
      socketConnectedRef.current = false;
      updateRealtimeStatus();
      return;
    }

    try {
      realtimeConnectionCleanupRef.current = subscribeRealtimeConnectionState((state) => {
        socketConnectedRef.current = state.isWebSocketConnected;
        if (state.isWebSocketConnected) {
          setBackendStatus("connected");
        }
        updateRealtimeStatus();
      });
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Realtime wiring failed to come online. Convex wants another coffee.",
      );
      socketConnectedRef.current = false;
      setBackendStatus("unavailable");
      setNotice(message);
      updateRealtimeStatus();
    }

    return clearRealtimeConnectionSubscription;
  }, [authStatus, clearRealtimeConnectionSubscription, updateRealtimeStatus]);

  useEffect(() => {
    clearLobbyWatch();

    if (authStatus !== "authenticated" || !tokenRef.current) {
      syncLobbyState(null);
      return;
    }

    try {
      lobbyWatchCleanupRef.current = watchCurrentLobby(tokenRef.current, {
        onResult: ({ lobby: nextLobby }) => {
          const previousLobby = lobbyRef.current;
          const previousMatchStartedAt = previousLobby?.activeMatch?.startedAt ?? null;

          setBackendStatus("connected");
          syncLobbyState(nextLobby);

          if (!nextLobby) {
            if (
              previousLobby?.code &&
              lobbyBusyActionRef.current !== "leave" &&
              lobbyBusyActionRef.current !== "disband"
            ) {
              const message = "Lobby closed or expired.";
              setNotice(message);
              toast.info(message);
            } else {
              setNotice(null);
            }
            return;
          }

          if (nextLobby.activeMatch && nextLobby.activeMatch.startedAt !== previousMatchStartedAt) {
            setNotice(null);
            toast.success("Match starting.");
            return;
          }

          if (previousMatchStartedAt && !nextLobby.activeMatch) {
            const message = "Match ended. Back to the lobby.";
            setNotice(message);
            toast.info(message);
            return;
          }

          setNotice(null);
        },
        onError: (error) => {
          if (error.status === 401) {
            handleUnauthorized(error.message);
            return;
          }

          if (error.status === 0) {
            setBackendStatus("unavailable");
            return;
          }

          setNotice(error.message);
        },
      });
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Failed to subscribe to lobby updates. The backend moved and did not leave a note.",
      );
      setBackendStatus("unavailable");
      setNotice(message);
    }

    return clearLobbyWatch;
  }, [authStatus, clearLobbyWatch, handleUnauthorized, syncLobbyState]);

  useEffect(() => {
    clearHostedMatchSubscriptions();
    hostedConnectionStateRef.current = {
      status: "disconnected",
      role: "idle",
    };
    updateRealtimeStatus();

    const token = tokenRef.current;
    const currentLobby = lobby;
    const currentUser = user;
    if (
      authStatus !== "authenticated" ||
      !token ||
      !currentLobby?.code ||
      currentLobby.status !== "in_match" ||
      !currentLobby.activeMatch ||
      !currentUser
    ) {
      return;
    }

    if (!multiplayerSupported) {
      setNotice("Hosted multiplayer is only available in the desktop build.");
      return;
    }

    const role = currentLobby.hostUserId === currentUser.id ? "host" : "client";
    const activeMatch = currentLobby.activeMatch;

    hostedConnectionCleanupRef.current = subscribeHostedConnectionState((state) => {
      hostedConnectionStateRef.current = state;
      updateRealtimeStatus();
    });
    hostedSnapshotCleanupRef.current = subscribeHostedSnapshot((snapshot) => {
      setBackendStatus("connected");
      applyHostedSnapshot(snapshot);
    });
    hostedMatchEndedCleanupRef.current = subscribeHostedMatchEnded((reason) => {
      clearMatchRuntime();
      setNotice("Match ended. Back to the lobby.");
      void finalizeHostedMatch(reason);
    });

    hostedConnectionStateRef.current = {
      status: "connecting",
      role,
    };
    updateRealtimeStatus();

    void (async () => {
      try {
        if (role === "host") {
          await hostMatchRequest({
            lobbyCode: currentLobby.code,
            mapId: currentLobby.selectedMapId as "map1",
            startedAt: activeMatch.startedAt,
            localUserId: currentUser.id,
            hostPort: activeMatch.hostPort,
            slots: activeMatch.slots,
          });
        } else {
          await joinHostedMatchRequest({
            lobbyCode: currentLobby.code,
            localUserId: currentUser.id,
            hostAddress: activeMatch.hostAddress,
            hostPort: activeMatch.hostPort,
          });
        }
        setBackendStatus("connected");
      } catch (error) {
        const message = getErrorMessage(error, "Failed to start the hosted match session.");
        setNotice(message);
        toast.error(message);
      }
    })();

    return () => {
      clearHostedMatchSubscriptions();
      void leaveHostedMatch(null, false);
    };
  }, [
    applyHostedSnapshot,
    authStatus,
    clearHostedMatchSubscriptions,
    clearMatchRuntime,
    finalizeHostedMatch,
    leaveHostedMatch,
    lobby,
    multiplayerSupported,
    updateRealtimeStatus,
    user,
  ]);

  useEffect(() => {
    clearHeartbeatInterval();
    heartbeatHealthyRef.current = false;
    updateRealtimeStatus();

    const token = tokenRef.current;
    if (lobby?.status === "in_match") {
      setPingMs(null);
      return;
    }

    if (authStatus !== "authenticated" || !token || !lobby?.code) {
      return;
    }

    let cancelled = false;
    const lobbyCode = lobby.code;

    const sendHeartbeat = async () => {
      const startedAt = performance.now();
      try {
        await heartbeatRequest(token, lobbyCode);
        if (cancelled) {
          return;
        }

        setBackendStatus("connected");
        heartbeatHealthyRef.current = true;
        const sampleMs = Math.max(1, Math.round(performance.now() - startedAt));
        setPingMs((previous) =>
          previous === null
            ? sampleMs
            : Math.round(previous + (sampleMs - previous) * PING_SMOOTHING_FACTOR)
        );
        updateRealtimeStatus();
      } catch (error) {
        if (cancelled) {
          return;
        }

        const normalized = error instanceof OnlineApiError
          ? error
          : new OnlineApiError("Realtime heartbeat failed.", 500);

        heartbeatHealthyRef.current = false;
        setPingMs(null);
        updateRealtimeStatus();

        if (normalized.status === 401) {
          handleUnauthorized(normalized.message);
          return;
        }

        if (normalized.status === 404) {
          syncLobbyState(null);
          setNotice("Lobby closed or expired.");
          return;
        }

        if (normalized.status === 0) {
          setBackendStatus("unavailable");
        }
      }
    };

    void sendHeartbeat();
    heartbeatIntervalRef.current = window.setInterval(() => {
      void sendHeartbeat();
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearHeartbeatInterval();
    };
  }, [
    authStatus,
    clearHeartbeatInterval,
    handleUnauthorized,
    lobby?.code,
    syncLobbyState,
    updateRealtimeStatus,
  ]);

  useEffect(() => () => {
    clearRealtimeState();
  }, [clearRealtimeState]);

  const signUp = useCallback(async (username: string, password: string) => {
    setAuthBusyAction("signup");

    try {
      const response = await signUpRequest(username, password);
      applyAuthState(response.token, response.user);
      syncLobbyState(null);
      setNotice(null);
      toast.success(`Account ready. Welcome, ${response.user.username}.`);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      const message = getErrorMessage(error, "Could not create that account.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setAuthBusyAction(null);
    }
  }, [applyAuthState, syncLobbyState]);

  const signIn = useCallback(async (username: string, password: string) => {
    setAuthBusyAction("login");

    try {
      const response = await signInRequest(username, password);
      applyAuthState(response.token, response.user);
      syncLobbyState(null);
      setNotice(null);
      toast.success(`Signed in as ${response.user.username}.`);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      const message = getErrorMessage(error, "Could not sign in.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setAuthBusyAction(null);
    }
  }, [applyAuthState, syncLobbyState]);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    const currentUser = user;
    setAuthBusyAction("logout");

    try {
      if (token && currentLobby && currentUser) {
        const isHost = currentLobby.hostUserId === currentUser.id;
        const matchLeaveReason: MatchEndedReason = isHost ? "host_left" : "player_left";

        if (currentLobby.status === "in_match") {
          await leaveHostedMatch(matchLeaveReason, true);
        }

        if (isHost) {
          await disbandLobbyRequest(token, currentLobby.code);
        } else {
          await leaveLobbyRequest(token, currentLobby.code);
        }
        clearMatchRuntime();
        syncLobbyState(null);
      }
      if (token) {
        await logoutRequest(token);
      }
    } catch (error) {
      if (!(error instanceof OnlineApiError && error.status === 401)) {
        toast.error(
          getErrorMessage(error, "Sign out hit a backend issue. Local session cleared anyway."),
        );
      }
    } finally {
      setBackendStatus("connected");
      resetAuthState(true);
      setNotice(null);
      setAuthBusyAction(null);
      toast.success("Signed out.");
    }

    return true;
  }, [clearMatchRuntime, leaveHostedMatch, resetAuthState, syncLobbyState, user]);

  const createLobby = useCallback(async (
    maxPlayers: 2,
    selectedCharacterId: string,
    selectedMapId: MapId,
  ) => {
    if (!multiplayerSupported) {
      const message = "Hosted multiplayer is only available in the desktop build.";
      setNotice(message);
      toast.info(message);
      return false;
    }

    const token = tokenRef.current;
    if (!token) {
      handleUnauthorized("Session missing. Please sign in again.");
      return false;
    }

    setLobbyBusyAction("create");

    try {
      const nextLobby = await createMultiplayerLobbyRequest(
        token,
        maxPlayers,
        selectedCharacterId,
        selectedMapId,
      );
      setBackendStatus("connected");
      syncLobbyState(nextLobby);
      setNotice(null);
      toast.success(`Lobby ${nextLobby.code} created.`);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      const message = getErrorMessage(error, "Could not create a lobby.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [handleUnauthorized, multiplayerSupported, syncLobbyState]);

  const joinLobby = useCallback(async (code: string, selectedCharacterId: string) => {
    if (!multiplayerSupported) {
      const message = "Hosted multiplayer is only available in the desktop build.";
      setNotice(message);
      toast.info(message);
      return false;
    }

    const token = tokenRef.current;
    if (!token) {
      handleUnauthorized("Session missing. Please sign in again.");
      return false;
    }

    setLobbyBusyAction("join");

    try {
      const nextLobby = await joinLobbyRequest(token, code, selectedCharacterId);
      setBackendStatus("connected");
      syncLobbyState(nextLobby);
      setNotice(null);
      toast.success(`Joined lobby ${nextLobby.code}.`);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      const message = getErrorMessage(error, "Could not join that lobby.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [handleUnauthorized, multiplayerSupported, syncLobbyState]);

  const selectLobbyCharacter = useCallback(async (selectedCharacterId: string) => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    if (!token || !currentLobby) {
      return false;
    }

    setLobbyBusyAction("character");

    try {
      const nextLobby = await setLobbyCharacterRequest(token, currentLobby.code, selectedCharacterId);
      setBackendStatus("connected");
      syncLobbyState(nextLobby);
      setNotice(null);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      const message = getErrorMessage(error, "Could not update your character.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [handleUnauthorized, syncLobbyState]);

  const selectLobbyMap = useCallback(async (selectedMapId: MapId) => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    if (!token || !currentLobby) {
      return false;
    }

    setLobbyBusyAction("map");

    try {
      const nextLobby = await setLobbyMapRequest(token, currentLobby.code, selectedMapId);
      setBackendStatus("connected");
      syncLobbyState(nextLobby);
      setNotice(null);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      const message = getErrorMessage(error, "Could not update the lobby map.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [handleUnauthorized, syncLobbyState]);

  const toggleReady = useCallback(async (ready: boolean) => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    if (!token || !currentLobby) {
      return false;
    }

    setLobbyBusyAction("ready");

    try {
      const nextLobby = await setReadyRequest(token, currentLobby.code, ready);
      setBackendStatus("connected");
      syncLobbyState(nextLobby);
      setNotice(null);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      const message = getErrorMessage(error, "Could not update ready state.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [handleUnauthorized, syncLobbyState]);

  const startMatch = useCallback(async () => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    const currentUser = user;
    if (!token || !currentLobby || !currentUser) {
      return false;
    }

    if (!multiplayerSupported) {
      const message = "Hosted multiplayer is only available in the desktop build.";
      setNotice(message);
      toast.info(message);
      return false;
    }

    if (currentLobby.hostUserId !== currentUser.id) {
      const message = "Only the host can start the match.";
      setNotice(message);
      toast.warning(message);
      return false;
    }

    const normalizedAddress = hostAddress.trim();
    const normalizedPort = normalizeHostPort(hostPort);
    if (!normalizedAddress) {
      const message = "Enter the host address before starting the match.";
      setNotice(message);
      toast.error(message);
      return false;
    }

    setLobbyBusyAction("start");

    try {
      saveStoredHostedMatchConfig({
        hostAddress: normalizedAddress,
        hostPort: normalizedPort,
      });
      setHostAddressState(normalizedAddress);
      setHostPortState(normalizedPort);

      await hostMatchRequest({
        lobbyCode: currentLobby.code,
        mapId: "map1",
        startedAt: new Date().toISOString(),
        localUserId: currentUser.id,
        hostPort: normalizedPort,
        slots: buildHostedSlots(currentLobby),
      });
      await startMatchRequest(token, currentLobby.code, normalizedAddress, normalizedPort);
      setBackendStatus("connected");
      setNotice("Hosted match is live. Now the host machine gets to wear the blame.");
      return true;
    } catch (error) {
      await leaveHostedMatch(null, false);

      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      const message = getErrorMessage(error, "Could not start the match.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [handleUnauthorized, hostAddress, hostPort, leaveHostedMatch, multiplayerSupported, user]);

  const endMatch = useCallback(async () => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    const currentUser = user;
    if (!token || !currentLobby || !currentUser) {
      return false;
    }

    setLobbyBusyAction("end_match");

    try {
      const reason: MatchEndedReason = currentLobby.hostUserId === currentUser.id
        ? "host_ended_match"
        : "player_ended_match";

      await leaveHostedMatch(reason, true);
      clearMatchRuntime();

      if (currentLobby.hostUserId === currentUser.id) {
        await endMatchRequest(token, currentLobby.code);
      } else {
        await finalizeHostedMatch(reason);
      }
      setBackendStatus("connected");
      setNotice("Ending the match and dragging everyone back to the lobby.");
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      const message = getErrorMessage(error, "Could not end the match.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [clearMatchRuntime, finalizeHostedMatch, handleUnauthorized, leaveHostedMatch, user]);

  const leaveLobby = useCallback(async () => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    const currentUser = user;
    if (!token || !currentLobby || !currentUser) {
      return false;
    }

    setLobbyBusyAction("leave");

    try {
      if (currentLobby.status === "in_match") {
        await leaveHostedMatch(
          currentLobby.hostUserId === currentUser.id ? "host_left" : "player_left",
          true,
        );
        clearMatchRuntime();
      }
      await leaveLobbyRequest(token, currentLobby.code);
      setBackendStatus("connected");
      syncLobbyState(null);
      setNotice(null);
      toast.success("Left the lobby.");
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      if (error instanceof OnlineApiError && error.status === 404) {
        syncLobbyState(null);
        setNotice("Lobby already closed.");
        toast.info("Lobby already closed.");
        return true;
      }

      const message = getErrorMessage(error, "Could not leave the lobby.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [clearMatchRuntime, handleUnauthorized, leaveHostedMatch, syncLobbyState, user]);

  const disbandLobby = useCallback(async () => {
    const token = tokenRef.current;
    const currentLobby = lobbyRef.current;
    const currentUser = user;
    if (!token || !currentLobby || !currentUser) {
      return false;
    }

    setLobbyBusyAction("disband");

    try {
      if (currentLobby.status === "in_match") {
        await leaveHostedMatch("host_left", true);
        clearMatchRuntime();
      }
      await disbandLobbyRequest(token, currentLobby.code);
      setBackendStatus("connected");
      syncLobbyState(null);
      setNotice(null);
      toast.success("Lobby disbanded.");
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      if (error instanceof OnlineApiError && error.status === 404) {
        syncLobbyState(null);
        setNotice("Lobby already closed.");
        toast.info("Lobby already closed.");
        return true;
      }

      const message = getErrorMessage(error, "Could not disband the lobby.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [clearMatchRuntime, handleUnauthorized, leaveHostedMatch, syncLobbyState, user]);

  const flushQueuedInputFrame = useCallback(() => {
    const currentLobby = lobbyRef.current;
    const nextState = queuedInputFrameRef.current;
    if (!currentLobby || currentLobby.status !== "in_match" || !nextState) {
      return;
    }

    const elapsedMs = Date.now() - lastPlayerStateSentAtRef.current;
    if (elapsedMs < PLAYER_STATE_SEND_INTERVAL_MS) {
      clearPlayerStateFlushTimeout();
      playerStateFlushTimeoutRef.current = window.setTimeout(() => {
        playerStateFlushTimeoutRef.current = null;
        flushQueuedInputFrame();
      }, PLAYER_STATE_SEND_INTERVAL_MS - elapsedMs);
      return;
    }

    queuedInputFrameRef.current = null;
    lastPlayerStateSentAtRef.current = Date.now();

    void sendHostedInputFrameRequest(nextState)
      .then(() => {
        setBackendStatus("connected");
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV) {
          console.warn("[Online] Failed to send hosted input frame", error);
        }
      });
  }, [clearPlayerStateFlushTimeout]);

  const sendInputFrame = useCallback((state: OnlineMatchInputFrame) => {
    queuedInputFrameRef.current = state;
    flushQueuedInputFrame();
  }, [flushQueuedInputFrame]);

  const sendFireIntent = useCallback((intent: OnlineFireIntent) => {
    if (lobbyRef.current?.status !== "in_match") {
      return;
    }

    void sendHostedFireIntentRequest(intent)
      .then(() => {
        setBackendStatus("connected");
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV) {
          console.warn("[Online] Failed to send hosted fire intent", error);
        }
      });
  }, []);

  const sendReloadIntent = useCallback((requestId: string) => {
    if (lobbyRef.current?.status !== "in_match") {
      return;
    }

    void sendHostedReloadIntentRequest(requestId)
      .then(() => {
        setBackendStatus("connected");
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV) {
          console.warn("[Online] Failed to send hosted reload intent", {
            requestId,
            error,
          });
        }
      });
  }, []);

  return {
    multiplayerSupported,
    backendStatus,
    realtimeStatus,
    pingMs,
    hostAddress,
    hostPort,
    bootstrapComplete: backendStatus !== "checking" && authStatus !== "checking",
    authStatus,
    authBusyAction,
    lobbyBusyAction,
    notice,
    user,
    lobby,
    activeMatch,
    matchState,
    realtimePlayers,
    latestShotEvent,
    refreshConnection,
    setHostAddress,
    setHostPort,
    signUp,
    signIn,
    signOut,
    createLobby,
    joinLobby,
    selectLobbyCharacter,
    selectLobbyMap,
    toggleReady,
    startMatch,
    endMatch,
    leaveLobby,
    disbandLobby,
    sendInputFrame,
    sendFireIntent,
    sendReloadIntent,
  };
}
