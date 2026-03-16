import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft,
  FaSpinner,
  FaChartLine,
  FaPalette,
  FaGlobe,
  FaDesktop,
  FaDownload,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useBackend } from "@/hooks/useBackend";
import { publicAsset } from "@/lib/assets";
import { AppHeader } from "@/components/AppHeader";
import { AgentStatusBanner } from "@/components/agent/AgentStatusBanner";
import { getElectronSettings } from "@/lib/electronSettings";
import { logger } from "@/lib/logger";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";

// Detect if we're in Electron
const isElectron = typeof window !== "undefined" && "electronAPI" in window;

export function Settings() {
  const navigate = useNavigate();
  const { api, isConnected } = useBackend();
  const [isWindows, setIsWindows] = useState(false);
  const [monitoringEnabled, setMonitoringEnabled] = useState(() => {
    return (
      getElectronSettings().getItem("system_monitoring_enabled") === "true"
    );
  });
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(() => {
    return getElectronSettings().getItem("auto_update_enabled") !== "false";
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Desktop app settings (load synchronously from app-settings.json)
  const [launchOnStartup, setLaunchOnStartup] = useState(() => {
    const value = getElectronSettings().getItem("launch_on_startup");
    logger.debug(
      `[Settings] Initial launch_on_startup from cache: "${value}" (parsed as ${value === "true"})`,
    );
    return value === "true";
  });
  const [minimizeToTray, setMinimizeToTray] = useState(() => {
    const value = getElectronSettings().getItem("minimize_to_tray");
    logger.debug(
      `[Settings] Initial minimize_to_tray from cache: "${value}" (parsed as ${value !== "false"})`,
    );
    return value !== "false";
  });

  useEffect(() => {
    // Detect platform (Windows vs Linux/macOS)
    if (isElectron && window.electronAPI?.app) {
      window.electronAPI.app
        .getPlatform()
        .then((platform: string) => {
          setIsWindows(platform === "win32");
          logger.debug(`[Settings] Platform detected: ${platform}`);
        })
        .catch((err) => {
          logger.error("[Settings] Failed to detect platform:", err);
        });
    }

    api.system
      .getSettings()
      .then(async (s) => {
        setMonitoringEnabled(s.monitoringEnabled);
        await getElectronSettings().setItemAsync(
          "system_monitoring_enabled",
          String(s.monitoringEnabled),
        );
      })
      .catch(() => {});

    // Verify launch-on-startup setting from Electron (sync with OS registry)
    // Only on Windows - Linux AppImages don't support reliable auto-start
    if (isElectron && window.electronAPI?.app) {
      window.electronAPI.app
        .getLaunchOnStartup()
        .then(async (result) => {
          if (result.success) {
            const cachedValue =
              getElectronSettings().getItem("launch_on_startup") === "true";
            logger.debug(
              `[Settings] Launch on startup - Cache: ${cachedValue}, Registry: ${result.enabled}`,
            );

            // Only sync if there's a real discrepancy
            // Priority: Cache is source of truth, update Registry to match if needed
            if (cachedValue !== result.enabled) {
              logger.info(
                `[Settings] Registry mismatch detected, updating Registry to match cache: ${cachedValue}`,
              );
              // Update Registry to match our cached preference
              if (window.electronAPI?.app) {
                const updateResult =
                  await window.electronAPI.app.setLaunchOnStartup(cachedValue);
                if (!updateResult.success) {
                  logger.error(
                    "[Settings] Failed to update Registry, syncing UI to Registry value",
                  );
                  // If we can't update registry, fall back to registry value
                  await getElectronSettings().setItemAsync(
                    "launch_on_startup",
                    String(result.enabled),
                  );
                  setLaunchOnStartup(result.enabled);
                }
              }
            }
          }
        })
        .catch((err) => {
          logger.error("[Settings] Failed to get launch on startup:", err);
        });
    }
  }, [api.system]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <AppHeader
        left={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <FaArrowLeft className="h-4 w-4 mr-2" />
              <img
                src={publicAsset("dashboard-icon.png")}
                alt=""
                className="h-7 w-auto mr-1"
              />
            </Button>
            <div className="h-7 w-px bg-border" />
            <h1 className="text-xl font-bold">Settings</h1>
          </>
        }
      />

      <AgentStatusBanner />

      <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="max-w-6xl mx-auto px-6 py-6">
          {/* ── General Settings ── */}
          <section className="rounded-lg border bg-card mb-6">
            <div className="px-4 py-3 border-b bg-muted/30">
              <h2 className="font-semibold text-sm">General</h2>
            </div>
            <div className="divide-y">
              {/* System Monitoring */}
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <FaChartLine className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label
                      htmlFor="monitoring-toggle"
                      className="text-sm font-medium cursor-pointer"
                    >
                      System Monitoring
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Show real-time CPU, memory, disk, and network usage on
                    Dashboard
                  </p>
                </div>
                <Switch
                  id="monitoring-toggle"
                  checked={monitoringEnabled}
                  disabled={!isConnected}
                  onCheckedChange={async (checked) => {
                    try {
                      await api.system.updateSettings({
                        monitoringEnabled: checked,
                      });
                      setMonitoringEnabled(checked);
                      await getElectronSettings().setItemAsync(
                        "system_monitoring_enabled",
                        String(checked),
                      );
                      toastSuccess(
                        checked
                          ? "System monitoring enabled"
                          : "System monitoring disabled",
                      );
                    } catch {
                      toastError("Failed to update setting");
                    }
                  }}
                />
              </div>

              {/* Auto-Update - only in Electron */}
              {isElectron && (
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <FaDownload className="h-3.5 w-3.5 text-muted-foreground" />
                        <Label
                          htmlFor="auto-update-toggle"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Auto-Update
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Automatically check for updates every 4 hours
                      </p>
                    </div>
                    <Switch
                      id="auto-update-toggle"
                      checked={autoUpdateEnabled}
                      onCheckedChange={async (checked) => {
                        setAutoUpdateEnabled(checked);
                        await getElectronSettings().setItemAsync(
                          "auto_update_enabled",
                          String(checked),
                        );
                        toastSuccess(
                          checked
                            ? "Auto-update enabled"
                            : "Auto-update disabled",
                        );
                        if (!checked) {
                          toastInfo("Restart to apply changes", {
                            duration: 3000,
                          });
                        }
                      }}
                    />
                  </div>
                  <Button
                    onClick={async () => {
                      setCheckingUpdate(true);
                      try {
                        const w = window as {
                          electronAPI?: {
                            updater?: {
                              checkForUpdates: () => Promise<{
                                success: boolean;
                                updateInfo?: unknown;
                              }>;
                            };
                          };
                        };
                        if (w.electronAPI?.updater?.checkForUpdates) {
                          const result =
                            await w.electronAPI.updater.checkForUpdates();
                          if (!result?.updateInfo) {
                            toastInfo("You're running the latest version");
                          }
                        }
                      } catch {
                        toastError("Could not check for updates");
                      } finally {
                        setTimeout(() => setCheckingUpdate(false), 2000);
                      }
                    }}
                    disabled={checkingUpdate}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    {checkingUpdate ? (
                      <FaSpinner className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <FaDownload className="h-3.5 w-3.5 mr-2" />
                    )}
                    Check for Updates Now
                  </Button>
                </div>
              )}
            </div>
          </section>

          {/* ── Appearance (Coming Soon) ── */}
          <section className="rounded-lg border bg-card mb-6 opacity-60">
            <div className="px-4 py-3 border-b bg-muted/30">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">Appearance</h2>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Coming Soon
                </Badge>
              </div>
            </div>
            <div className="divide-y">
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <FaPalette className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label className="text-sm font-medium">Theme</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Dark, light, or system preference
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled
                    className="px-3 py-1.5 text-xs rounded border bg-ring/10 border-ring text-foreground disabled:cursor-not-allowed"
                  >
                    Dark
                  </button>
                  <button
                    disabled
                    className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground disabled:cursor-not-allowed"
                  >
                    Light
                  </button>
                  <button
                    disabled
                    className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground disabled:cursor-not-allowed"
                  >
                    System
                  </button>
                </div>
              </div>

              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <FaGlobe className="h-3.5 w-3.5 text-muted-foreground" />
                    <Label className="text-sm font-medium">Language</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Interface language
                  </p>
                </div>
                <button
                  disabled
                  className="px-3 py-1.5 text-xs rounded border bg-ring/10 border-ring text-foreground disabled:cursor-not-allowed"
                >
                  English
                </button>
              </div>
            </div>
          </section>

          {/* ── Desktop App ── */}
          {isElectron && (
            <section className="rounded-lg border bg-card mb-6">
              <div className="px-4 py-3 border-b bg-muted/30">
                <h2 className="font-semibold text-sm">Desktop App</h2>
              </div>
              <div className="divide-y">
                {/* Launch on startup - Windows only (AppImages don't support reliable auto-start) */}
                {isWindows && (
                  <div className="px-4 py-3 flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <FaDesktop className="h-3.5 w-3.5 text-muted-foreground" />
                        <Label
                          htmlFor="launch-startup-toggle"
                          className="text-sm font-medium cursor-pointer"
                        >
                          Launch on startup
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Start automatically when Windows boots
                      </p>
                    </div>
                    <Switch
                      id="launch-startup-toggle"
                      checked={launchOnStartup}
                      onCheckedChange={async (checked) => {
                        if (!window.electronAPI?.app) return;
                        logger.info(
                          `[Settings] User toggled launch_on_startup to: ${checked}`,
                        );
                        try {
                          const result =
                            await window.electronAPI.app.setLaunchOnStartup(
                              checked,
                            );
                          logger.debug(
                            `[Settings] setLaunchOnStartup result:`,
                            result,
                          );
                          if (result.success) {
                            setLaunchOnStartup(checked);
                            // Store in app-settings.json for immediate loading on next start
                            await getElectronSettings().setItemAsync(
                              "launch_on_startup",
                              String(checked),
                            );
                            logger.debug(
                              `[Settings] Saved launch_on_startup to cache: ${checked}`,
                            );
                            // Verify it was saved
                            const savedValue =
                              getElectronSettings().getItem(
                                "launch_on_startup",
                              );
                            logger.debug(
                              `[Settings] Verified cache value: ${savedValue}`,
                            );
                            toastSuccess(
                              checked
                                ? "Launch on startup enabled"
                                : "Launch on startup disabled",
                            );
                          } else {
                            logger.error(
                              "[Settings] Failed to set launch on startup:",
                              result.error,
                            );
                            toastError("Failed to update setting");
                          }
                        } catch (err) {
                          logger.error(
                            "[Settings] Exception setting launch on startup:",
                            err,
                          );
                          toastError("Failed to update setting");
                        }
                      }}
                    />
                  </div>
                )}

                <div className="px-4 py-3 flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <Label
                      htmlFor="minimize-tray-toggle"
                      className="text-sm font-medium cursor-pointer"
                    >
                      Minimize to tray
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Keep running in system tray when window is closed
                    </p>
                  </div>
                  <Switch
                    id="minimize-tray-toggle"
                    checked={minimizeToTray}
                    onCheckedChange={async (checked) => {
                      setMinimizeToTray(checked);
                      await getElectronSettings().setItemAsync(
                        "minimize_to_tray",
                        String(checked),
                      );
                      toastSuccess(
                        checked
                          ? "Minimize to tray enabled"
                          : "App will close normally when window is closed",
                      );
                    }}
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
