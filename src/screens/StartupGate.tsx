import { useEffect, useState, type FormEvent } from "react";
import type { OnlineController } from "../game/online/types";

type StartupGateProps = {
  online: OnlineController;
  onContinueOffline: () => void;
  onContinueToLobby: () => void;
};

export function StartupGate({
  online,
  onContinueOffline,
  onContinueToLobby,
}: StartupGateProps) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (online.backendStatus === "connected" && online.authStatus === "authenticated") {
      onContinueToLobby();
    }
  }, [onContinueToLobby, online.authStatus, online.backendStatus]);

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const success = authMode === "signup"
      ? await online.signUp(username, password)
      : await online.signIn(username, password);

    if (success) {
      setPassword("");
    }
  };

  const backendLabel = online.backendStatus === "checking"
    ? "Checking backend"
    : online.backendStatus === "connected"
    ? "Backend online"
    : "Backend unavailable";

  const authLabel = online.authStatus === "checking"
    ? "Validating session"
    : online.authStatus === "authenticated"
    ? `Signed in as ${online.user?.username ?? "operator"}`
    : "Authentication required";

  return (
    <div className="startup-gate">
      <div className="startup-gate-backdrop" aria-hidden="true" />
      <section className="startup-gate-panel">
        <div className="startup-gate-brand">
          <span className="startup-gate-kicker">GreyTrace Access</span>
          <h1 className="startup-gate-title">Login happens before the firefight.</h1>
          <p className="startup-gate-copy">
            We check the backend first, validate your session if it exists, and only then let you
            into the lobby. Turns out authentication works better before the bullets.
          </p>
        </div>

        <div className="startup-status-grid">
          <article className="startup-status-card">
            <span>Backend</span>
            <strong>{backendLabel}</strong>
          </article>
          <article className="startup-status-card">
            <span>Session</span>
            <strong>{authLabel}</strong>
          </article>
        </div>

        {online.notice ? (
          <p className="online-status-note-v3 startup-status-note-v3">{online.notice}</p>
        ) : null}

        {online.backendStatus === "checking" || online.authStatus === "checking"
          ? (
            <div className="online-empty-state-v3">
              <strong>Running startup checks</strong>
              <p>We are poking the backend and seeing whether your token is still alive.</p>
            </div>
          )
          : null}

        {online.backendStatus === "unavailable"
          ? (
            <div className="startup-gate-actions">
              <button
                type="button"
                className="lobby-play-btn-v2"
                onClick={() => { void online.refreshConnection(); }}
                disabled={online.authBusyAction !== null || online.lobbyBusyAction !== null}
              >
                Retry backend
              </button>
              <button
                type="button"
                className="online-secondary-btn-v3"
                onClick={onContinueOffline}
              >
                Continue offline
              </button>
            </div>
          )
          : null}

        {online.backendStatus === "connected" && online.authStatus === "signed_out"
          ? (
            <div className="startup-auth-layout">
              <div className="segmented-row online-auth-tabs-v3">
                <button
                  type="button"
                  className={`chip-btn ${authMode === "signin" ? "active" : ""}`}
                  onClick={() => setAuthMode("signin")}
                  disabled={online.authBusyAction !== null}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`chip-btn ${authMode === "signup" ? "active" : ""}`}
                  onClick={() => setAuthMode("signup")}
                  disabled={online.authBusyAction !== null}
                >
                  Sign Up
                </button>
              </div>

              <form className="online-form-v3" onSubmit={handleAuthSubmit}>
                <label className="online-field-v3">
                  <span>Username</span>
                  <input
                    className="online-input-v3"
                    type="text"
                    value={username}
                    autoComplete="username"
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="grey_ops"
                    disabled={online.authBusyAction !== null}
                  />
                </label>
                <label className="online-field-v3">
                  <span>Password</span>
                  <input
                    className="online-input-v3"
                    type="password"
                    value={password}
                    autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="8+ characters"
                    disabled={online.authBusyAction !== null}
                  />
                </label>

                <div className="startup-gate-actions">
                  <button
                    type="submit"
                    className="lobby-play-btn-v2"
                    disabled={online.authBusyAction !== null}
                  >
                    {authMode === "signup"
                      ? online.authBusyAction === "signup"
                        ? "Creating..."
                        : "Create account"
                      : online.authBusyAction === "login"
                      ? "Signing in..."
                      : "Sign in"}
                  </button>
                  <button
                    type="button"
                    className="online-secondary-btn-v3"
                    onClick={onContinueOffline}
                    disabled={online.authBusyAction !== null}
                  >
                    Continue offline
                  </button>
                </div>
              </form>
            </div>
          )
          : null}
      </section>
    </div>
  );
}
