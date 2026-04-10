// WebSocket message types — unified superset used by both Agent and Commander
export type WSMessageType =
  | "steamcmd:output"
  | "steamcmd:progress"
  | "steamcmd:guard-required"
  | "steamcmd:password-required"
  | "steamcmd:login-success"
  | "steamcmd:login-failed"
  | "steamcmd:logout"
  | "server:status"
  | "server:deleted"
  | "server:output"
  | "install:progress"
  | "install:complete"
  | "install:error"
  | "install:cancelled"
  | "mod:progress"
  | "mod:installed"
  | "mod:error"
  | "player:connected"
  | "player:disconnected"
  | "schedule:update"
  | "schedule:warning"
  | "schedule:restart"
  | "messages:update"
  | "update:detected"
  | "update:warning"
  | "update:restart"
  | "update:applied"
  | "update-check:complete"
  | "firewall:updated"
  | "server:config-ready"
  | "backup:started"
  | "backup:progress"
  | "backup:complete"
  | "backup:failed"
  | "restore:started"
  | "restore:complete";

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
}
