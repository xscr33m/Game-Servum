/**
 * Auto-Updater Types
 */

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
  releaseName?: string;
}

export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  error?: string;
  info?: UpdateInfo;
}
