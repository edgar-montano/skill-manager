import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import { monaco } from "./monaco";
loader.config({ monaco });
function language(path: string) {
  const ext = path.split(".").pop();
  return (
    (
      {
        md: "markdown",
        json: "json",
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        py: "python",
        sh: "shell",
        toml: "ini",
        yaml: "yaml",
        yml: "yaml",
        rs: "rust",
      } as Record<string, string>
    )[ext ?? ""] ?? "plaintext"
  );
}
export default function CodeEditor({
  value,
  onChange,
  path,
  original,
  readonly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  path: string;
  original?: string;
  readonly?: boolean;
}) {
  const options = {
    fontSize: 13,
    fontFamily: '"SFMono-Regular", Consolas, monospace',
    minimap: { enabled: false },
    wordWrap: "on" as const,
    scrollBeyondLastLine: false,
    padding: { top: 18 },
    readOnly: readonly,
    automaticLayout: true,
  };
  return original !== undefined ? (
    <DiffEditor
      theme="vs-dark"
      original={original}
      modified={value}
      language={language(path)}
      options={{ ...options, renderSideBySide: true }}
    />
  ) : (
    <Editor
      theme="vs-dark"
      value={value}
      language={language(path)}
      onChange={(v) => onChange(v ?? "")}
      options={options}
    />
  );
}
