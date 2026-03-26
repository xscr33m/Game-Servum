import { useState, useEffect, useCallback } from "react";
import { FaFolderTree } from "react-icons/fa6";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { FileExplorer } from "@/components/file-explorer/FileExplorer";
import { useBackend } from "@/hooks/useBackend";
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
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading file browser...
        </CardContent>
      </Card>
    );
  }

  if (roots.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No browsable directories available for this server.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)] min-h-[400px]">
      {/* Root selector */}
      {roots.length > 1 ? (
        <div className="flex items-center gap-3 shrink-0">
          <FaFolderTree className="h-4 w-4 text-muted-foreground shrink-0" />
          <Select value={selectedRoot} onValueChange={setSelectedRoot}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Select directory..." />
            </SelectTrigger>
            <SelectContent>
              {roots.map((root) => (
                <SelectItem key={root.key} value={root.key}>
                  {root.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
          <FaFolderTree className="h-4 w-4" />
          <span className="font-medium">{roots[0].label}</span>
        </div>
      )}

      {/* File Explorer */}
      {selectedRoot && (
        <div className="flex-1 min-h-0">
          <FileExplorer
            key={selectedRoot}
            serverId={server.id}
            rootKey={selectedRoot}
          />
        </div>
      )}
    </div>
  );
}
