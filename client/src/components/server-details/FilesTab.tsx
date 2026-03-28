import { useState, useEffect, useCallback } from "react";
import { FaFolderTree } from "react-icons/fa6";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileExplorer } from "@/components/file-explorer/FileExplorer";
import { useBackend } from "@/hooks/useBackend";
import { useContentWidth } from "@/hooks/useContentWidth";
import { cn } from "@/lib/utils";
import type { GameServer } from "@/types";

interface BrowsableRoot {
  key: string;
  label: string;
}

interface FilesTabProps {
  server: GameServer;
}

export function FilesTab({ server }: FilesTabProps) {
  const { api, isConnected } = useBackend();
  const { contentClass } = useContentWidth();
  const [roots, setRoots] = useState<BrowsableRoot[]>([]);
  const [selectedRoot, setSelectedRoot] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const loadRoots = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.servers.browseRoots(server.id);
      setRoots(data.roots);
      if (data.roots.length > 0 && !selectedRoot) {
        setSelectedRoot(data.roots[0].key);
      }
    } catch {
      // Non-critical — will show empty state
    } finally {
      setLoading(false);
    }
  }, [server.id, api.servers, selectedRoot]);

  useEffect(() => {
    if (isConnected) {
      loadRoots();
    }
  }, [isConnected, loadRoots]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FaFolderTree className="h-8 w-8 mx-auto mb-2 opacity-50 animate-pulse" />
          <p className="text-sm">Loading file browser...</p>
        </div>
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FaFolderTree className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No browsable directories available</p>
          <p className="text-xs mt-1">
            Directories will appear after the server has been started once.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Tabs
      value={selectedRoot}
      onValueChange={setSelectedRoot}
      className="flex flex-col flex-1 min-h-0 pt-2"
    >
      {/* ── Header toolbar ── */}
      <div className="shrink-0 bg-background px-4">
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 pb-2 border-b",
            contentClass,
          )}
        >
          <div className="flex items-center gap-3">
            {roots.length > 1 ? (
              <TabsList>
                {roots.map((root) => (
                  <TabsTrigger
                    key={root.key}
                    value={root.key}
                    className="gap-2"
                  >
                    <FaFolderTree className="h-4 w-4 text-ring/70" />
                    {root.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            ) : (
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <FaFolderTree className="h-4 w-4 text-ring" />
                {roots[0].label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* File Explorer */}
      {selectedRoot && (
        <div className={cn("flex-1 min-h-0 px-4 py-4", contentClass)}>
          <FileExplorer
            key={selectedRoot}
            serverId={server.id}
            rootKey={selectedRoot}
          />
        </div>
      )}
    </Tabs>
  );
}
