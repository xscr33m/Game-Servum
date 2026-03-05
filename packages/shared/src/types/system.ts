// System monitoring
export interface SystemMetrics {
  cpu: {
    usagePercent: number;
    cores: number;
    model: string;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  };
  disk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
    drive: string;
  };
  network: {
    bytesSent: number;
    bytesReceived: number;
    sendRate: number;
    receiveRate: number;
  };
  uptime: number;
  timestamp: string;
}

export interface SystemSettings {
  monitoringEnabled: boolean;
}

export interface AgentSettings {
  autoStartEnabled: boolean;
}

export interface UpdateState {
  checking: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
  downloading: boolean;
  downloadProgress?: number; // 0-100
  downloaded: boolean;
  error?: string;
  lastCheck?: number; // timestamp
}
