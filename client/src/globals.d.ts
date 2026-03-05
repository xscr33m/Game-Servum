// Global type declarations for Electron API

export {};

declare global {
  interface Window {
    electronAPI?: {
      app?: {
        getVersion: () => Promise<string>;
        getPlatform: () => Promise<string>;
        isPackaged: () => Promise<boolean>;
        setLaunchOnStartup: (
          enabled: boolean,
        ) => Promise<{ success: boolean; error?: string }>;
        getLaunchOnStartup: () => Promise<{
          success: boolean;
          enabled: boolean;
        }>;
      };
      updater?: {
        checkForUpdates: () => Promise<void>;
        quitAndInstall: () => void;
        onUpdateAvailable: (
          callback: (info: {
            version: string;
            releaseDate: string;
            releaseNotes?: string;
          }) => void,
        ) => () => void;
        onUpdateDownloaded: (callback: () => void) => () => void;
        onDownloadProgress: (
          callback: (info: {
            percent: number;
            transferred: number;
            total: number;
          }) => void,
        ) => () => void;
        onError: (callback: (error: string) => void) => () => void;
        onNoUpdate: (callback: () => void) => () => void;
      };
      credentials?: {
        save: (key: string, value: string) => Promise<void>;
        load: (key: string) => Promise<string | null>;
        delete: (key: string) => Promise<void>;
        list: () => Promise<string[]>;
        clear: () => Promise<void>;
      };
      settings?: {
        load: (key: string) => Promise<string | null>;
        save: (key: string, value: string) => Promise<void>;
      };
      logger?: {
        debug: (message: string, data?: unknown) => Promise<void>;
        info: (message: string, data?: unknown) => Promise<void>;
        warn: (message: string, data?: unknown) => Promise<void>;
        error: (message: string, data?: unknown) => Promise<void>;
      };
      logs?: {
        listFiles: () => Promise<{
          success: boolean;
          files: Array<{ name: string; size: number; modified: string }>;
          error?: string;
        }>;
        getFileContent: (
          filename: string,
          options?: { lines?: number; tail?: boolean },
        ) => Promise<{
          success: boolean;
          filename: string;
          content: string;
          error?: string;
        }>;
        getSettings: () => Promise<{
          success: boolean;
          settings: import("@game-servum/shared").LoggerSettings;
        }>;
        updateSettings: (
          updates: Partial<import("@game-servum/shared").LoggerSettings>,
        ) => Promise<{
          success: boolean;
          message?: string;
          settings?: import("@game-servum/shared").LoggerSettings;
          error?: string;
        }>;
        deleteFile: (filename: string) => Promise<{
          success: boolean;
          message?: string;
          error?: string;
        }>;
        cleanup: (retentionDays: number) => Promise<{
          success: boolean;
          deletedCount: number;
          message?: string;
          error?: string;
        }>;
      };
    };
  }
}
