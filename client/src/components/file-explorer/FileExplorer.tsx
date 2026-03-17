import { useState, useEffect, useCallback } from "react";
import { FaFolderOpen } from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess, toastError } from "@/lib/toast";
import type { BrowseTreeEntry } from "@/lib/api";
import { FileTree } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { FileExplorerToolbar } from "./FileExplorerToolbar";

interface FileExplorerProps {
  serverId: number;
  rootKey: string;
  rootLabel?: string;
}

interface OpenFile {
  path: string;
  content: string;
  originalContent: string;
  size: number;
}

export function FileExplorer({
  serverId,
  rootKey,
  rootLabel,
}: FileExplorerProps) {
  const { api } = useBackend();
  const [tree, setTree] = useState<BrowseTreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedIsDirectory, setSelectedIsDirectory] = useState(false);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadTree = useCallback(async () => {
    try {
      setLoading(true);
      const result = await api.servers.browseTree(serverId, rootKey);
      setTree(result.tree);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Failed to load file tree",
      );
    } finally {
      setLoading(false);
    }
  }, [api.servers, serverId, rootKey]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  async function handleFileSelect(relativePath: string) {
    setSelectedPath(relativePath);
    setSelectedIsDirectory(false);
    try {
      setFileLoading(true);
      const result = await api.servers.browseReadFile(
        serverId,
        rootKey,
        relativePath,
      );
      setOpenFile({
        path: relativePath,
        content: result.content,
        originalContent: result.content,
        size: result.size,
      });
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to open file");
    } finally {
      setFileLoading(false);
    }
  }

  function handleDirectorySelect(relativePath: string) {
    setSelectedPath(relativePath);
    setSelectedIsDirectory(true);
  }

  async function handleSave(content: string) {
    if (!openFile) return;
    try {
      setSaving(true);
      await api.servers.browseWriteFile(
        serverId,
        rootKey,
        openFile.path,
        content,
      );
      setOpenFile((prev) =>
        prev ? { ...prev, content, originalContent: content } : null,
      );
      toastSuccess("File saved");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!openFile) return;
    setOpenFile((prev) =>
      prev ? { ...prev, content: prev.originalContent } : null,
    );
  }

  function handleContentChange(content: string) {
    setOpenFile((prev) => (prev ? { ...prev, content } : null));
  }

  async function handleNewFile(relativePath: string) {
    try {
      await api.servers.browseCreateFile(serverId, rootKey, relativePath);
      toastSuccess("File created");
      await loadTree();
      // Auto-open the new file
      await handleFileSelect(relativePath);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create file");
    }
  }

  async function handleNewFolder(relativePath: string) {
    try {
      await api.servers.browseCreateDirectory(serverId, rootKey, relativePath);
      toastSuccess("Folder created");
      await loadTree();
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "Failed to create folder",
      );
    }
  }

  async function handleRename(from: string, to: string) {
    try {
      await api.servers.browseRename(serverId, rootKey, from, to);
      toastSuccess("Renamed successfully");
      // If we renamed the open file, update its path
      if (openFile && openFile.path === from) {
        setOpenFile((prev) => (prev ? { ...prev, path: to } : null));
      }
      setSelectedPath(to);
      await loadTree();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to rename");
    }
  }

  async function handleDelete(path: string) {
    try {
      if (selectedIsDirectory) {
        await api.servers.browseDeleteDirectory(serverId, rootKey, path);
      } else {
        await api.servers.browseDeleteFile(serverId, rootKey, path);
      }
      toastSuccess("Deleted successfully");
      // If we deleted the open file, close it
      if (openFile && openFile.path === path) {
        setOpenFile(null);
      }
      setSelectedPath(null);
      await loadTree();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  const fileName = openFile?.path.split("/").pop() ?? "";

  return (
    <div className="flex flex-col h-full border rounded-lg overflow-hidden">
      {/* Toolbar */}
      <FileExplorerToolbar
        selectedPath={selectedPath}
        selectedIsDirectory={selectedIsDirectory}
        onRefresh={loadTree}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-64 border-r shrink-0 overflow-hidden flex flex-col">
          {rootLabel && (
            <div className="px-3 py-1.5 border-b bg-muted/50">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {rootLabel}
              </span>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : (
            <FileTree
              tree={tree}
              selectedPath={selectedPath}
              onFileSelect={handleFileSelect}
              onDirectorySelect={handleDirectorySelect}
            />
          )}
        </div>

        {/* Editor area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {fileLoading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading file...
            </div>
          ) : openFile ? (
            <FileEditor
              content={openFile.content}
              originalContent={openFile.originalContent}
              fileName={fileName}
              fileSize={openFile.size}
              saving={saving}
              onSave={handleSave}
              onReset={handleReset}
              onContentChange={handleContentChange}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <FaFolderOpen className="h-10 w-10 opacity-30" />
              <p className="text-sm">Select a file to edit</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
