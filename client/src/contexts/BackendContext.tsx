import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import type { WSMessage } from "@/types";
import type { BackendConnection } from "@/lib/config";
import { loadConnections, saveConnections } from "@/lib/config";
import { createApiClient, type ApiClient } from "@/lib/api";
import {
  WebSocketManager,
  createWsManager,
  getDefaultWsManager,
} from "@/hooks/useWebSocket";
import {
  BackendContext,
  type BackendContextValue,
} from "@/contexts/BackendContextDef";
import { toastSuccess } from "@/lib/toast";
import { logger } from "@/lib/logger";

// Token renewal at 80% of lifetime (default 24h → renew after ~19.2h)
const TOKEN_RENEWAL_RATIO = 0.8;

// Auto-reconnect polling interval when agent is unreachable (3 seconds)
const RECONNECT_POLL_INTERVAL = 3_000;
// Initial delay before first reconnect attempt (1 second)
const RECONNECT_INITIAL_DELAY = 1_000;
// Longer initial delay for intentional disconnects (updating/restarting)
// to wait for the agent to fully shut down before polling
const RECONNECT_INTENTIONAL_DELAY = 15_000;
// Max reconnect attempts before giving up (20 attempts ≈ 60s, then user must manually retry)
const MAX_RECONNECT_ATTEMPTS = 20;

// ── Provider ──

export function BackendProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<BackendConnection[]>(() =>
    loadConnections(),
  );
  const [activeId, setActiveId] = useState<string | null>(() => {
    const stored = loadConnections();
    const active = stored.find((c) => c.isActive);
    return active?.id || null;
  });

  const [wsConnected, setWsConnected] = useState(false);

  // API client as state — ensures re-render when client changes (e.g. after auth)
  const [currentApi, setCurrentApi] = useState<ApiClient>(() =>
    createApiClient(),
  );

  // WS manager kept as ref (accessed via closures, not directly in context value)
  const wsManagerRef = useRef<WebSocketManager>(getDefaultWsManager());
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Keep latest connections in ref for dynamic token getter
  // IMPORTANT: Update synchronously during render, NOT in useEffect!
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  const activeConnection = connections.find((c) => c.id === activeId) || null;

  // ── Persist connections (only when credentials/tokens change, not status) ──
  // Exception: "updating" / "restarting" status IS persisted so the Dashboard
  // continues unlimited reconnect polling after a page refresh.
  const persistableSnapshot = useMemo(() => {
    const persistable = connections.map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      apiKey: c.apiKey,
      password: c.password,
      sessionToken: c.sessionToken,
      tokenExpiresAt: c.tokenExpiresAt,
      isActive: c.isActive,
      agentInfo: c.agentInfo,
      // Include updating/restarting status so it survives page refresh
      ...(c.status === "updating" || c.status === "restarting"
        ? { status: c.status, statusUpdatedAt: c.statusUpdatedAt }
        : {}),
    }));
    return JSON.stringify(persistable);
  }, [connections]);

  useEffect(() => {
    saveConnections(connections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistableSnapshot]);

  // ── Eagerly connect all stored agents on mount ──
  // When the app loads (or is refreshed), immediately try to authenticate
  // all stored connections so they don't stay "disconnected" until the
  // auto-reconnect polling kicks in for the active one.
  const hasRunInitialConnect = useRef(false);
  useEffect(() => {
    if (hasRunInitialConnect.current) return;
    hasRunInitialConnect.current = true;

    const stored = connections.filter((c) => c.apiKey && c.password && c.url);
    if (stored.length === 0) return;

    logger.info(`[Init] Connecting to ${stored.length} stored agent(s)...`);

    for (const conn of stored) {
      // If this connection has a persisted "updating" / "restarting" status,
      // skip the immediate health check — go straight to auto-reconnect
      // polling which uses a longer initial delay and unlimited retries.
      if (conn.status === "updating" || conn.status === "restarting") {
        logger.info(
          `[Init] Agent "${conn.name}" has persisted "${conn.status}" status — waiting for agent to come back...`,
        );
        // Status is already set from persisted data — auto-reconnect effect
        // will pick it up since wsConnected starts as false
        continue;
      }

      (async () => {
        try {
          // Quick health check
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const healthRes = await fetch(`${conn.url}/api/v1/health`, {
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!healthRes.ok) {
            setConnections((prev) =>
              prev.map((c) =>
                c.id === conn.id ? { ...c, status: "reconnecting" } : c,
              ),
            );
            return;
          }

          // Authenticate
          const authRes = await fetch(`${conn.url}/api/v1/auth/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey: conn.apiKey,
              password: conn.password,
            }),
          });
          if (!authRes.ok) {
            setConnections((prev) =>
              prev.map((c) =>
                c.id === conn.id ? { ...c, status: "error" } : c,
              ),
            );
            return;
          }

          const { token, expiresIn } = await authRes.json();

          // Fetch agent info
          let agentInfo = conn.agentInfo;
          try {
            const infoRes = await fetch(`${conn.url}/api/v1/info`);
            if (infoRes.ok) {
              const info = await infoRes.json();
              agentInfo = {
                version: info.version || "unknown",
                hostname: info.hostname || "unknown",
                platform: info.platform || "unknown",
                serverCount: info.serverCount || 0,
              };
            }
          } catch {
            /* keep existing */
          }

          logger.info(`[Init] Connected to "${conn.name}"`);
          setConnections((prev) =>
            prev.map((c) =>
              c.id === conn.id
                ? {
                    ...c,
                    sessionToken: token,
                    tokenExpiresAt: Date.now() + expiresIn * 1000,
                    status: "connected",
                    agentInfo,
                  }
                : c,
            ),
          );
        } catch {
          // Agent unreachable — will be picked up by auto-reconnect
          setConnections((prev) =>
            prev.map((c) =>
              c.id === conn.id ? { ...c, status: "reconnecting" } : c,
            ),
          );
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helper: update a single connection in state ──
  const updateConnection = useCallback(
    (id: string, updates: Partial<BackendConnection>) => {
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      );
    },
    [],
  );

  // ── Re-authenticate with stored credentials ──
  const reAuthenticate = useCallback(
    async (conn: BackendConnection): Promise<string | null> => {
      try {
        const res = await fetch(`${conn.url}/api/v1/auth/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: conn.apiKey,
            password: conn.password,
          }),
        });

        if (!res.ok) return null;

        const { token, expiresIn } = await res.json();
        updateConnection(conn.id, {
          sessionToken: token,
          tokenExpiresAt: Date.now() + expiresIn * 1000,
          status: "connected",
        });
        return token;
      } catch {
        updateConnection(conn.id, { status: "error" });
        return null;
      }
    },
    [updateConnection],
  );

  // ── Token refresh (uses existing session) ──
  const refreshToken = useCallback(
    async (conn: BackendConnection): Promise<boolean> => {
      if (!conn.sessionToken) return false;

      try {
        const res = await fetch(`${conn.url}/api/v1/auth/refresh`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${conn.sessionToken}`,
          },
        });

        if (res.status === 401) {
          // Token expired — try full re-auth with stored credentials
          logger.info(
            `[Session] Token expired for ${conn.name}, attempting re-auth...`,
          );
          const newToken = await reAuthenticate(conn);
          return newToken !== null;
        }

        if (!res.ok) return false;

        const { token, expiresIn } = await res.json();
        updateConnection(conn.id, {
          sessionToken: token,
          tokenExpiresAt: Date.now() + expiresIn * 1000,
          status: "connected",
        });
        return true;
      } catch {
        // Network error — try re-auth
        logger.info(
          `[Session] Refresh failed for ${conn.name}, attempting re-auth...`,
        );
        const newToken = await reAuthenticate(conn);
        return newToken !== null;
      }
    },
    [updateConnection, reAuthenticate],
  );

  // ── Schedule automatic token renewal ──
  const activeTokenExpiresAt = activeConnection?.tokenExpiresAt;
  const activeConnectionId = activeConnection?.id;
  const activeConnectionName = activeConnection?.name;

  useEffect(() => {
    if (tokenTimerRef.current) {
      clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = null;
    }

    if (!activeTokenExpiresAt || !activeConnectionId) return;

    const now = Date.now();
    const lifetime = activeTokenExpiresAt - now;

    if (lifetime <= 0) {
      // Already expired — re-auth immediately
      const conn = connections.find((c) => c.id === activeConnectionId);
      if (conn) reAuthenticate(conn);
      return;
    }

    // Schedule renewal at TOKEN_RENEWAL_RATIO of remaining lifetime
    const renewIn = Math.max(lifetime * TOKEN_RENEWAL_RATIO, 60_000); // min 1 minute
    logger.info(
      `[Session] Token for ${activeConnectionName} renews in ${Math.round(renewIn / 60_000)}min`,
    );

    tokenTimerRef.current = setTimeout(() => {
      const conn = connections.find((c) => c.id === activeConnectionId);
      if (conn) refreshToken(conn);
    }, renewIn);

    return () => {
      if (tokenTimerRef.current) {
        clearTimeout(tokenTimerRef.current);
        tokenTimerRef.current = null;
      }
    };
  }, [
    activeConnectionId,
    activeConnectionName,
    activeTokenExpiresAt,
    connections,
    refreshToken,
    reAuthenticate,
  ]);

  // ── Recreate API client & WS when active connection changes ──
  // Track sessionToken specifically so WS reconnects with fresh auth
  const activeToken = activeConnection?.sessionToken;
  const activeUrl = activeConnection?.url;

  useEffect(() => {
    if (activeConnection) {
      // Create scoped client with dynamic token getter
      // This ensures the API client always uses the latest token from state
      const getToken = () => {
        const conn = connectionsRef.current.find(
          (c) => c.id === activeConnection.id,
        );
        return conn?.sessionToken;
      };
      setCurrentApi(createApiClient(activeConnection, getToken));

      // Disconnect old WS, create new one
      // Note: WS needs to be recreated when token changes because it's used in the connect URL
      if (wsManagerRef.current !== getDefaultWsManager()) {
        wsManagerRef.current.disconnect();
      }
      wsManagerRef.current = createWsManager(activeConnection);
    } else {
      // No active connection — reset to default client
      setCurrentApi(createApiClient());
    }

    // Track WS connection state
    const unsub = wsManagerRef.current.onConnectionChange((state) =>
      setWsConnected(state),
    );
    setWsConnected(wsManagerRef.current.isConnected);

    return unsub;
    // Rebuild when the connection identity, URL, or token changes
    // Token is needed because WS uses it in the connection URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeUrl, activeToken]);

  // ── Auto-reconnect when agent becomes unreachable ──
  // When the active connection loses WebSocket connectivity, poll the health
  // endpoint until the agent is back, then re-authenticate and reconnect.
  const isReconnecting = useRef(false);

  useEffect(() => {
    if (!activeConnection) return;

    if (wsConnected) {
      // Connection is healthy — stop any reconnect polling
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptsRef.current = 0;
      isReconnecting.current = false;
      // Ensure status is "connected" — but don't override "updating"
      // (the agent is about to go down, WS just hasn't disconnected yet)
      if (
        activeConnection.status !== "connected" &&
        activeConnection.status !== "updating" &&
        activeConnection.status !== "restarting"
      ) {
        updateConnection(activeConnection.id, {
          status: "connected",
          reconnectAttempts: 0,
          lastError: undefined,
        });
      }
      return;
    }

    // WS disconnected — only start polling if we had a valid connection before
    // (has credentials stored, meaning it was previously connected)
    if (!activeConnection.apiKey || !activeConnection.password) return;

    // Mark as reconnecting (distinguishes from initial connect / permanent disconnect)
    // Don't override "updating" status — that's handled separately with unlimited retries
    if (
      activeConnection.status !== "reconnecting" &&
      activeConnection.status !== "authenticating" &&
      activeConnection.status !== "error" &&
      activeConnection.status !== "updating" &&
      activeConnection.status !== "restarting"
    ) {
      updateConnection(activeConnection.id, { status: "reconnecting" });
    }

    // Don't start a second polling loop
    if (reconnectTimerRef.current) return;

    // Only log once when starting reconnect (not on every status update)
    if (!isReconnecting.current) {
      logger.info(
        `[Reconnect] Agent "${activeConnection.name}" disconnected — polling for availability...`,
      );
      isReconnecting.current = true;
    }

    const connId = activeConnection.id;
    const connName = activeConnection.name;

    // Use a longer initial delay for intentional disconnects (update/restart)
    // so we don't hit the agent while it's still shutting down
    const isIntentional =
      activeConnection.status === "updating" ||
      activeConnection.status === "restarting";
    const initialDelay = isIntentional
      ? RECONNECT_INTENTIONAL_DELAY
      : RECONNECT_INITIAL_DELAY;

    async function attemptReconnect() {
      // Find the latest connection state
      const conn = connections.find((c) => c.id === connId);
      if (!conn) {
        // Connection was removed — stop polling
        if (reconnectTimerRef.current) {
          clearInterval(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        return;
      }

      reconnectAttemptsRef.current++;
      const currentAttempt = reconnectAttemptsRef.current;

      // Skip attempt limit when agent is updating — keep polling until it comes back
      const isUpdating =
        conn.status === "updating" || conn.status === "restarting";

      // Check if we've reached the limit BEFORE trying again
      if (
        !isUpdating &&
        MAX_RECONNECT_ATTEMPTS > 0 &&
        currentAttempt >= MAX_RECONNECT_ATTEMPTS
      ) {
        logger.info(
          `[Reconnect] Max attempts (${MAX_RECONNECT_ATTEMPTS}) reached for "${conn.name}" — giving up`,
        );
        updateConnection(connId, {
          status: "error",
          lastError: "Connection timeout - maximum retry attempts reached",
          reconnectAttempts: MAX_RECONNECT_ATTEMPTS,
        });
        if (reconnectTimerRef.current) {
          clearInterval(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        isReconnecting.current = false;
        return;
      }

      // Only update attempt count every 3rd attempt to reduce state changes
      if (currentAttempt % 3 === 0 || currentAttempt === 1) {
        updateConnection(connId, {
          reconnectAttempts: currentAttempt,
        });
      }

      try {
        // Health check — is the agent reachable?
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const healthRes = await fetch(`${conn.url}/api/v1/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!healthRes.ok) return; // Agent not ready yet

        logger.info(
          `[Reconnect] Agent "${conn.name}" is reachable — re-authenticating...`,
        );
        // Preserve "updating" status through the auth phase so the banner stays blue
        if (conn.status !== "updating" && conn.status !== "restarting") {
          updateConnection(connId, { status: "authenticating" });
        }

        // Re-authenticate with stored credentials
        const authRes = await fetch(`${conn.url}/api/v1/auth/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: conn.apiKey,
            password: conn.password,
          }),
        });

        if (!authRes.ok) {
          logger.warn(
            `[Reconnect] Re-auth failed for "${conn.name}" (${authRes.status})`,
          );
          // During updates/restarts, keep status so unlimited retries continue
          if (conn.status !== "updating" && conn.status !== "restarting") {
            updateConnection(connId, {
              status: "error",
              lastError:
                authRes.status === 401
                  ? "Authentication failed - invalid credentials"
                  : `Authentication failed (${authRes.status})`,
            });
          }
          return;
        }

        const { token, expiresIn } = await authRes.json();

        logger.info(`[Reconnect] Re-authenticated to "${conn.name}"`);

        // Fetch updated agent info
        let agentInfo = conn.agentInfo;
        try {
          const infoRes = await fetch(`${conn.url}/api/v1/info`);
          if (infoRes.ok) {
            const info = await infoRes.json();
            agentInfo = {
              version: info.version || "unknown",
              hostname: info.hostname || "unknown",
              platform: info.platform || "unknown",
              serverCount: info.serverCount || 0,
            };
          }
        } catch {
          /* keep existing agentInfo */
        }

        // Update connection with new token
        updateConnection(connId, {
          sessionToken: token,
          tokenExpiresAt: Date.now() + expiresIn * 1000,
          status: "connected",
          agentInfo,
          reconnectAttempts: 0,
          lastError: undefined,
        });

        // Show success feedback — distinguish update completion from normal reconnect
        if (conn.status === "updating") {
          toastSuccess(
            `Agent "${connName}" updated and reconnected successfully`,
          );
        } else if (conn.status === "restarting") {
          toastSuccess(`Agent "${connName}" restarted successfully`);
        } else {
          toastSuccess(`Reconnected to ${connName}`);
        }

        // Stop polling — the token update will trigger the activeConnection
        // useEffect, which recreates the API client and WS manager with
        // the new token. The WS connect will set wsConnected=true which
        // stops this effect from re-entering the polling branch.
        if (reconnectTimerRef.current) {
          clearInterval(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        isReconnecting.current = false;

        // The token update will trigger the activeConnection useEffect,
        // which recreates the API client and WS manager with the new token.
      } catch {
        // Agent still unreachable — continue polling silently
      }
    }

    // First attempt after initial delay, then regular interval
    const initialTimer = setTimeout(() => {
      attemptReconnect();
      reconnectTimerRef.current = setInterval(
        attemptReconnect,
        RECONNECT_POLL_INTERVAL,
      );
    }, initialDelay);

    return () => {
      clearTimeout(initialTimer);
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
    // Re-run when WS connection, active connection, or status changes
    // The isReconnecting flag prevents duplicate logs on status updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected, activeConnection?.id, activeConnection?.status]);

  // ── Add a new backend connection ──
  const addConnection = useCallback(
    async (url: string, apiKey: string, password: string, name: string) => {
      const id = crypto.randomUUID();
      const baseUrl = url.replace(/\/+$/, "");

      // Test connectivity
      const newConn: BackendConnection = {
        id,
        name,
        url: baseUrl,
        apiKey,
        password,
        isActive: false,
        status: "authenticating",
      };

      try {
        // Health check
        const healthRes = await fetch(`${baseUrl}/api/v1/health`);
        if (!healthRes.ok) throw new Error("Agent not reachable");

        // Get agent info
        const infoRes = await fetch(`${baseUrl}/api/v1/info`);
        const info = await infoRes.json();

        // Authenticate
        const authRes = await fetch(`${baseUrl}/api/v1/auth/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, password }),
        });

        if (!authRes.ok) {
          throw new Error("Authentication failed — invalid credentials");
        }

        const { token, expiresIn } = await authRes.json();

        newConn.sessionToken = token;
        newConn.tokenExpiresAt = Date.now() + expiresIn * 1000;
        newConn.status = "connected";
        newConn.agentInfo = {
          version: info.version || "unknown",
          hostname: info.hostname || "unknown",
          platform: info.platform || "unknown",
          serverCount: info.serverCount || 0,
        };

        setConnections((prev) => [...prev, newConn]);

        // If this is the first connection, make it active
        setConnections((prev) => {
          if (prev.length === 1) {
            return prev.map((c) => ({ ...c, isActive: true }));
          }
          return prev;
        });
        if (connections.length === 0) {
          setActiveId(id);
        }
      } catch (err) {
        newConn.status = "error";
        throw err;
      }
    },
    [connections.length],
  );

  // ── Remove a connection ──
  const removeConnection = useCallback(
    (id: string) => {
      setConnections((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
      }
    },
    [activeId],
  );

  // ── Switch active connection ──
  const setActiveConnection = useCallback((id: string) => {
    setConnections((prev) =>
      prev.map((c) => ({ ...c, isActive: c.id === id })),
    );
    setActiveId(id);
  }, []);

  // ── Update connection status ──
  const updateConnectionStatus = useCallback(
    (id: string, status: BackendConnection["status"]) => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status,
                // Track timestamp for updating/restarting so stale statuses
                // can be detected after page refresh
                statusUpdatedAt:
                  status === "updating" || status === "restarting"
                    ? Date.now()
                    : c.statusUpdatedAt,
              }
            : c,
        ),
      );
    },
    [],
  );

  // ── Update connection details (e.g. rename) ──
  const updateConnectionDetails = useCallback(
    (id: string, details: Partial<Pick<BackendConnection, "name">>) => {
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...details } : c)),
      );
    },
    [],
  );

  // ── Reset reconnect attempts (for manual retry) ──
  const resetReconnectAttempts = useCallback(
    (id: string) => {
      reconnectAttemptsRef.current = 0;
      isReconnecting.current = false; // Allow log to show again
      updateConnection(id, {
        reconnectAttempts: 0,
        status: "reconnecting",
        lastError: undefined,
      });
      logger.info(`[Reconnect] Manual retry initiated for connection ${id}`);
    },
    [updateConnection],
  );

  // ── Force reconnect to a connection ──
  const reconnectConnection = useCallback(
    async (id: string): Promise<boolean> => {
      const conn = connections.find((c) => c.id === id);
      if (!conn) return false;

      updateConnection(id, { status: "authenticating" });

      try {
        // Health check
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const healthRes = await fetch(`${conn.url}/api/v1/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!healthRes.ok) {
          updateConnection(id, { status: "error" });
          return false;
        }

        // Re-authenticate
        const authRes = await fetch(`${conn.url}/api/v1/auth/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: conn.apiKey,
            password: conn.password,
          }),
        });

        if (!authRes.ok) {
          updateConnection(id, { status: "error" });
          return false;
        }

        const { token, expiresIn } = await authRes.json();

        // Fetch agent info
        let agentInfo = conn.agentInfo;
        try {
          const infoRes = await fetch(`${conn.url}/api/v1/info`);
          if (infoRes.ok) {
            const info = await infoRes.json();
            agentInfo = {
              version: info.version || "unknown",
              hostname: info.hostname || "unknown",
              platform: info.platform || "unknown",
              serverCount: info.serverCount || 0,
            };
          }
        } catch {
          /* keep existing agentInfo */
        }

        updateConnection(id, {
          sessionToken: token,
          tokenExpiresAt: Date.now() + expiresIn * 1000,
          status: "connected",
          agentInfo,
        });

        logger.info(`[Reconnect] Successfully reconnected to "${conn.name}"`);
        return true;
      } catch {
        updateConnection(id, { status: "disconnected" });
        return false;
      }
    },
    [connections, updateConnection],
  );

  // ── Subscribe to WS messages ──
  const subscribe = useCallback(
    (handler: (msg: WSMessage) => void) => {
      return wsManagerRef.current.subscribe(handler);
    },
    // Re-bind when manager is recreated (same deps as WS effect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, activeToken],
  );

  const value: BackendContextValue = {
    connections,
    activeConnection,
    addConnection,
    removeConnection,
    setActiveConnection,
    updateConnectionStatus,
    updateConnectionDetails,
    reconnectConnection,
    resetReconnectAttempts,
    api: currentApi,
    subscribe,
    isConnected: wsConnected,
  };

  return (
    <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
  );
}
