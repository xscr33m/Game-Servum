import { useState, useMemo, useCallback } from "react";
import {
  FaFolder,
  FaFolderOpen,
  FaFile,
  FaChevronRight,
  FaChevronDown,
  FaMagnifyingGlass,
  FaSpinner,
} from "react-icons/fa6";
import { Input } from "@/components/ui/input";
import type { BrowseListEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

interface FileTreeProps {
  dirCache: Map<string, BrowseListEntry[]>;
  loadingDirs: Set<string>;
  selectedPath: string | null;
  onFileSelect: (relativePath: string) => void;
  onDirectorySelect?: (relativePath: string) => void;
  onExpandDir: (dirPath: string) => void;
  onUpload?: (files: FileList, targetDir: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesFilter(entry: BrowseListEntry, filter: string): boolean {
  return entry.name.toLowerCase().includes(filter.toLowerCase());
}

function filterEntries(
  entries: BrowseListEntry[],
  filter: string,
): BrowseListEntry[] {
  if (!filter) return entries;
  return entries.filter((entry) => matchesFilter(entry, filter));
}

interface TreeNodeProps {
  entry: BrowseListEntry;
  depth: number;
  parentPath: string;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  dirCache: Map<string, BrowseListEntry[]>;
  loadingDirs: Set<string>;
  filter: string;
  dragOverDir: string | null;
  onToggleDir: (path: string) => void;
  onFileSelect: (relativePath: string) => void;
  onDirectorySelect?: (relativePath: string) => void;
  onDragOverDir: (path: string | null) => void;
  onDropOnDir: (files: FileList, dirPath: string) => void;
}

function TreeNode({
  entry,
  depth,
  parentPath,
  selectedPath,
  expandedDirs,
  dirCache,
  loadingDirs,
  filter,
  dragOverDir,
  onToggleDir,
  onFileSelect,
  onDirectorySelect,
  onDragOverDir,
  onDropOnDir,
}: TreeNodeProps) {
  const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const isExpanded = expandedDirs.has(currentPath);
  const isSelected = selectedPath === currentPath;
  const isDirectory = entry.type === "directory";
  const isEditable = entry.editable !== false;
  const isDragTarget = isDirectory && dragOverDir === currentPath;
  const isLoading = isDirectory && loadingDirs.has(currentPath);
  const hasExpandArrow =
    isDirectory && (entry.hasChildren !== false || dirCache.has(currentPath));

  function handleClick() {
    if (isDirectory) {
      onToggleDir(currentPath);
      onDirectorySelect?.(currentPath);
    } else if (isEditable) {
      onFileSelect(currentPath);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    if (!isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    onDragOverDir(currentPath);
  }

  function handleDrop(e: React.DragEvent) {
    if (!isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    onDragOverDir(null);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropOnDir(e.dataTransfer.files, currentPath);
    }
  }

  // Get children from the cache for this directory
  const children =
    isDirectory && isExpanded ? dirCache.get(currentPath) : undefined;
  const filteredChildren = children
    ? filterEntries(children, filter)
    : undefined;

  return (
    <>
      <Tip
        content={
          !isEditable && !isDirectory
            ? `${entry.name} — Binary file, cannot be edited`
            : entry.name
        }
        side="right"
      >
        <button
          type="button"
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            "flex items-center gap-1.5 w-full text-left py-2 lg:py-1 px-2 text-sm rounded-sm hover:bg-accent/50 transition-colors",
            isSelected && "bg-accent text-accent-foreground",
            !isEditable && !isDirectory && "opacity-50 cursor-not-allowed",
            isDragTarget && "bg-primary/20 ring-1 ring-primary/50",
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          disabled={!isDirectory && !isEditable}
        >
          {isDirectory ? (
            <>
              {isLoading ? (
                <FaSpinner className="h-3 w-3 shrink-0 text-muted-foreground animate-spin" />
              ) : hasExpandArrow ? (
                isExpanded ? (
                  <FaChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <FaChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="w-3 shrink-0" />
              )}
              {isExpanded ? (
                <FaFolderOpen className="h-4 w-4 shrink-0 text-ring/70" />
              ) : (
                <FaFolder className="h-4 w-4 shrink-0 text-ring/70" />
              )}
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <FaFile className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
          <span className="truncate flex-1">{entry.name}</span>
          {entry.type === "file" && entry.size != null && (
            <span className="text-xs text-muted-foreground shrink-0 ml-1">
              {formatFileSize(entry.size)}
            </span>
          )}
        </button>
      </Tip>
      {isDirectory && isExpanded && filteredChildren && (
        <div>
          {filteredChildren.map((child) => (
            <TreeNode
              key={child.name}
              entry={child}
              depth={depth + 1}
              parentPath={currentPath}
              selectedPath={selectedPath}
              expandedDirs={expandedDirs}
              dirCache={dirCache}
              loadingDirs={loadingDirs}
              filter={filter}
              dragOverDir={dragOverDir}
              onToggleDir={onToggleDir}
              onFileSelect={onFileSelect}
              onDirectorySelect={onDirectorySelect}
              onDragOverDir={onDragOverDir}
              onDropOnDir={onDropOnDir}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function FileTree({
  dirCache,
  loadingDirs,
  selectedPath,
  onFileSelect,
  onDirectorySelect,
  onExpandDir,
  onUpload,
}: FileTreeProps) {
  const [filter, setFilter] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);

  const filteredRootEntries = useMemo(
    () => filterEntries(dirCache.get(".") ?? [], filter),
    [dirCache, filter],
  );

  function handleToggleDir(dirPath: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        // Trigger lazy-load when expanding
        onExpandDir(dirPath);
      }
      return next;
    });
  }

  const handleRootDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onUpload) return;
      e.preventDefault();
      // Only highlight root when dragging directly over the container (not over a folder node)
      if (e.target === e.currentTarget) {
        setIsDragOverRoot(true);
        setDragOverDir(null);
      }
    },
    [onUpload],
  );

  const handleRootDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!onUpload) return;
      e.preventDefault();
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setIsDragOverRoot(false);
        setDragOverDir(null);
      }
    },
    [onUpload],
  );

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onUpload) return;
      e.preventDefault();
      setIsDragOverRoot(false);
      setDragOverDir(null);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onUpload(e.dataTransfer.files, "");
      }
    },
    [onUpload],
  );

  const handleDragOverDir = useCallback((dirPath: string | null) => {
    setDragOverDir(dirPath);
    setIsDragOverRoot(false);
  }, []);

  const handleDropOnDir = useCallback(
    (files: FileList, dirPath: string) => {
      if (!onUpload) return;
      setDragOverDir(null);
      setIsDragOverRoot(false);
      onUpload(files, dirPath);
    },
    [onUpload],
  );

  const showDragOverlay = isDragOverRoot && !dragOverDir;

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 border-b">
        <div className="relative">
          <FaMagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter open folders..."
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>
      <div
        className={cn(
          "flex-1 overflow-y-auto py-1 transition-colors",
          showDragOverlay && "bg-primary/10 ring-2 ring-inset ring-primary/40",
        )}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {showDragOverlay ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-primary font-medium">
              Drop files here to upload to root
            </p>
          </div>
        ) : filteredRootEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {filter ? "No matching files" : "Empty directory"}
          </p>
        ) : (
          filteredRootEntries.map((entry) => (
            <TreeNode
              key={entry.name}
              entry={entry}
              depth={0}
              parentPath=""
              selectedPath={selectedPath}
              expandedDirs={expandedDirs}
              dirCache={dirCache}
              loadingDirs={loadingDirs}
              filter={filter}
              dragOverDir={dragOverDir}
              onToggleDir={handleToggleDir}
              onFileSelect={onFileSelect}
              onDirectorySelect={onDirectorySelect}
              onDragOverDir={handleDragOverDir}
              onDropOnDir={handleDropOnDir}
            />
          ))
        )}
      </div>
    </div>
  );
}
