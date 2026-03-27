import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  FaArrowsRotate,
  FaFloppyDisk,
  FaRotateLeft,
  FaPencil,
  FaStopwatch,
  FaCommentDots,
  FaPlus,
  FaTrashCan,
  FaCode,
  FaDownload,
  FaShieldHalved,
  FaSpinner,
  FaChevronDown,
  FaChevronRight,
} from "react-icons/fa6";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useBackend } from "@/hooks/useBackend";
import { useGameCapabilities } from "@/hooks/useGameCapabilities";
import { toastSuccess } from "@/lib/toast";
import { UpdateCheckDialog } from "@/components/server-details/UpdateCheckDialog";
import { logger } from "@/lib/logger";
import type {
  GameServer,
  ServerSchedule,
  ServerMessage,
  ServerVariable,
  UpdateRestartSettings,
  FirewallStatus,
} from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert `{VAR_NAME}` into an input ref at cursor position, or append. */
function insertVariableIntoRef(
  ref: React.RefObject<HTMLInputElement | null>,
  setter: React.Dispatch<React.SetStateAction<string>>,
  varName: string,
) {
  const tag = `{${varName}}`;
  const el = ref.current;
  if (el && document.activeElement === el) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = before + tag + after;
    setter(next);
    requestAnimationFrame(() => {
      el.setSelectionRange(start + tag.length, start + tag.length);
      el.focus();
    });
  } else if (el) {
    setter((prev) => prev + tag);
    requestAnimationFrame(() => el.focus());
  } else {
    navigator.clipboard?.writeText(tag);
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Clickable variable tag that inserts into the active input. */
function VariableTag({
  name,
  description,
  onClick,
}: {
  name: string;
  description: string;
  onClick: (varName: string) => void;
}) {
  return (
    <button
      type="button"
      className="text-xs font-mono bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded cursor-pointer transition-colors"
      title={`${description} — click to insert`}
      onClick={() => onClick(name)}
    >
      {`{${name}}`}
    </button>
  );
}

/** Reusable row of variable tags. */
function VariableTags({
  hints,
  exclude,
  onInsert,
}: {
  hints: Array<{ name: string; description: string; builtin: boolean }>;
  exclude?: string[];
  onInsert: (varName: string) => void;
}) {
  const filtered = exclude
    ? hints.filter((v) => !exclude.includes(v.name))
    : hints;
  if (filtered.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {filtered.map((v) => (
        <VariableTag
          key={v.name}
          name={v.name}
          description={v.description}
          onClick={onInsert}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface SettingsTabProps {
  server: GameServer;
  onRefresh?: () => void;
}

export function SettingsTab({ server, onRefresh }: SettingsTabProps) {
  const { api, isConnected, subscribe } = useBackend();
  const { capabilities } = useGameCapabilities(server.gameId);

  const hasRcon = capabilities?.rcon !== false;

  // ── Firewall state ──
  const [firewallStatus, setFirewallStatus] = useState<FirewallStatus | null>(
    null,
  );
  const [firewallLoading, setFirewallLoading] = useState(true);
  const [firewallSaving, setFirewallSaving] = useState(false);
  const [firewallError, setFirewallError] = useState<string | null>(null);
  const [firewallOpen, setFirewallOpen] = useState(false);

  // ── Section expand/collapse ──
  const [urOpen, setUrOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // ── Schedule state ──
  const [schedule, setSchedule] = useState<ServerSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleInterval, setScheduleInterval] = useState("4");
  const [scheduleWarnings, setScheduleWarnings] = useState("15,5,1");
  const [scheduleMessage, setScheduleMessage] = useState(
    "Server restart in {MINUTES} minutes!",
  );
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // ── Scheduled messages state ──
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [addingMessage, setAddingMessage] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [msgInterval, setMsgInterval] = useState("30");
  const [msgEnabled, setMsgEnabled] = useState(true);
  const [msgSaving, setMsgSaving] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  // ── Template variables state ──
  const [variables, setVariables] = useState<ServerVariable[]>([]);
  const [builtinVars, setBuiltinVars] = useState<
    Array<{ name: string; description: string }>
  >([]);

  const [addingVar, setAddingVar] = useState(false);
  const [editingVarId, setEditingVarId] = useState<number | null>(null);
  const [varName, setVarName] = useState("");
  const [varValue, setVarValue] = useState("");
  const [varSaving, setVarSaving] = useState(false);
  const [varError, setVarError] = useState<string | null>(null);

  const handleToggleAutoRestart = useCallback(async () => {
    try {
      await api.servers.updateAutoRestart(server.id, !server.autoRestart);
      onRefresh?.();
    } catch (err) {
      logger.error("Failed to toggle auto-restart", err);
    }
  }, [server.id, server.autoRestart, onRefresh, api.servers]);

  // Load firewall status
  const loadFirewallStatus = useCallback(async () => {
    setFirewallLoading(true);
    setFirewallError(null);
    try {
      const status = await api.servers.getFirewallStatus(server.id);
      setFirewallStatus(status);
    } catch (err) {
      setFirewallError((err as Error).message);
    } finally {
      setFirewallLoading(false);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadFirewallStatus();
  }, [loadFirewallStatus, isConnected]);

  // Auto-refresh firewall status on WebSocket event
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (
        message.type === "firewall:updated" &&
        (message.payload as { serverId?: number })?.serverId === server.id
      ) {
        loadFirewallStatus();
      }
    });
    return unsubscribe;
  }, [subscribe, server.id, loadFirewallStatus]);

  const handleAddFirewallRules = useCallback(async () => {
    setFirewallSaving(true);
    setFirewallError(null);
    try {
      const result = await api.servers.addFirewallRules(server.id);
      if (!result.success) {
        setFirewallError(result.errors.join("; "));
      } else {
        toastSuccess(result.message);
      }
      await loadFirewallStatus();
    } catch (err) {
      setFirewallError((err as Error).message);
    } finally {
      setFirewallSaving(false);
    }
  }, [server.id, api.servers, loadFirewallStatus]);

  const handleRemoveFirewallRules = useCallback(async () => {
    setFirewallSaving(true);
    setFirewallError(null);
    try {
      const result = await api.servers.removeFirewallRules(server.id);
      if (!result.success) {
        setFirewallError(result.errors.join("; "));
      } else {
        toastSuccess(result.message);
      }
      await loadFirewallStatus();
    } catch (err) {
      setFirewallError((err as Error).message);
    } finally {
      setFirewallSaving(false);
    }
  }, [server.id, api.servers, loadFirewallStatus]);

  // ── Update-restart state ──
  const [updateRestart, setUpdateRestart] =
    useState<UpdateRestartSettings | null>(null);
  const [updateRestartLoading, setUpdateRestartLoading] = useState(true);
  const [urEnabled, setUrEnabled] = useState(false);
  const [urCheckInterval, setUrCheckInterval] = useState("30");
  const [urDelay, setUrDelay] = useState("5");
  const [urWarnings, setUrWarnings] = useState("5,1");
  const [urMessage, setUrMessage] = useState(
    "Server restarting in {MINUTES} minute(s) for mod updates",
  );
  const [urSaving, setUrSaving] = useState(false);
  const [urCheckDialogOpen, setUrCheckDialogOpen] = useState(false);
  const [urCheckGameUpdates, setUrCheckGameUpdates] = useState(true);
  const [urError, setUrError] = useState<string | null>(null);

  // ── Input refs for interactive variable insertion ──
  const scheduleMessageRef = useRef<HTMLInputElement>(null);
  const urMessageRef = useRef<HTMLInputElement>(null);
  const msgTextRef = useRef<HTMLInputElement>(null);

  // Track which input was last focused for variable insertion
  const activeInsertRef = useRef<{
    ref: React.RefObject<HTMLInputElement | null>;
    setter: React.Dispatch<React.SetStateAction<string>>;
  } | null>(null);

  // ── Variable hints (for tags) ──
  const allVariableHints = useMemo(
    () => [
      ...builtinVars.map((v) => ({
        name: v.name,
        description: v.description,
        builtin: true,
      })),
      ...variables.map((v) => ({
        name: v.name,
        description: v.value,
        builtin: false,
      })),
    ],
    [builtinVars, variables],
  );

  // ── Change detection ──
  const scheduleChanged = useMemo(() => {
    if (!schedule) {
      return (
        scheduleInterval !== "4" ||
        scheduleWarnings !== "15,5,1" ||
        scheduleMessage !== "Server restart in {MINUTES} minutes!" ||
        scheduleEnabled !== false
      );
    }
    return (
      scheduleInterval !== schedule.intervalHours.toString() ||
      scheduleWarnings !== schedule.warningMinutes.join(",") ||
      scheduleMessage !== schedule.warningMessage ||
      scheduleEnabled !== schedule.enabled
    );
  }, [
    schedule,
    scheduleInterval,
    scheduleWarnings,
    scheduleMessage,
    scheduleEnabled,
  ]);

  const urChanged = useMemo(() => {
    if (!updateRestart) {
      return (
        urEnabled !== false ||
        urCheckInterval !== "30" ||
        urDelay !== "5" ||
        urWarnings !== "5,1" ||
        urMessage !==
          "Server restarting in {MINUTES} minute(s) for mod updates" ||
        urCheckGameUpdates !== true
      );
    }
    return (
      urEnabled !== updateRestart.enabled ||
      urCheckInterval !== updateRestart.checkIntervalMinutes.toString() ||
      urDelay !== updateRestart.delayMinutes.toString() ||
      urWarnings !== updateRestart.warningMinutes.join(",") ||
      urMessage !== updateRestart.warningMessage ||
      urCheckGameUpdates !== updateRestart.checkGameUpdates
    );
  }, [
    updateRestart,
    urEnabled,
    urCheckInterval,
    urDelay,
    urWarnings,
    urMessage,
    urCheckGameUpdates,
  ]);

  // Load update restart settings
  const loadUpdateRestart = useCallback(async () => {
    try {
      const settings = await api.servers.getUpdateRestart(server.id);
      setUpdateRestart(settings);
      setUrEnabled(settings.enabled);
      setUrCheckInterval(settings.checkIntervalMinutes.toString());
      setUrDelay(settings.delayMinutes.toString());
      setUrWarnings(settings.warningMinutes.join(","));
      setUrMessage(settings.warningMessage);
      setUrCheckGameUpdates(settings.checkGameUpdates);
      if (settings.enabled) setUrOpen(true);
    } catch {
      // No settings yet
    } finally {
      setUpdateRestartLoading(false);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadUpdateRestart();
  }, [loadUpdateRestart, isConnected]);

  function handleRevertUpdateRestart() {
    if (updateRestart) {
      setUrEnabled(updateRestart.enabled);
      setUrCheckInterval(updateRestart.checkIntervalMinutes.toString());
      setUrDelay(updateRestart.delayMinutes.toString());
      setUrWarnings(updateRestart.warningMinutes.join(","));
      setUrMessage(updateRestart.warningMessage);
      setUrCheckGameUpdates(updateRestart.checkGameUpdates);
    } else {
      setUrEnabled(false);
      setUrCheckInterval("30");
      setUrDelay("5");
      setUrWarnings("5,1");
      setUrMessage("Server restarting in {MINUTES} minute(s) for mod updates");
      setUrCheckGameUpdates(true);
    }
    setUrError(null);
  }

  const handleSaveUpdateRestart = useCallback(async () => {
    const checkInterval = parseInt(urCheckInterval, 10);
    if (isNaN(checkInterval) || checkInterval < 5 || checkInterval > 1440) {
      setUrError("Check interval must be between 5 and 1440 minutes");
      return;
    }

    const delay = parseInt(urDelay, 10);
    if (isNaN(delay) || delay < 1 || delay > 60) {
      setUrError("Restart delay must be between 1 and 60 minutes");
      return;
    }

    const warnings = urWarnings
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    if (warnings.length === 0) {
      setUrError("At least one warning time is required");
      return;
    }

    if (!urMessage.trim()) {
      setUrError("Warning message is required");
      return;
    }

    setUrSaving(true);
    setUrError(null);
    try {
      const result = await api.servers.updateUpdateRestart(server.id, {
        enabled: urEnabled,
        checkIntervalMinutes: checkInterval,
        delayMinutes: delay,
        warningMinutes: warnings,
        warningMessage: urMessage.trim(),
        checkGameUpdates: urCheckGameUpdates,
      });
      setUpdateRestart(result.settings);
      toastSuccess("Settings saved");
    } catch (err) {
      setUrError((err as Error).message);
    } finally {
      setUrSaving(false);
    }
  }, [
    server.id,
    urEnabled,
    urCheckInterval,
    urDelay,
    urWarnings,
    urMessage,
    urCheckGameUpdates,
    api.servers,
  ]);

  // Load schedule
  const loadSchedule = useCallback(async () => {
    try {
      const result = await api.servers.getSchedule(server.id);
      setSchedule(result.schedule);
      if (result.schedule) {
        setScheduleInterval(result.schedule.intervalHours.toString());
        setScheduleWarnings(result.schedule.warningMinutes.join(","));
        setScheduleMessage(result.schedule.warningMessage);
        setScheduleEnabled(result.schedule.enabled);
        if (result.schedule.enabled) setScheduleOpen(true);
      }
    } catch {
      // No schedule yet
    } finally {
      setScheduleLoading(false);
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadSchedule();
  }, [loadSchedule, isConnected]);

  // Load messages
  const loadMessages = useCallback(async () => {
    try {
      const result = await api.servers.getMessages(server.id);
      setMessages(result.messages);
    } catch {
      // ignore
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadMessages();
  }, [loadMessages, isConnected]);

  const handleSaveSchedule = useCallback(async () => {
    const interval = parseInt(scheduleInterval, 10);
    if (isNaN(interval) || interval < 1 || interval > 168) {
      setScheduleError("Interval must be between 1 and 168 hours");
      return;
    }

    const warnings = scheduleWarnings
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    if (warnings.length === 0) {
      setScheduleError("At least one warning time is required");
      return;
    }

    if (!scheduleMessage.trim()) {
      setScheduleError("Warning message is required");
      return;
    }

    setScheduleSaving(true);
    setScheduleError(null);
    try {
      const result = await api.servers.updateSchedule(server.id, {
        intervalHours: interval,
        warningMinutes: warnings,
        warningMessage: scheduleMessage.trim(),
        enabled: scheduleEnabled,
      });
      setSchedule(result.schedule);
      toastSuccess("Schedule saved");
    } catch (err) {
      setScheduleError((err as Error).message);
    } finally {
      setScheduleSaving(false);
    }
  }, [
    server.id,
    scheduleInterval,
    scheduleWarnings,
    scheduleMessage,
    scheduleEnabled,
    api.servers,
  ]);

  function handleRevertSchedule() {
    if (schedule) {
      setScheduleInterval(schedule.intervalHours.toString());
      setScheduleWarnings(schedule.warningMinutes.join(","));
      setScheduleMessage(schedule.warningMessage);
      setScheduleEnabled(schedule.enabled);
    } else {
      setScheduleInterval("4");
      setScheduleWarnings("15,5,1");
      setScheduleMessage("Server restart in {MINUTES} minutes!");
      setScheduleEnabled(false);
    }
    setScheduleError(null);
  }

  // Message handlers
  function resetMessageForm() {
    setMsgText("");
    setMsgInterval("30");
    setMsgEnabled(true);
    setMsgError(null);
  }

  function startEditMessage(msg: ServerMessage) {
    setEditingMessageId(msg.id);
    setMsgText(msg.message);
    setMsgInterval(msg.intervalMinutes.toString());
    setMsgEnabled(msg.enabled);
    setMsgError(null);
    setAddingMessage(false);
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setAddingMessage(false);
    resetMessageForm();
  }

  const handleSaveMessage = useCallback(async () => {
    const interval = parseInt(msgInterval, 10);
    if (!msgText.trim()) {
      setMsgError("Message text is required");
      return;
    }
    if (isNaN(interval) || interval < 1 || interval > 1440) {
      setMsgError("Interval must be between 1 and 1440 minutes");
      return;
    }

    setMsgSaving(true);
    setMsgError(null);
    try {
      if (editingMessageId) {
        await api.servers.updateMessage(server.id, editingMessageId, {
          message: msgText.trim(),
          intervalMinutes: interval,
          enabled: msgEnabled,
        });
        toastSuccess("Message updated");
      } else {
        await api.servers.createMessage(server.id, {
          message: msgText.trim(),
          intervalMinutes: interval,
          enabled: msgEnabled,
        });
        toastSuccess("Message created");
      }
      setEditingMessageId(null);
      setAddingMessage(false);
      resetMessageForm();
      await loadMessages();
    } catch (err) {
      setMsgError((err as Error).message);
    } finally {
      setMsgSaving(false);
    }
  }, [
    server.id,
    editingMessageId,
    msgText,
    msgInterval,
    msgEnabled,
    loadMessages,
    api.servers,
  ]);

  const handleDeleteMessage = useCallback(
    async (messageId: number) => {
      try {
        await api.servers.deleteMessage(server.id, messageId);
        await loadMessages();
        toastSuccess("Message deleted");
      } catch (err) {
        setMsgError((err as Error).message);
      }
    },
    [server.id, loadMessages, api.servers],
  );

  const handleToggleMessage = useCallback(
    async (msg: ServerMessage) => {
      try {
        await api.servers.updateMessage(server.id, msg.id, {
          message: msg.message,
          intervalMinutes: msg.intervalMinutes,
          enabled: !msg.enabled,
        });
        await loadMessages();
      } catch (err) {
        setMsgError((err as Error).message);
      }
    },
    [server.id, loadMessages, api.servers],
  );

  // Load variables
  const loadVariables = useCallback(async () => {
    try {
      const [varsResult, builtinsResult] = await Promise.all([
        api.servers.getVariables(server.id),
        api.servers.getBuiltinVariables(),
      ]);
      setVariables(varsResult.variables);
      setBuiltinVars(builtinsResult.variables);
    } catch {
      // ignore
    }
  }, [server.id, api.servers]);

  useEffect(() => {
    if (!isConnected) return;
    loadVariables();
  }, [loadVariables, isConnected]);

  // Variable handlers
  function resetVarForm() {
    setVarName("");
    setVarValue("");
    setVarError(null);
  }

  function startEditVar(v: ServerVariable) {
    setEditingVarId(v.id);
    setVarName(v.name);
    setVarValue(v.value);
    setVarError(null);
    setAddingVar(false);
  }

  function cancelEditVar() {
    setEditingVarId(null);
    setAddingVar(false);
    resetVarForm();
  }

  const handleSaveVariable = useCallback(async () => {
    const cleanName = varName
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "");
    if (!cleanName) {
      setVarError("Variable name is required");
      return;
    }

    setVarSaving(true);
    setVarError(null);
    try {
      await api.servers.upsertVariable(server.id, cleanName, varValue);
      toastSuccess(editingVarId ? "Variable updated" : "Variable created");
      setEditingVarId(null);
      setAddingVar(false);
      resetVarForm();
      await loadVariables();
    } catch (err) {
      setVarError((err as Error).message);
    } finally {
      setVarSaving(false);
    }
  }, [server.id, editingVarId, varName, varValue, loadVariables, api.servers]);

  const handleDeleteVariable = useCallback(
    async (variableId: number) => {
      try {
        await api.servers.deleteVariable(server.id, variableId);
        await loadVariables();
        toastSuccess("Variable deleted");
      } catch (err) {
        setVarError((err as Error).message);
      }
    },
    [server.id, loadVariables, api.servers],
  );

  // Insert a variable tag into whatever input was last focused
  const handleInsertVariable = useCallback((varName: string) => {
    const target = activeInsertRef.current;
    if (target) {
      insertVariableIntoRef(target.ref, target.setter, varName);
    } else {
      navigator.clipboard?.writeText(`{${varName}}`);
    }
  }, []);

  return (
    <>
      <div className="space-y-0">
        {/* ─── Auto-Restart on Crash ─── */}
        <div className="pb-6 border-b">
          <div className="flex items-center gap-2 mb-3">
            <FaArrowsRotate className="h-4 w-4 text-ring" />
            <label className="text-sm font-medium text-muted-foreground">
              Auto-Restart on Crash
            </label>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Auto-Restart</p>
              <p className="text-xs text-muted-foreground">
                Restarts with a 10s delay. Stops after 3 crashes in 10 min.
              </p>
            </div>
            <Switch
              checked={server.autoRestart}
              onCheckedChange={handleToggleAutoRestart}
            />
          </div>
        </div>

        {/* ─── Auto-Restart on Update (collapsible) ─── */}
        {hasRcon && (
          <div className="py-6 border-b">
            <button
              type="button"
              className="flex items-center justify-between w-full text-left cursor-pointer group"
              onClick={() => setUrOpen((o) => !o)}
            >
              <div className="flex items-center gap-2">
                <FaDownload className="h-4 w-4 text-ring" />
                <span className="text-sm font-medium text-muted-foreground">
                  Auto-Restart on Update
                </span>
                {!updateRestartLoading && (
                  <Badge variant={urEnabled ? "success" : "secondary"}>
                    {urEnabled ? "Active" : "Disabled"}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setUrCheckDialogOpen(true);
                  }}
                >
                  <FaArrowsRotate className="h-3.5 w-3.5 mr-1.5" />
                  Check Now
                </Button>
                {urOpen ? (
                  <FaChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                ) : (
                  <FaChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                )}
              </div>
            </button>

            {/* Collapsed summary */}
            {!urOpen && !updateRestartLoading && urEnabled && (
              <p className="text-xs text-muted-foreground mt-2 ml-6">
                Check every {urCheckInterval} min · {urDelay} min delay ·
                Warnings at {urWarnings} min
              </p>
            )}

            {/* Expanded form */}
            {urOpen && (
              <div className="mt-4 space-y-4 rounded-lg border p-4">
                {/* Enabled */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Enable Auto-Update Restart
                  </label>
                  <Switch checked={urEnabled} onCheckedChange={setUrEnabled} />
                </div>

                {/* Check game server updates */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">
                      Check Game Server Updates
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Also check for game server updates via SteamCMD build ID
                    </p>
                  </div>
                  <Switch
                    checked={urCheckGameUpdates}
                    onCheckedChange={setUrCheckGameUpdates}
                  />
                </div>

                {/* Check interval + Restart delay */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground block mb-1">
                      Check Interval (minutes)
                    </label>
                    <Input
                      className="font-mono text-sm"
                      type="number"
                      min={5}
                      max={1440}
                      value={urCheckInterval}
                      onChange={(e) => setUrCheckInterval(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Check every {urCheckInterval || "?"} minute(s)
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground block mb-1">
                      Restart Delay (minutes)
                    </label>
                    <Input
                      className="font-mono text-sm"
                      type="number"
                      min={1}
                      max={60}
                      value={urDelay}
                      onChange={(e) => setUrDelay(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Wait {urDelay || "?"} min after detecting updates
                    </p>
                  </div>
                </div>

                {/* Warning times */}
                <div>
                  <label className="text-sm font-medium text-muted-foreground block mb-1">
                    Warning Times (minutes)
                  </label>
                  <Input
                    className="font-mono text-sm"
                    value={urWarnings}
                    onChange={(e) => setUrWarnings(e.target.value)}
                    placeholder="5,1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Comma-separated. Warnings sent via RCON in-game chat.
                  </p>
                </div>

                {/* Warning message */}
                <div>
                  <label className="text-sm font-medium text-muted-foreground block mb-1">
                    Warning Message
                  </label>
                  <Input
                    ref={urMessageRef}
                    className="text-sm"
                    value={urMessage}
                    onChange={(e) => setUrMessage(e.target.value)}
                    onFocus={() => {
                      activeInsertRef.current = {
                        ref: urMessageRef,
                        setter: setUrMessage,
                      };
                    }}
                    placeholder="Server restarting in {MINUTES} minute(s) for mod updates"
                  />
                  <VariableTags
                    hints={allVariableHints}
                    onInsert={handleInsertVariable}
                  />
                </div>

                {urError && <p className="text-xs text-red-500">{urError}</p>}

                {/* Save / Revert */}
                {urChanged && (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRevertUpdateRestart}
                      disabled={urSaving}
                    >
                      <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                      Revert
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveUpdateRestart}
                      disabled={urSaving}
                    >
                      <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                      {urSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── Scheduled Restarts (collapsible) ─── */}
        {hasRcon && (
          <div className="py-6 border-b">
            <button
              type="button"
              className="flex items-center justify-between w-full text-left cursor-pointer group"
              onClick={() => setScheduleOpen((o) => !o)}
            >
              <div className="flex items-center gap-2">
                <FaStopwatch className="h-4 w-4 text-ring" />
                <span className="text-sm font-medium text-muted-foreground">
                  Scheduled Restarts
                </span>
                {!scheduleLoading && (
                  <Badge variant={scheduleEnabled ? "success" : "secondary"}>
                    {scheduleEnabled ? "Active" : "Disabled"}
                  </Badge>
                )}
              </div>
              {scheduleOpen ? (
                <FaChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              ) : (
                <FaChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              )}
            </button>

            {/* Collapsed summary */}
            {!scheduleOpen && !scheduleLoading && scheduleEnabled && (
              <p className="text-xs text-muted-foreground mt-2 ml-6">
                Every {scheduleInterval}h · Warnings at {scheduleWarnings} min
                {schedule?.nextRestart && schedule.enabled && (
                  <>
                    {" "}
                    · Next: {new Date(schedule.nextRestart).toLocaleString()}
                  </>
                )}
              </p>
            )}

            {/* Expanded form */}
            {scheduleOpen && (
              <div className="mt-4 space-y-4 rounded-lg border p-4">
                {/* Enabled */}
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Enable Schedule</label>
                  <Switch
                    checked={scheduleEnabled}
                    onCheckedChange={setScheduleEnabled}
                  />
                </div>

                {/* Interval + Warning times */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground block mb-1">
                      Restart Interval (hours)
                    </label>
                    <Input
                      className="font-mono text-sm"
                      type="number"
                      min={1}
                      max={168}
                      value={scheduleInterval}
                      onChange={(e) => setScheduleInterval(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Restart every {scheduleInterval || "?"} hour(s)
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-muted-foreground block mb-1">
                      Warning Times (minutes)
                    </label>
                    <Input
                      className="font-mono text-sm"
                      value={scheduleWarnings}
                      onChange={(e) => setScheduleWarnings(e.target.value)}
                      placeholder="15,5,1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Comma-separated. Warnings sent via RCON.
                    </p>
                  </div>
                </div>

                {/* Warning message */}
                <div>
                  <label className="text-sm font-medium text-muted-foreground block mb-1">
                    Warning Message
                  </label>
                  <Input
                    ref={scheduleMessageRef}
                    className="text-sm"
                    value={scheduleMessage}
                    onChange={(e) => setScheduleMessage(e.target.value)}
                    onFocus={() => {
                      activeInsertRef.current = {
                        ref: scheduleMessageRef,
                        setter: setScheduleMessage,
                      };
                    }}
                    placeholder="Server restart in {MINUTES} minutes!"
                  />
                  <VariableTags
                    hints={allVariableHints}
                    onInsert={handleInsertVariable}
                  />
                </div>

                {/* Next / last restart info */}
                {schedule && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {schedule.nextRestart && schedule.enabled && (
                      <p>
                        Next restart:{" "}
                        {new Date(schedule.nextRestart).toLocaleString()}
                      </p>
                    )}
                    {schedule.lastRestart && (
                      <p>
                        Last restart:{" "}
                        {new Date(schedule.lastRestart).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}

                {scheduleError && (
                  <p className="text-xs text-red-500">{scheduleError}</p>
                )}

                {/* Save / Revert */}
                {scheduleChanged && (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRevertSchedule}
                      disabled={scheduleSaving}
                    >
                      <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                      Revert
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveSchedule}
                      disabled={scheduleSaving}
                    >
                      <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                      {scheduleSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── Scheduled Messages ─── */}
        {hasRcon && (
          <div className="py-6 border-b">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FaCommentDots className="h-4 w-4 text-ring" />
                <label className="text-sm font-medium text-muted-foreground">
                  Scheduled Messages
                </label>
              </div>
              {!addingMessage && editingMessageId === null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    resetMessageForm();
                    setAddingMessage(true);
                  }}
                >
                  <FaPlus className="h-3.5 w-3.5 mr-1.5" />
                  Add
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {/* Add / Edit form */}
              {(addingMessage || editingMessageId !== null) && (
                <div className="space-y-3 border rounded-lg p-3">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground block mb-1">
                      Message Text
                    </label>
                    <Input
                      ref={msgTextRef}
                      className="text-sm"
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      onFocus={() => {
                        activeInsertRef.current = {
                          ref: msgTextRef,
                          setter: setMsgText,
                        };
                      }}
                      placeholder="Welcome to {SERVER_NAME}! Rules: {DISCORD}"
                    />
                    <VariableTags
                      hints={allVariableHints}
                      exclude={["MINUTES"]}
                      onInsert={handleInsertVariable}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground block mb-1">
                        Interval (min)
                      </label>
                      <Input
                        className="font-mono text-sm"
                        type="number"
                        min={1}
                        max={1440}
                        value={msgInterval}
                        onChange={(e) => setMsgInterval(e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="flex items-center gap-2 pb-0.5">
                        <Switch
                          checked={msgEnabled}
                          onCheckedChange={setMsgEnabled}
                        />
                        <label className="text-sm font-medium">Enabled</label>
                      </div>
                    </div>
                  </div>
                  {msgError && (
                    <p className="text-xs text-red-500">{msgError}</p>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={cancelEditMessage}
                      disabled={msgSaving}
                    >
                      <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveMessage}
                      disabled={msgSaving}
                    >
                      <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                      {msgSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Message list — compact rows */}
              {messages.length > 0 ? (
                <div className="space-y-2">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className="flex items-center gap-3 bg-muted/50 p-2.5 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={msg.enabled ? "success" : "secondary"}
                            className="text-xs shrink-0"
                          >
                            {msg.enabled ? "On" : "Off"}
                          </Badge>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {msg.intervalMinutes}m
                          </span>
                          <p className="text-sm font-mono truncate">
                            {msg.message}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          checked={msg.enabled}
                          onCheckedChange={() => handleToggleMessage(msg)}
                          className="scale-75"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => startEditMessage(msg)}
                          disabled={editingMessageId !== null || addingMessage}
                        >
                          <FaPencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-600"
                          onClick={() => handleDeleteMessage(msg.id)}
                        >
                          <FaTrashCan className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                !addingMessage && (
                  <p className="text-sm text-muted-foreground">
                    No messages yet. Click "Add" to create one.
                  </p>
                )
              )}
            </div>
          </div>
        )}

        {/* ─── Template Variables ─── */}
        <div className="py-6 border-b">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FaCode className="h-4 w-4 text-ring" />
              <label className="text-sm font-medium text-muted-foreground">
                Template Variables
              </label>
            </div>
            {!addingVar && editingVarId === null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetVarForm();
                  setAddingVar(true);
                }}
              >
                <FaPlus className="h-3.5 w-3.5 mr-1.5" />
                Add
              </Button>
            )}
          </div>

          <div className="space-y-4">
            {/* Built-in variables */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Built-in Variables
              </p>
              <div className="flex flex-wrap gap-1.5">
                {builtinVars.map((v) => (
                  <span
                    key={v.name}
                    className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded font-mono"
                    title={v.description}
                  >
                    {`{${v.name}}`}
                    <span className="text-muted-foreground font-sans">
                      — {v.description}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {/* Add / Edit form */}
            {(addingVar || editingVarId !== null) && (
              <div className="space-y-3 border rounded-lg p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground block mb-1">
                      Variable Name
                    </label>
                    <Input
                      className="font-mono text-sm uppercase"
                      value={varName}
                      onChange={(e) => setVarName(e.target.value)}
                      placeholder="DISCORD"
                      disabled={editingVarId !== null}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Used as{" "}
                      <code className="font-mono text-primary bg-muted px-1 py-0.5 rounded">
                        {`{${varName.toUpperCase().replace(/[^A-Z0-9_]/g, "") || "NAME"}}`}
                      </code>{" "}
                      in messages
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground block mb-1">
                      Value
                    </label>
                    <Input
                      className="text-sm"
                      value={varValue}
                      onChange={(e) => setVarValue(e.target.value)}
                      placeholder="discord.gg/example"
                    />
                  </div>
                </div>
                {varError && <p className="text-xs text-red-500">{varError}</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={cancelEditVar}
                    disabled={varSaving}
                  >
                    <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveVariable}
                    disabled={varSaving}
                  >
                    <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
                    {varSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            )}

            {/* Custom variables list */}
            {variables.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Custom Variables
                </p>
                <div className="space-y-2">
                  {variables.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between gap-3 bg-muted p-3 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <code className="text-sm font-mono text-primary">
                          {`{${v.name}}`}
                        </code>
                        <span className="text-sm text-muted-foreground ml-2">
                          → {v.value}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => startEditVar(v)}
                          disabled={editingVarId !== null || addingVar}
                        >
                          <FaPencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-600"
                          onClick={() => handleDeleteVariable(v.id)}
                        >
                          <FaTrashCan className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              !addingVar && (
                <p className="text-sm text-muted-foreground">
                  No custom variables defined. Click "Add" to create one (e.g.
                  DISCORD, WEBSITE, TEAMSPEAK).
                </p>
              )
            )}
          </div>
        </div>

        {/* ─── Windows Firewall Rules (collapsible) ─── */}
        <div className="py-6">
          <button
            type="button"
            className="flex items-center justify-between w-full text-left cursor-pointer group"
            onClick={() => setFirewallOpen((o) => !o)}
          >
            <div className="flex items-center gap-2">
              <FaShieldHalved className="h-4 w-4 text-ring" />
              <span className="text-sm font-medium text-muted-foreground">
                Windows Firewall Rules
              </span>
              {!firewallLoading && firewallStatus && (
                <Badge
                  variant={firewallStatus.allPresent ? "success" : "warning"}
                >
                  {firewallStatus.allPresent
                    ? "All configured"
                    : `${firewallStatus.rules.filter((r) => !r.exists).length + (firewallStatus.executableRule.exists ? 0 : 1)} missing`}
                </Badge>
              )}
            </div>
            {firewallOpen ? (
              <FaChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            ) : (
              <FaChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>

          {firewallOpen && (
            <div className="mt-4 space-y-4">
              {firewallStatus ? (
                <div className="space-y-3 rounded-lg border p-4">
                  {/* Action button */}
                  <div className="flex items-center gap-2">
                    {firewallStatus.allPresent ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleRemoveFirewallRules}
                        disabled={firewallSaving}
                      >
                        {firewallSaving ? (
                          <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FaTrashCan className="mr-2 h-4 w-4" />
                        )}
                        Remove Rules
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleAddFirewallRules}
                        disabled={firewallSaving}
                      >
                        {firewallSaving ? (
                          <FaSpinner className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FaShieldHalved className="mr-2 h-4 w-4" />
                        )}
                        {firewallStatus.rules.some((r) => r.exists) ||
                        firewallStatus.executableRule.exists
                          ? "Add Missing Rules"
                          : "Add Rules"}
                      </Button>
                    )}
                  </div>

                  {/* Port rules */}
                  <div className="space-y-2">
                    {firewallStatus.rules.map((rule) => (
                      <div
                        key={rule.name}
                        className="flex items-center justify-between gap-3 bg-muted/50 p-3 rounded-lg"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {rule.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {rule.protocol} {rule.ports}
                          </p>
                        </div>
                        <Badge
                          variant={rule.exists ? "success" : "destructive"}
                        >
                          {rule.exists ? "Active" : "Missing"}
                        </Badge>
                      </div>
                    ))}

                    {/* Executable rule */}
                    <div className="flex items-center justify-between gap-3 bg-muted/50 p-3 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Program Rule</p>
                        <p className="text-xs text-muted-foreground">
                          {server.executable ?? "Server executable"}
                        </p>
                      </div>
                      <Badge
                        variant={
                          firewallStatus.executableRule.exists
                            ? "success"
                            : "destructive"
                        }
                      >
                        {firewallStatus.executableRule.exists
                          ? "Active"
                          : "Missing"}
                      </Badge>
                    </div>
                  </div>

                  {firewallError && (
                    <p className="text-xs text-red-500">{firewallError}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Could not check firewall rules.
                  </p>
                  {firewallError && (
                    <p className="text-xs text-red-500">{firewallError}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Update Check Dialog */}
      <UpdateCheckDialog
        open={urCheckDialogOpen}
        onOpenChange={setUrCheckDialogOpen}
        serverId={server.id}
      />
    </>
  );
}
