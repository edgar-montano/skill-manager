import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Lock,
  Link2,
} from "lucide-react";
import { z } from "zod";
import { api, entrySchema, message, type Entry } from "./api";

function Node({
  entry,
  onOpen,
  depth = 0,
  selected,
}: {
  entry: Entry;
  onOpen: (path: string) => void;
  depth?: number;
  selected?: string;
}) {
  const [open, setOpen] = useState(false),
    [children, setChildren] = useState<Entry[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (open && entry.directory)
      void api("tree", { path: entry.path }, z.array(entrySchema))
        .then((v) => {
          if (active) setChildren(v);
        })
        .catch((e) => {
          if (active) setError(message(e));
        });
    return () => {
      active = false;
    };
  }, [open, entry.directory, entry.path]);
  return (
    <li
      role="treeitem"
      aria-expanded={entry.directory ? open : undefined}
      aria-selected={selected === entry.path}
    >
      <button
        className={`tree-node ${selected === entry.path ? "selected" : ""}`}
        style={{ paddingLeft: 10 + depth * 15 }}
        disabled={entry.protected}
        title={entry.path}
        onClick={() => (entry.directory ? setOpen(!open) : onOpen(entry.path))}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
            const tree = e.currentTarget.closest('[role="tree"]');
            const nodes = Array.from(
              tree?.querySelectorAll<HTMLButtonElement>(
                "button.tree-node:not(:disabled)",
              ) ?? [],
            );
            const index = nodes.indexOf(e.currentTarget);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? nodes.length - 1
                  : index + (e.key === "ArrowDown" ? 1 : -1);
            nodes[Math.max(0, Math.min(nodes.length - 1, next))]?.focus();
            e.preventDefault();
          }
          if (entry.directory && e.key === "ArrowRight") {
            setOpen(true);
            e.preventDefault();
          }
          if (entry.directory && e.key === "ArrowLeft") {
            setOpen(false);
            e.preventDefault();
          }
        }}
      >
        {entry.directory ? (
          open ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span className="tree-spacer" />
        )}
        {entry.protected ? (
          <Lock size={14} />
        ) : entry.directory ? (
          open ? (
            <FolderOpen size={15} />
          ) : (
            <Folder size={15} />
          )
        ) : (
          <FileText size={14} />
        )}
        <span>{entry.name}</span>
        {entry.symlink ? <Link2 size={11} /> : null}
      </button>
      {error && open ? <p className="inline-error">{error}</p> : null}
      {open && entry.directory ? (
        <ul role="group">
          {children.map((e) => (
            <Node
              key={e.path}
              entry={e}
              onOpen={onOpen}
              depth={depth + 1}
              selected={selected}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
export default function Tree({
  roots,
  onOpen,
  selected,
}: {
  roots: { name: string; path: string }[];
  onOpen: (path: string) => void;
  selected?: string;
}) {
  return (
    <ul role="tree" aria-label="File explorer" className="file-tree">
      {roots.map((root) => (
        <Node
          key={root.path}
          entry={{ ...root, directory: true, protected: false, symlink: false }}
          onOpen={onOpen}
          selected={selected}
        />
      ))}
    </ul>
  );
}
