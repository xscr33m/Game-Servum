import { useEffect, useRef, useState, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
} from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import {
  FaFloppyDisk,
  FaRotateLeft,
  FaTriangleExclamation,
} from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

function getLanguageExtension(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json":
      return json();
    case "xml":
    case "html":
    case "htm":
      return xml();
    default:
      return [];
  }
}

// Dark theme matching the app
const darkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      fontSize: "13px",
      height: "100%",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "hsl(var(--foreground))",
      fontFamily:
        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
    },
    ".cm-cursor": {
      borderLeftColor: "hsl(var(--foreground))",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "hsl(var(--accent))",
    },
    ".cm-activeLine": {
      backgroundColor: "hsl(var(--accent) / 0.3)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "hsl(var(--accent) / 0.3)",
    },
    ".cm-gutters": {
      backgroundColor: "hsl(var(--muted))",
      color: "hsl(var(--muted-foreground))",
      borderRight: "1px solid hsl(var(--border))",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 4px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      padding: "0 4px",
    },
    ".cm-searchMatch": {
      backgroundColor: "hsl(var(--ring) / 0.3)",
    },
    ".cm-selectionMatch": {
      backgroundColor: "hsl(var(--ring) / 0.2)",
    },
    ".cm-panels": {
      backgroundColor: "hsl(var(--muted))",
      color: "hsl(var(--foreground))",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid hsl(var(--border))",
    },
    ".cm-panel.cm-search input": {
      backgroundColor: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      border: "1px solid hsl(var(--border))",
    },
    ".cm-panel.cm-search button": {
      backgroundColor: "hsl(var(--muted))",
      color: "hsl(var(--foreground))",
    },
    ".cm-tooltip": {
      backgroundColor: "hsl(var(--popover))",
      color: "hsl(var(--popover-foreground))",
      border: "1px solid hsl(var(--border))",
    },
  },
  { dark: true },
);

export function FileEditor({
  content: rawContent,
  originalContent: rawOriginalContent,
  fileName,
  fileSize,
  saving,
  onSave,
  onReset,
  onContentChange,
}: FileEditorProps) {
  // Normalize line endings — CodeMirror uses \n internally,
  // so \r\n from Windows files would cause false "unsaved" diffs
  const content = rawContent.replace(/\r\n/g, "\n");
  const originalContent = rawOriginalContent.replace(/\r\n/g, "\n");

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const onContentChangeRef = useRef(onContentChange);
  const onSaveRef = useRef(onSave);
  const contentRef = useRef(content);
  const originalContentRef = useRef(originalContent);

  // Keep refs in sync
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
    onSaveRef.current = onSave;
    contentRef.current = content;
    originalContentRef.current = originalContent;
  });

  const isLargeFile = (fileSize ?? 0) > LARGE_FILE_THRESHOLD;

  // Initialize editor
  useEffect(() => {
    if (!editorRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          const currentContent = viewRef.current?.state.doc.toString() ?? "";
          onSaveRef.current(currentContent);
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        const changed = newContent !== originalContentRef.current;
        setHasChanges(changed);
        onContentChangeRef.current(newContent);
      }
    });

    const state = EditorState.create({
      doc: contentRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        saveKeymap,
        updateListener,
        getLanguageExtension(fileName),
        darkTheme,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [fileName]); // Recreate when switching files

  // Sync content when it changes externally (e.g., reset or save)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentDoc = view.state.doc.toString();
    if (currentDoc !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentDoc.length,
          insert: content,
        },
      });
    }
    // Always recompute hasChanges when content or originalContent change
    // (e.g., after save sets originalContent = content)
    const docNow = view.state.doc.toString();
    setHasChanges(docNow !== originalContent);
  }, [content, originalContent]);

  const handleSave = useCallback(() => {
    const currentContent = viewRef.current?.state.doc.toString() ?? content;
    onSave(currentContent);
  }, [content, onSave]);

  const handleReset = useCallback(() => {
    onReset();
    setHasChanges(false);
  }, [onReset]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{fileName}</span>
          {hasChanges && <Badge variant="warning">Unsaved</Badge>}
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
            onClick={handleSave}
            disabled={!hasChanges || saving}
          >
            <FaFloppyDisk className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Large file warning */}
      {isLargeFile && (
        <Alert className="m-2 mb-0">
          <FaTriangleExclamation className="h-4 w-4" />
          <AlertDescription>
            This file is large ({((fileSize ?? 0) / (1024 * 1024)).toFixed(1)}{" "}
            MB). Editor performance may be affected.
          </AlertDescription>
        </Alert>
      )}

      {/* Editor */}
      <div ref={editorRef} className="flex-1 min-h-0" />
    </div>
  );
}
