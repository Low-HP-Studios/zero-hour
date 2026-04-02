import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MapId } from "../types";
import {
  OnlineApiError,
  connectRealtimeSocket,
  createMultiplayerLobbyRequest,
  disbandLobbyRequest,
  endMatchRequest,
  getCurrentLobbyRequest,
  getSessionRequest,
  healthRequest,
  joinLobbyRequest,
  leaveLobbyRequest,
  logoutRequest,
  setLobbyCharacterRequest,
  setLobbyMapRequest,
  setReadyRequest,
  signInRequest,
  signUpRequest,
  startMatchRequest,
} from "./api";
import { clearStoredOnlineAuth, loadStoredOnlineAuth, saveStoredOnlineAuth } from "./storage";
import type {
  AuthBusyAction,
  AuthStatus,
  BackendStatus,
  LobbyBusyAction,
  OnlineActiveMatch,
  OnlineController,
  OnlineLobby,
  OnlineUser,
  RealtimeStatus,
} from "./types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof OnlineApiError ? error.message : fallback;
}

type RealtimeServerMessage =
  | { type: "auth_ok" }
  | { type: "lobby_state"; lobby: OnlineLobby | null }
  | { type: "match_started"; match: OnlineActiveMatch }
  | { type: "match_ended"; reason: string }
  | { type: "error"; message: string };

type UseOnlineStateOptions = {
  pollEnabled: boolean;
};

const MATCH_ENDED_MESSAGES: Record<string, string> = {
  host_disconnected: "Host disconnected. Match ended and everyone is back in the lobby.",
  player_disconnected: "Other player disconnected. Match ended and the lobby reopened.",
  host_left: "Host left the match. Back to the lobby we go.",
  player_left: "Other player left the match. The lobby is open again.",
  host_ended_match: "Host returned the match to the lobby.",
  player_ended_match: "A player ended the match and sent everyone back to the lobby.",
};

function parseRealtimeMessage(raw: unknown): RealtimeServerMessage | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    return JSON.parse(raw) as RealtimeServerMessage;
  } catch {
    return null;
  }
}

export function useOnlineState({ pollEnabled: _pollEnabled }: UseOnlineStateOptions): OnlineController {
  void _pollEnabled;

  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("disconnected");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [authBusyAction, setAuthBusyAction] = useState<AuthBusyAction>(null);
  const [lobbyBusyAction, setLobbyBusyAction] = useState<LobbyBusyAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [user, setUser] = useState<OnlineUser | null>(null);
  const [lobby, setLobby] = useState<OnlineLobby | null>(null);
  const [activeMatch, setActiveMatch] = useState<OnlineActiveMatch | null>(null);

  const tokenRef = useRef<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const socketAuthenticatedRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const allowReconnectRef = useRef(false);
  const desiredLobbyCodeRef = useRef<string | null>(null);
  const backendStatusRef = useRef<BackendStatus>("checking");
  const authStatusRef = useRef<AuthStatus>("checking");
  const previousLobbyCodeRef = useRef<string | null>(null);

  useEffect(() => {
    backendStatusRef.current = backendStatus;
  }, [backendStatus]);

  useEffect(() => {
    authStatusRef.current = authStatus;
  }, [authStatus]);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const syncLobbyState = useCallback((nextLobby: OnlineLobby | null) => {
    previousLobbyCodeRef.current = nextLobby?.code ?? previousLobbyCodeRef.current;
    desiredLobbyCodeRef.current = nextLobby?.code ?? null;
    setLobby(nextLobby);
    setActiveMatch(nextLobby?.activeMatch ?? null);
  }, []);

  const disconnectRealtime = useCallback(() => {
    allowReconnectRef.current = false;
    clearReconnectTimeout();
    socketAuthenticatedRef.current = false;

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }

    setRealtimeStatus("disconnected");
  }, [clearReconnectTimeout]);

  const subscribeToLobby = useCallback(() => {
    const socket = socketRef.current;
    const code = desiredLobbyCodeRef.current;
    if (!socket || !code || socket.readyState !== WebSocket.OPEN || !socketAuthenticatedRef.current) {
      return;
    }

    socket.send(JSON.stringify({
      type: "subscribe_lobby",
      code,
    }));
  }, []);

  const connectRealtime = useCallback(() => {
    const token = tokenRef.current;
    if (!token || backendStatusRef.current !== "connected" || authStatusRef.current !== "authenticated") {
      return;
    }

    const existingSocket = socketRef.current;
    if (
      existingSocket &&
      (existingSocket.readyState === WebSocket.OPEN ||
        existingSocket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearReconnectTimeout();
    allowReconnectRef.current = true;
    socketAuthenticatedRef.current = false;
    setRealtimeStatus("connecting");

    const socket = connectRealtimeSocket();
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      const currentToken = tokenRef.current;
      if (!currentToken) {
        socket.close();
        return;
      }

      socket.send(JSON.stringify({
        type: "auth",
        token: currentToken,
      }));
    });

    socket.addEventListener("message", (event) => {
      const message = parseRealtimeMessage(event.data);
      if (!message) {
        return;
      }

      if (message.type === "auth_ok") {
        socketAuthenticatedRef.current = true;
        setRealtimeStatus("connected");
        subscribeToLobby();
        return;
      }

      if (message.type === "lobby_state") {
        syncLobbyState(message.lobby);
        setNotice(message.lobby ? null : "Lobby closed or expired.");
        return;
      }

      if (message.type === "match_started") {
        setActiveMatch(message.match);
        setNotice(null);
        toast.success("Match starting.");
        return;
      }

      if (message.type === "match_ended") {
        setActiveMatch(null);
        const nextNotice = MATCH_ENDED_MESSAGES[message.reason] ?? "Match ended. Back to the lobby.";
        setNotice(nextNotice);
        toast.info(nextNotice);
        return;
      }

      setNotice(message.message);
      toast.error(message.message);
    });

    socket.addEventListener("close", () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socketAuthenticatedRef.current = false;

      const shouldReconnect = allowReconnectRef.current &&
        tokenRef.current !== null &&
        backendStatusRef.current === "connected" &&
        authStatusRef.current === "authenticated";

      setRealtimeStatus("disconnected");
      if (!shouldReconnect) {
        return;
      }

      setNotice("Realtime connection dropped. Reconnecting to the lobby.");
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectRealtime();
      }, 1_000);
    });

    socket.addEventListener("error", () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    });
  }, [clearReconnectTimeout, subscribeToLobby, syncLobbyState]);

  const resetAuthState = useCallback((clearStorage: boolean) => {
    if (clearStorage) {
      clearStoredOnlineAuth();
    }

    tokenRef.current = null;
    disconnectRealtime();
    setUser(null);
    syncLobbyState(null);
    setAuthStatus("signed_out");
    setAuthBusyAction(null);
    setLobbyBusyAction(null);
  }, [disconnectRealtime, syncLobbyState]);

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

  const loadCurrentLobby = useCallback(async (token: string, silent: boolean) => {
    try {
      const response = await getCurrentLobbyRequest(token);
      setBackendStatus("connected");
      syncLobbyState(response.lobby);
      setNotice(null);
      return response.lobby;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return null;
      }

      if (error instanceof OnlineApiError && error.status === 0) {
        setBackendStatus("unavailable");
      }

      const message = getErrorMessage(error, "Could not load the current lobby state.");
      syncLobbyState(null);
      setNotice(message);
      if (!silent) {
        toast.error(message);
      }
      return null;
    }
  }, [handleUnauthorized, syncLobbyState]);

  const refreshConnection = useCallback(async () => {
    setBackendStatus("checking");
    setRealtimeStatus("disconnected");
    setAuthStatus("checking");
    setNotice(null);

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
          "Greytrace backend is unreachable right now. Login stays outside the game for a reason.",
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
      const response = await getSessionRequest(storedAuth.token);
      applyAuthState(storedAuth.token, response.user);
      await loadCurrentLobby(storedAuth.token, true);
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        setBackendStatus("connected");
        resetAuthState(true);
        setNotice(error.message);
        return false;
      }

      setBackendStatus("unavailable");
      resetAuthState(false);
      setNotice(
        getErrorMessage(
          error,
          "Greytrace backend is unreachable right now. Login stays outside the game for a reason.",
        ),
      );
      return false;
    }
  }, [applyAuthState, loadCurrentLobby, resetAuthState, syncLobbyState]);

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    desiredLobbyCodeRef.current = lobby?.code ?? null;
    if (lobby?.code) {
      subscribeToLobby();
    }
  }, [lobby?.code, subscribeToLobby]);

  useEffect(() => {
    if (backendStatus === "connected" && authStatus === "authenticated") {
      connectRealtime();
      return;
    }

    disconnectRealtime();
  }, [authStatus, backendStatus, connectRealtime, disconnectRealtime]);

  useEffect(() => () => {
    disconnectRealtime();
    clearReconnectTimeout();
  }, [clearReconnectTimeout, disconnectRealtime]);

  const signUp = useCallback(async (username: string, password: string) => {
    setAuthBusyAction("signup");

    try {
      const response = await signUpRequest(username, password);
      applyAuthState(response.token, response.user);
      await loadCurrentLobby(response.token, true);
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
  }, [applyAuthState, loadCurrentLobby]);

  const signIn = useCallback(async (username: string, password: string) => {
    setAuthBusyAction("login");

    try {
      const response = await signInRequest(username, password);
      applyAuthState(response.token, response.user);
      await loadCurrentLobby(response.token, true);
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
  }, [applyAuthState, loadCurrentLobby]);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    setAuthBusyAction("logout");

    try {
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
  }, [resetAuthState]);

  const createLobby = useCallback(async (
    maxPlayers: 2,
    selectedCharacterId: string,
    selectedMapId: MapId,
  ) => {
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
  }, [handleUnauthorized, syncLobbyState]);

  const joinLobby = useCallback(async (code: string, selectedCharacterId: string) => {
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
  }, [handleUnauthorized, syncLobbyState]);

  const selectLobbyCharacter = useCallback(async (selectedCharacterId: string) => {
    const token = tokenRef.current;
    if (!token || !lobby) {
      return false;
    }

    setLobbyBusyAction("character");

    try {
      const nextLobby = await setLobbyCharacterRequest(token, lobby.code, selectedCharacterId);
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
  }, [handleUnauthorized, lobby, syncLobbyState]);

  const selectLobbyMap = useCallback(async (selectedMapId: MapId) => {
    const token = tokenRef.current;
    if (!token || !lobby) {
      return false;
    }

    setLobbyBusyAction("map");

    try {
      const nextLobby = await setLobbyMapRequest(token, lobby.code, selectedMapId);
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
  }, [handleUnauthorized, lobby, syncLobbyState]);

  const toggleReady = useCallback(async (ready: boolean) => {
    const token = tokenRef.current;
    if (!token || !lobby) {
      return false;
    }

    setLobbyBusyAction("ready");

    try {
      const nextLobby = await setReadyRequest(token, lobby.code, ready);
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
  }, [handleUnauthorized, lobby, syncLobbyState]);

  const startMatch = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !lobby) {
      return false;
    }

    setLobbyBusyAction("start");

    try {
      await startMatchRequest(token, lobby.code);
      setBackendStatus("connected");
      setNotice("Match start requested. Waiting for the realtime kickoff.");
      return true;
    } catch (error) {
      if (error instanceof OnlineApiError && error.status === 401) {
        handleUnauthorized(error.message);
        return false;
      }

      const message = getErrorMessage(error, "Could not start the match.");
      setNotice(message);
      toast.error(message);
      return false;
    } finally {
      setLobbyBusyAction(null);
    }
  }, [handleUnauthorized, lobby]);

  const endMatch = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !lobby) {
      return false;
    }

    setLobbyBusyAction("end_match");

    try {
      await endMatchRequest(token, lobby.code);
      setBackendStatus("connected");
      setNotice("Ending the match and returning the lobby to civilized society.");
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
  }, [handleUnauthorized, lobby]);

  const leaveLobby = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !lobby) {
      return false;
    }

    setLobbyBusyAction("leave");

    try {
      await leaveLobbyRequest(token, lobby.code);
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
  }, [handleUnauthorized, lobby, syncLobbyState]);

  const disbandLobby = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !lobby) {
      return false;
    }

    setLobbyBusyAction("disband");

    try {
      await disbandLobbyRequest(token, lobby.code);
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
  }, [handleUnauthorized, lobby, syncLobbyState]);

  return {
    backendStatus,
    realtimeStatus,
    bootstrapComplete: backendStatus !== "checking" && authStatus !== "checking",
    authStatus,
    authBusyAction,
    lobbyBusyAction,
    notice,
    user,
    lobby,
    activeMatch,
    refreshConnection,
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
  };
}
