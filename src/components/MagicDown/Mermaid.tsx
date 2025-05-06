import { useRef, useEffect, type ReactNode } from "react";
import { customAlphabet } from "nanoid";

type Props = {
  children: ReactNode;
};

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz", 8);

async function loadMermaid(element: HTMLElement, code: string) {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false });
  const canParse = await mermaid.parse(code, { suppressErrors: true });
  if (canParse) {
    await mermaid.render(nanoid(), code).then(({ svg }) => {
      element.innerHTML = svg;
    });
  }
}

function Mermaid({ children }: Props) {
  const mermaidContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = mermaidContainerRef.current;
    if (target) {
      loadMermaid(target, target.innerText);
    }
  }, [children]);

  return (
    <div
      className="mermaid flex cursor-pointer justify-center w-full overflow-auto rounded"
      ref={mermaidContainerRef}
    >
      {children}
    </div>
  );
}

export default Mermaid;
