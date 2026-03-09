import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  FaDownload,
  FaArrowsRotate,
  FaRotateRight,
  FaXmark,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toastError } from "@/lib/toast";
import type { UpdateState } from "@/types";
import type { ApiClient } from "@/lib/api";

interface AgentUpdateNotificationProps {
  updateState: UpdateState;
  agentName: string;
  api: ApiClient;
  onInstallStarted: () => void;
}

/**
 * Persistent card notification shown when an agent update is available.
 * Rendered as a Sonner custom toast for proper stacking with other notifications.
 */

const TOAST_ID = "agent-update";

export function AgentUpdateNotification({
  updateState,
  agentName,
  api,
  onInstallStarted,
}: AgentUpdateNotificationProps) {
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Show/update/dismiss toast based on state
  useEffect(() => {
    if (dismissed || !updateState.updateAvailable) {
      toast.dismiss(TOAST_ID);
      return;
    }

    const { downloaded } = updateState;
    const isDownloading = downloading || updateState.downloading;
    const dismiss = () => setDismissed(true);

    const handleDownload = async () => {
      setDownloading(true);
      try {
        await api.system.downloadUpdate();
      } catch (err) {
        toastError((err as Error).message);
        setDownloading(false);
      }
    };

    const handleInstall = async () => {
      try {
        await api.system.installUpdate();
        setDismissed(true);
        onInstallStarted();
      } catch (err) {
        toastError((err as Error).message);
      }
    };

    toast.custom(
      () => (
        <Card className="w-96 p-4 shadow-xl border border-success/30 bg-card">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-success/10 flex items-center justify-center">
                {downloaded ? (
                  <FaRotateRight className="h-4 w-4 text-success" />
                ) : (
                  <FaDownload className="h-4 w-4 text-success" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-sm">
                  {downloaded
                    ? "Agent Update Ready!"
                    : "Agent Update Available"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {agentName} — v{updateState.currentVersion} → v
                  {updateState.latestVersion}
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

          {isDownloading && updateState.downloadProgress != null && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Downloading...</span>
                <span className="font-medium">
                  {updateState.downloadProgress.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-success transition-all duration-300"
                  style={{ width: `${updateState.downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {downloaded ? (
              <>
                <Button onClick={handleInstall} className="flex-1" size="sm">
                  <FaRotateRight className="h-3.5 w-3.5 mr-2" />
                  Install & Restart Agent
                </Button>
                <Button onClick={dismiss} variant="outline" size="sm">
                  Later
                </Button>
              </>
            ) : isDownloading ? (
              <Button disabled className="flex-1" size="sm">
                <FaArrowsRotate className="h-3.5 w-3.5 mr-2 animate-spin" />
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
        onDismiss: () => setDismissed(true),
      },
    );
  }, [updateState, dismissed, downloading, agentName, api, onInstallStarted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      toast.dismiss(TOAST_ID);
    };
  }, []);

  return null;
}
