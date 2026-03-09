import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FaDownload, FaSpinner, FaRocket, FaXmark } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toastError } from "@/lib/toast";
import { logger } from "@/lib/logger";

interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
  releaseName?: string;
}

interface ElectronAPI {
  updater?: {
    checkForUpdates: () => Promise<{
      success: boolean;
      updateInfo?: UpdateInfo;
    }>;
    downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
    installUpdate: () => Promise<{ success: boolean; error?: string }>;
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    onDownloadProgress: (
      callback: (progress: {
        percent: number;
        transferred: number;
        total: number;
      }) => void,
    ) => () => void;
    onUpdateDownloaded: (callback: () => void) => () => void;
    onError: (callback: (error: { message: string }) => void) => () => void;
  };
}

const TOAST_ID = "dashboard-update";

export function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const w = window as unknown as { electronAPI?: ElectronAPI };
    const api = w.electronAPI?.updater;
    if (!api) return;

    const unsubscribeAvailable = api.onUpdateAvailable((info) => {
      logger.info("[UpdateNotification] Update available", info);
      setUpdateInfo(info);
      setIsDismissed(false);
    });

    const unsubscribeProgress = api.onDownloadProgress((progress) => {
      logger.debug(
        `[UpdateNotification] Download progress: ${progress.percent.toFixed(1)}%`,
      );
      setDownloadProgress(progress.percent);
    });

    const unsubscribeDownloaded = api.onUpdateDownloaded(() => {
      logger.info("[UpdateNotification] Update downloaded");
      setIsDownloaded(true);
      setDownloadProgress(null);
    });

    const unsubscribeError = api.onError((error) => {
      logger.error("[UpdateNotification] Error", error);

      // Filter out expected errors (no production release, private repo, etc.)
      const errMsg = error.message || "";
      if (
        errMsg.includes("404") ||
        errMsg.includes("406") ||
        errMsg.includes("Unable to find latest version") ||
        errMsg.includes("No published versions") ||
        errMsg.includes("authentication token") ||
        errMsg.includes("Cannot parse releases feed")
      ) {
        logger.info("[UpdateNotification] No production release available yet");
        return;
      }

      toastError(`Update check failed: ${error.message}`);
      setDownloadProgress(null);
    });

    return () => {
      unsubscribeAvailable();
      unsubscribeProgress();
      unsubscribeDownloaded();
      unsubscribeError();
    };
  }, []);

  // Show/update/dismiss toast based on state
  useEffect(() => {
    if (!updateInfo || isDismissed) {
      toast.dismiss(TOAST_ID);
      return;
    }

    const dismiss = () => setIsDismissed(true);

    const handleDownload = async () => {
      const w = window as unknown as { electronAPI?: ElectronAPI };
      const api = w.electronAPI?.updater;
      if (!api) return;
      setDownloadProgress(0);
      const result = await api.downloadUpdate();
      if (!result.success) {
        toastError(`Download failed: ${result.error}`);
        setDownloadProgress(null);
      }
    };

    const handleInstall = async () => {
      const w = window as unknown as { electronAPI?: ElectronAPI };
      const api = w.electronAPI?.updater;
      if (!api) return;
      const result = await api.installUpdate();
      if (!result.success) {
        toastError(`Install failed: ${result.error}`);
      }
    };

    toast.custom(
      () => (
        <Card className="w-96 p-4 shadow-xl border border-success/30 bg-card">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
                {isDownloaded ? (
                  <FaRocket className="h-4 w-4 text-success" />
                ) : (
                  <FaDownload className="h-4 w-4 text-success" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-sm">
                  {isDownloaded ? "Update Ready!" : "Update Available"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Version {updateInfo.version}
                </p>
              </div>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <FaXmark className="h-4 w-4" />
            </button>
          </div>

          {updateInfo.releaseNotes && (
            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
              {updateInfo.releaseNotes.replace(/<[^>]*>/g, "")}
            </p>
          )}

          {downloadProgress !== null && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Downloading...</span>
                <span className="font-medium">
                  {downloadProgress.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-success transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {isDownloaded ? (
              <>
                <Button onClick={handleInstall} className="flex-1" size="sm">
                  <FaRocket className="h-3.5 w-3.5 mr-2" />
                  Restart & Install
                </Button>
                <Button onClick={dismiss} variant="outline" size="sm">
                  Later
                </Button>
              </>
            ) : downloadProgress !== null ? (
              <Button disabled className="flex-1" size="sm">
                <FaSpinner className="h-3.5 w-3.5 mr-2 animate-spin" />
                Downloading...
              </Button>
            ) : (
              <>
                <Button onClick={handleDownload} className="flex-1" size="sm">
                  <FaDownload className="h-3.5 w-3.5 mr-2" />
                  Download Update
                </Button>
                <Button onClick={dismiss} variant="outline" size="sm">
                  Skip
                </Button>
              </>
            )}
          </div>
        </Card>
      ),
      {
        id: TOAST_ID,
        duration: Infinity,
        unstyled: true,
        onDismiss: () => setIsDismissed(true),
      },
    );
  }, [updateInfo, isDismissed, isDownloaded, downloadProgress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      toast.dismiss(TOAST_ID);
    };
  }, []);

  return null;
}
