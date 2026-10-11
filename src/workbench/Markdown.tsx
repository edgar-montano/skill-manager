import { useEffect, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

export default function Markdown({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  useEffect(() => {
    let active = true;
    const root = ref.current;
    if (!root) return;
    void (async () => {
      const blocks = root.querySelectorAll<HTMLElement>(
        "code.language-mermaid",
      );
      if (blocks.length) {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
        });
        for (const [i, block] of Array.from(blocks).entries()) {
          try {
            const { svg } = await mermaid.render(
              `diagram-${crypto.randomUUID()}-${i}`,
              block.textContent ?? "",
            );
            if (active && block.parentElement)
              block.parentElement.innerHTML = DOMPurify.sanitize(svg, {
                USE_PROFILES: { svg: true },
              });
          } catch {
            if (active) block.title = "Diagram could not be rendered";
          }
        }
      }
      const codeBlocks = root.querySelectorAll<HTMLElement>(
        "pre code:not(.language-mermaid)",
      );
      if (codeBlocks.length) {
        const { monaco } = await import("./monaco");
        for (const block of codeBlocks) {
          const requested = block.className.replace("language-", "");
          const aliases: Record<string, string> = {
            bash: "shell",
            sh: "shell",
            ts: "typescript",
            js: "javascript",
            yml: "yaml",
            toml: "ini",
          };
          const candidate = aliases[requested] ?? requested;
          const lang = monaco.languages
            .getLanguages()
            .some((language) => language.id === candidate)
            ? candidate
            : "plaintext";
          const html = await monaco.editor.colorize(
            block.textContent ?? "",
            lang,
            {},
          );
          if (active) block.innerHTML = DOMPurify.sanitize(html);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [content]);
  return (
    <div
      className="markdown"
      ref={ref}
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(body, { async: false })),
      }}
    />
  );
}
