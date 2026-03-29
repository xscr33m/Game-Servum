import { useRef, useState } from "react";
import {
  FaArrowsRotate,
  FaFolderPlus,
  FaFileCirclePlus,
  FaPen,
  FaTrash,
  FaChevronRight,
  FaDownload,
  FaUpload,
  FaTriangleExclamation,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";

interface FileExplorerToolbarProps {
  /** Currently selected path in the tree (file or directory), or null */
  selectedPath: string | null;
  /** Whether the selected path is a directory */
  selectedIsDirectory: boolean;
  onRefresh: () => void;
  onNewFile: (relativePath: string) => void;
  onNewFolder: (relativePath: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
  onDownload: (path: string) => void;
  onUpload: (files: FileList, targetDir: string) => void;
  uploading?: boolean;
  isLargeFile?: boolean;
}

function BreadcrumbPath({ path }: { path: string | null }) {
  if (!path)
    return <span className="text-muted-foreground text-sm">No selection</span>;

  const parts = path.split("/");
  return (
    <div className="flex items-center gap-0.5 text-sm min-w-0 overflow-hidden">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5 shrink-0">
          {i > 0 && (
            <FaChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
          )}
          <span
            className={
              i === parts.length - 1
                ? "text-foreground font-medium truncate"
                : "text-muted-foreground truncate"
            }
          >
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

export function FileExplorerToolbar({
  selectedPath,
  selectedIsDirectory,
  onRefresh,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onDownload,
  onUpload,
  uploading,
  isLargeFile,
}: FileExplorerToolbarProps) {
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [newFileName, setNewFileName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTo, setRenameTo] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine the parent directory for new file/folder creation
  function getBaseDir(): string {
    if (!selectedPath) return "";
    if (selectedIsDirectory) return selectedPath;
    // For files, use the parent directory
    const lastSlash = selectedPath.lastIndexOf("/");
    return lastSlash > 0 ? selectedPath.substring(0, lastSlash) : "";
  }

  function handleNewFile() {
    const base = getBaseDir();
    const fullPath = base ? `${base}/${newFileName}` : newFileName;
    onNewFile(fullPath);
    setNewFileName("");
    setNewFileOpen(false);
  }

  function handleNewFolder() {
    const base = getBaseDir();
    const fullPath = base ? `${base}/${newFolderName}` : newFolderName;
    onNewFolder(fullPath);
    setNewFolderName("");
    setNewFolderOpen(false);
  }

  function handleRename() {
    if (!selectedPath) return;
    const lastSlash = selectedPath.lastIndexOf("/");
    const parentDir = lastSlash > 0 ? selectedPath.substring(0, lastSlash) : "";
    const newPath = parentDir ? `${parentDir}/${renameTo}` : renameTo;
    onRename(selectedPath, newPath);
    setRenameTo("");
    setRenameOpen(false);
  }

  function handleDelete() {
    if (!selectedPath) return;
    onDelete(selectedPath);
    setDeleteOpen(false);
  }

  function openRenameDialog() {
    if (!selectedPath) return;
    const lastSlash = selectedPath.lastIndexOf("/");
    const currentName =
      lastSlash >= 0 ? selectedPath.substring(lastSlash + 1) : selectedPath;
    setRenameTo(currentName);
    setRenameOpen(true);
  }

  const selectedName = selectedPath
    ? selectedPath.substring(selectedPath.lastIndexOf("/") + 1)
    : "";

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="hidden lg:block min-w-0">
            <BreadcrumbPath path={selectedPath} />
          </div>
          {isLargeFile && (
            <span className="flex items-center gap-1 text-yellow-500 text-xs font-medium whitespace-nowrap">
              <FaTriangleExclamation className="h-3.5 w-3.5 shrink-0" />
              Large file
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          <Tip content="New File">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:h-7 lg:w-7"
              onClick={() => setNewFileOpen(true)}
            >
              <FaFileCirclePlus className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip content="New Folder">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:h-7 lg:w-7"
              onClick={() => setNewFolderOpen(true)}
            >
              <FaFolderPlus className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip content="Rename">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:h-7 lg:w-7"
              onClick={openRenameDialog}
              disabled={!selectedPath}
            >
              <FaPen className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip content="Delete">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:h-7 lg:w-7"
              onClick={() => setDeleteOpen(true)}
              disabled={!selectedPath}
            >
              <FaTrash className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <div className="w-px h-5 bg-border mx-0.5 hidden lg:block" />
          <Tip content="Download">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:h-7 lg:w-7"
              onClick={() => selectedPath && onDownload(selectedPath)}
              disabled={!selectedPath}
            >
              <FaDownload className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip content="Upload Files">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:h-7 lg:w-7"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <FaUpload className="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUpload(e.target.files, getBaseDir());
                e.target.value = "";
              }
            }}
          />
          <div className="w-px h-5 bg-border mx-0.5 hidden lg:block" />
          <Tip content="Refresh">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:h-7 lg:w-7"
              onClick={onRefresh}
            >
              <FaArrowsRotate className="h-3.5 w-3.5" />
            </Button>
          </Tip>
        </div>
      </div>

      {/* New File Dialog */}
      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Create a new file
              {getBaseDir() ? ` in ${getBaseDir()}/` : " in root directory"}
            </p>
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="filename.cfg"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFileName.trim()) handleNewFile();
              }}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setNewFileOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleNewFile}
              disabled={!newFileName.trim()}
              className="w-full sm:w-auto"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Create a new folder
              {getBaseDir() ? ` in ${getBaseDir()}/` : " in root directory"}
            </p>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="folder-name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newFolderName.trim())
                  handleNewFolder();
              }}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleNewFolder}
              disabled={!newFolderName.trim()}
              className="w-full sm:w-auto"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Enter a new name for "{selectedName}"
            </p>
            <Input
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              placeholder="New name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameTo.trim()) handleRename();
              }}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setRenameOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={!renameTo.trim()}
              className="w-full sm:w-auto"
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIsDirectory ? "Folder" : "File"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete "{selectedName}"?
            {selectedIsDirectory && " Only empty folders can be deleted."} This
            action cannot be undone.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="w-full sm:w-auto"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
