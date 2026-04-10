import { useEffect, useRef } from "react";
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

export interface CodeMirrorEditorProps {
  content: string;
  originalContent: string;
  fileName: string;
  onContentChange: (content: string) => void;
  onSave?: (content: string) => void;
  readOnly?: boolean;
  className?: string;
}

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

export function CodeMirrorEditor({
  content: rawContent,
  originalContent: rawOriginalContent,
  fileName,
  onContentChange,
  onSave,
  readOnly,
  className,
}: CodeMirrorEditorProps) {
  // Normalize line endings — CodeMirror uses \n internally,
  // so \r\n from Windows files would cause false "unsaved" diffs
  const content = rawContent.replace(/\r\n/g, "\n");
  const originalContent = rawOriginalContent.replace(/\r\n/g, "\n");

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
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

  // Initialize editor
  useEffect(() => {
    if (!editorRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          if (onSaveRef.current) {
            const currentContent = viewRef.current?.state.doc.toString() ?? "";
            onSaveRef.current(currentContent);
          }
          return true;
        },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
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
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
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
  }, [fileName, readOnly]); // Recreate when switching files or readOnly changes

  // Sync content when it changes externally (e.g., reset or file switch)
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
  }, [content, originalContent]);

  return <div ref={editorRef} className={className ?? "flex-1 min-h-0"} />;
}
