"use client";

import { useCallback, useEffect, useState } from "react";
import { Eraser } from "lucide-react";

/**
 * Highlighting for the exam screen, as on the computer-delivered IELTS:
 * select text in the passage or a question, then pick a colour.
 *
 * Highlights are kept as character ranges per text block, so React renders
 * them (no DOM surgery) and they survive switching parts. They are saved in
 * this browser for this attempt only.
 */
export type Colour = "yellow" | "pink" | "blue";
type Span = { s: number; e: number; c: Colour };
export type Highlights = Record<string, Span[]>;

export const COLOURS: Record<Colour, string> = { yellow: "#FFF3A3", pink: "#FFD6E5", blue: "#CDE8FF" };

/** Text that can carry highlights. `id` must be unique on the screen. */
export function Marked({ id, text, spans, className }: { id: string; text: string; spans?: Span[]; className?: string }) {
  const parts: { t: string; c?: Colour }[] = [];
  let at = 0;
  for (const h of [...(spans ?? [])].sort((a, b) => a.s - b.s)) {
    if (h.s > at) parts.push({ t: text.slice(at, h.s) });
    parts.push({ t: text.slice(Math.max(h.s, at), h.e), c: h.c });
    at = Math.max(at, h.e);
  }
  if (at < text.length) parts.push({ t: text.slice(at) });
  return (
    <span data-hl={id} className={className}>
      {parts.map((p, i) => (p.c ? <mark key={i} style={{ background: COLOURS[p.c], color: "inherit" }}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
    </span>
  );
}

/** Removes [s, e) from a block's spans, then adds the new colour (if any). */
function apply(list: Span[], s: number, e: number, c: Colour | null): Span[] {
  const out: Span[] = [];
  for (const h of list) {
    if (h.e <= s || h.s >= e) { out.push(h); continue; }
    if (h.s < s) out.push({ s: h.s, e: s, c: h.c });
    if (h.e > e) out.push({ s: e, e: h.e, c: h.c });
  }
  if (c) out.push({ s, e, c });
  return out.filter((h) => h.e > h.s).sort((a, b) => a.s - b.s);
}

/** Character offset of a point inside a highlightable block. */
function offsetIn(block: Element, node: Node, offset: number) {
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Selection handling and the colour toolbar. */
export function useHighlights() {
  const [key, setKey] = useState<string>();
  const [marks, setMarks] = useState<Highlights>({});
  const [bar, setBar] = useState<{ x: number; y: number; id: string; s: number; e: number }>();

  // Saved per attempt in this browser (a convenience: storage may be unavailable).
  const load = useCallback((k: string) => {
    setKey(k);
    try {
      const saved = localStorage.getItem(`hl:${k}`);
      if (saved) setMarks(JSON.parse(saved) as Highlights);
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    if (!key) return;
    try { localStorage.setItem(`hl:${key}`, JSON.stringify(marks)); } catch { /* storage unavailable */ }
  }, [key, marks]);

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setBar(undefined);
    const range = sel.getRangeAt(0);
    const start = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest("[data-hl]");
    const end = (range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement)?.closest("[data-hl]");
    if (!start || start !== end) return setBar(undefined);
    const s = offsetIn(start, range.startContainer, range.startOffset);
    const e = offsetIn(start, range.endContainer, range.endOffset);
    if (e <= s) return setBar(undefined);
    const rect = range.getBoundingClientRect();
    setBar({ x: rect.left + rect.width / 2, y: rect.top, id: start.getAttribute("data-hl")!, s, e });
  }, []);

  const choose = (c: Colour | null) => {
    if (!bar) return;
    setMarks((m) => ({ ...m, [bar.id]: apply(m[bar.id] ?? [], bar.s, bar.e, c) }));
    window.getSelection()?.removeAllRanges();
    setBar(undefined);
  };

  const toolbar = bar && (
    <div className="fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-1 border border-[#999] bg-white p-1 shadow-md"
      style={{ left: bar.x, top: bar.y - 6 }} onMouseDown={(e) => e.preventDefault()}>
      {(Object.keys(COLOURS) as Colour[]).map((c) => (
        <button key={c} type="button" title={`Highlight ${c}`} onClick={() => choose(c)}
          className="h-6 w-6 border border-[#999]" style={{ background: COLOURS[c] }} />
      ))}
      <button type="button" title="Clear highlight" onClick={() => choose(null)} className="flex h-6 w-6 items-center justify-center border border-[#999]">
        <Eraser className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return { marks, load, onMouseUp, toolbar, hide: () => setBar(undefined) };
}
