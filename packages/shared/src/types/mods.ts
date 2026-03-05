// Mod status types
export type ModStatus =
  | "pending"
  | "downloading"
  | "installed"
  | "error"
  | "update_available";

export interface ServerMod {
  id: number;
  serverId: number;
  workshopId: string;
  name: string;
  enabled: boolean;
  isServerMod: boolean;
  loadOrder: number;
  status: ModStatus;
  installedAt: string | null;
  workshopUpdatedAt: string | null;
}
