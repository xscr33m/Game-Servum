import { useMemo, useCallback } from "react";
import {
  FaFloppyDisk,
  FaRotateLeft,
  FaTriangleExclamation,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { CodeMirrorEditor } from "@/components/ui/code-editor";

interface FileEditorProps {
  content: string;
  originalContent: string;
  fileName: string;
  fileSize?: number;
  saving?: boolean;
  onSave: (content: string) => void;
  onReset: () => void;
  onContentChange: (content: string) => void;
}

const LARGE_FILE_THRESHOLD = 512 * 1024; // 500KB

export function FileEditor({
  content,
  originalContent,
  fileName,
  fileSize,
  saving,
  onSave,
  onReset,
  onContentChange,
}: FileEditorProps) {
  const isLargeFile = (fileSize ?? 0) > LARGE_FILE_THRESHOLD;

  const hasChanges = useMemo(() => {
    const normalizedContent = content.replace(/\r\n/g, "\n");
    const normalizedOriginal = originalContent.replace(/\r\n/g, "\n");
    return normalizedContent !== normalizedOriginal;
  }, [content, originalContent]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      onContentChange(newContent);
    },
    [onContentChange],
  );

  const handleSave = useCallback(
    (currentContent: string) => {
      onSave(currentContent);
    },
    [onSave],
  );

  const handleReset = useCallback(() => {
    onReset();
  }, [onReset]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{fileName}</span>
          {hasChanges && <Badge variant="warning">Unsaved</Badge>}
          {isLargeFile && (
            <Tip content="This file is large. Editor performance may be affected.">
              <Badge
                variant="outline"
                className="gap-1 text-yellow-500 border-yellow-500/50 cursor-help"
              >
                <FaTriangleExclamation className="h-3 w-3" />
                Large file
              </Badge>
            </Tip>
          )}
          {fileSize != null && (
            <span className="text-xs text-muted-foreground">
              {fileSize < 1024
                ? `${fileSize} B`
                : fileSize < 1024 * 1024
                  ? `${(fileSize / 1024).toFixed(1)} KB`
                  : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!hasChanges || saving}
          >
            <FaRotateLeft className="h-3.5 w-3.5 mr-1.5" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => handleSave(content)}
            disabled={!hasChanges || saving}
          >
            <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <CodeMirrorEditor
        content={content}
        originalContent={originalContent}
        fileName={fileName}
        onContentChange={handleContentChange}
        onSave={handleSave}
      />
    </div>
  );
}
