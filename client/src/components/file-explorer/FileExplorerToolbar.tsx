import { useState } from "react";
import {
  FaArrowsRotate,
  FaFolderPlus,
  FaCirclePlus,
  FaPen,
  FaTrash,
  FaChevronRight,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
}: FileExplorerToolbarProps) {
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [newFileName, setNewFileName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [renameTo, setRenameTo] = useState("");

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
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <BreadcrumbPath path={selectedPath} />
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setNewFileOpen(true)}
            title="New File"
          >
            <FaCirclePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setNewFolderOpen(true)}
            title="New Folder"
          >
            <FaFolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={openRenameDialog}
            disabled={!selectedPath}
            title="Rename"
          >
            <FaPen className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setDeleteOpen(true)}
            disabled={!selectedPath}
            title="Delete"
          >
            <FaTrash className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRefresh}
            title="Refresh"
          >
            <FaArrowsRotate className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* New File Dialog */}
      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
            <DialogDescription>
              Create a new file
              {getBaseDir() ? ` in ${getBaseDir()}/` : " in root directory"}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="filename.cfg"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFileName.trim()) handleNewFile();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleNewFile} disabled={!newFileName.trim()}>
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
            <DialogDescription>
              Create a new folder
              {getBaseDir() ? ` in ${getBaseDir()}/` : " in root directory"}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="folder-name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim()) handleNewFolder();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleNewFolder} disabled={!newFolderName.trim()}>
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
            <DialogDescription>Rename "{selectedName}"</DialogDescription>
          </DialogHeader>
          <Input
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            placeholder="New name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTo.trim()) handleRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!renameTo.trim()}>
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
            <DialogDescription>
              Are you sure you want to delete "{selectedName}"?
              {selectedIsDirectory &&
                " Only empty folders can be deleted."}{" "}
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
