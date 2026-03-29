import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  FaFolderOpen,
  FaTriangleExclamation,
  FaChevronDown,
  FaChevronRight,
  FaFolder,
} from "react-icons/fa6";
import { useBackend } from "@/hooks/useBackend";
import { toastSuccess, toastError } from "@/lib/toast";
import type { BrowseTreeEntry } from "@/lib/api";
import { FileTree } from "./FileTree";
import { FileEditor } from "./FileEditor";
import { FileExplorerToolbar } from "./FileExplorerToolbar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface FileExplorerProps {
  serverId: number;
  rootKey: string;
}

interface OpenFile {
  path: string;
  content: string;
  originalContent: string;
  size: number;
}

export function FileExplorer({ serverId, rootKey }: FileExplorerProps) {
  const { api } = useBackend();
  const [tree, setTree] = useState<BrowseTreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedIsDirectory, setSelectedIsDirectory] = useState(false);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Overwrite confirmation dialog state
  const [overwriteDialog, setOverwriteDialog] = useState<{
    files: File[];
    targetDir: string;
    conflicts: string[];
  } | null>(null);

  // Resizable sidebar
  const SIDEBAR_MIN = 150;
  const SIDEBAR_MAX = 600;
  const SIDEBAR_DEFAULT = 256;
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const isResizing = useRef(false);

  // Mobile collapsible sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizing.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, newWidth)));
    }
    function handleMouseUp() {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  function handleResizeStart() {
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

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

  async function handleDownload(filePath: string) {
    const name = filePath.split("/").pop() ?? filePath;
    const toastId = toast.loading(`Preparing download "${name}"...`);
    try {
      await api.servers.browseDownload(serverId, rootKey, filePath);
      toast.success(`Download "${name}" ready`, { id: toastId });
    } catch (err) {
      toast.dismiss(toastId);
      toastError(err instanceof Error ? err.message : "Download failed");
    }
  }

  // Find files in the tree that exist at the given directory path
  function getExistingFileNames(
    entries: BrowseTreeEntry[],
    dirPath: string,
  ): Set<string> {
    if (!dirPath) {
      // Root level — return file names at top level
      return new Set(
        entries.filter((e) => e.type === "file").map((e) => e.name),
      );
    }
    const parts = dirPath.split("/");
    let current = entries;
    for (const part of parts) {
      const dir = current.find(
        (e) => e.type === "directory" && e.name === part,
      );
      if (!dir?.children) return new Set();
      current = dir.children;
    }
    return new Set(current.filter((e) => e.type === "file").map((e) => e.name));
  }

  async function handleUpload(files: FileList, targetDir: string) {
    const fileArray = Array.from(files);

    // Check for conflicts using the already-loaded tree data
    const existing = getExistingFileNames(tree, targetDir);
    const conflicts = fileArray
      .map((f) => f.name)
      .filter((name) => existing.has(name));

    if (conflicts.length > 0) {
      // Show confirmation dialog
      setOverwriteDialog({ files: fileArray, targetDir, conflicts });
      return;
    }

    await executeUpload(fileArray, targetDir);
  }

  async function executeUpload(files: File[], targetDir: string) {
    try {
      setUploading(true);
      const result = await api.servers.browseUpload(
        serverId,
        rootKey,
        targetDir,
        files,
      );
      toastSuccess(result.message);
      await loadTree();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to upload");
    } finally {
      setUploading(false);
    }
  }

  function handleOverwriteConfirm() {
    if (!overwriteDialog) return;
    const { files, targetDir } = overwriteDialog;
    setOverwriteDialog(null);
    executeUpload(files, targetDir);
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
        onDownload={handleDownload}
        onUpload={handleUpload}
        uploading={uploading}
        isLargeFile={openFile != null && openFile.size > 512 * 1024}
      />

      {/* Mobile toggle for file tree */}
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="lg:hidden flex items-center gap-2 px-3 py-2 border-b bg-muted/30 text-sm font-medium hover:bg-muted/50 transition-colors w-full text-left"
      >
        {sidebarOpen ? (
          <FaChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <FaChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <FaFolder className="h-3.5 w-3.5 text-ring/70" />
        Files
      </button>

      {/* Main content area */}
      <div
        ref={containerRef}
        className="flex flex-col lg:flex-row flex-1 min-h-0"
      >
        {/* Sidebar */}
        <div
          className={`border-b lg:border-b-0 lg:border-r shrink-0 overflow-hidden flex flex-col lg:w-[var(--sidebar-w)] ${
            sidebarOpen
              ? "max-h-64 lg:max-h-none overflow-y-auto"
              : "hidden lg:flex"
          }`}
          style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
        >
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
              onUpload={handleUpload}
            />
          )}
        </div>

        {/* Resize handle — desktop only */}
        <div
          className="hidden lg:block w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
          onMouseDown={handleResizeStart}
        />

        {/* Editor area */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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

      {/* Overwrite Confirmation Dialog */}
      <Dialog
        open={overwriteDialog !== null}
        onOpenChange={(open) => {
          if (!open) setOverwriteDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FaTriangleExclamation className="h-4 w-4 text-yellow-500" />
              Overwrite existing files?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The following{" "}
              {overwriteDialog?.conflicts.length === 1 ? "file" : "files"}{" "}
              already{" "}
              {overwriteDialog?.conflicts.length === 1 ? "exists" : "exist"} in{" "}
              <span className="font-medium text-foreground">
                {overwriteDialog?.targetDir || "root"}
              </span>{" "}
              and will be replaced:
            </p>
            <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
              {overwriteDialog?.conflicts.map((name) => (
                <li key={name} className="font-mono text-destructive">
                  {name}
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setOverwriteDialog(null)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleOverwriteConfirm}
              className="w-full sm:w-auto"
            >
              Replace{" "}
              {overwriteDialog?.conflicts.length === 1 ? "file" : "files"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
