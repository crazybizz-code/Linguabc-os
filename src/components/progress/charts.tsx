"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Small single-series charts for progress pages, drawn as SVG on the
 * server. One series each, so the card title names it and no legend is
 * needed; every mark has a tooltip (<title>) and each chart has a table.
 *
 * Charts measure their container and draw at that width, so text stays
 * 11px on a phone and on a wide desktop panel alike.
 *
 * Series colour #2E7D4F was checked with the dataviz validator against the
 * #FCF8F4 surface (lightness, chroma, contrast >= 3:1).
 */
const SERIES = "#2E7D4F";
const SURFACE = "#FCF8F4";
const GRID = "#E7DED6";
const INK_MUTED = "#6B746F";

type Point = { label: string; value: number | null; tip: string };

/** Width of the chart's container, in CSS pixels. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Edge labels anchor inward so they are never clipped. */
const anchor = (i: number, n: number) => (n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle");

/** Columns from a 0 baseline, e.g. attendance % per month. */
export function Columns({ points, max = 100, unit = "%", ariaLabel }: { points: Point[]; max?: number; unit?: string; ariaLabel: string }) {
  const [ref, W] = useWidth();
  const H = 170, top = 18, bottom = 24, left = 34, right = 8;
  const plotH = H - top - bottom, band = (W - left - right) / points.length, bw = Math.min(24, band * 0.5);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const lastIdx = points.map((p) => p.value != null).lastIndexOf(true);
  return (
    <div ref={ref}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
          <text x={left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>{v}{unit}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = left + band * i + band / 2;
        const h = p.value == null ? 0 : Math.max(2, (p.value / max) * plotH);
        const x = cx - bw / 2, yTop = top + plotH - h, r = Math.min(4, h / 2);
        return (
          <g key={i}>
            <title>{p.tip}</title>
            <rect x={cx - band / 2} y={top} width={band} height={plotH} fill="transparent" />
            {p.value != null && (
              <path d={`M${x},${top + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${top + plotH} Z`} fill={SERIES} />
            )}
            {i === lastIdx && p.value != null && (
              <text x={cx} y={yTop - 5} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#17211D">{p.value}{unit}</text>
            )}
            <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill={INK_MUTED}>{p.label}</text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

/** A line over points (gaps where a value is missing), e.g. band per mock. */
export function Line({ points, min = 0, max, ticks, ariaLabel, unit = "", decimals = 0 }: {
  points: Point[]; min?: number; max: number; ticks: number[]; ariaLabel: string; unit?: string; decimals?: number;
}) {
  const [ref, W] = useWidth();
  const format = (v: number) => `${v.toFixed(decimals)}${unit}`;
  const H = 170, top = 18, bottom = 24, left = 34, right = 16;
  const plotH = H - top - bottom, step = points.length > 1 ? (W - left - right) / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? left + step * i : (W + left - right) / 2);
  const y = (v: number) => top + plotH - ((v - min) / (max - min)) * plotH;
  const segs: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p.value == null) { if (cur) segs.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i)},${y(p.value)} `;
  });
  if (cur) segs.push(cur);
  const lastIdx = points.map((p) => p.value != null).lastIndexOf(true);
  return (
    <div ref={ref}>
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
          <text x={left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>{format(v)}</text>
        </g>
      ))}
      {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      {points.map((p, i) => (
        <g key={i}>
          <title>{p.tip}</title>
          <rect x={x(i) - Math.max(step / 2, 12)} y={top} width={Math.max(step, 24)} height={plotH} fill="transparent" />
          {p.value != null && <circle cx={x(i)} cy={y(p.value)} r={4.5} fill={SERIES} stroke={SURFACE} strokeWidth={2} />}
          {i === lastIdx && p.value != null && (
            <text x={x(i)} y={y(p.value) - 9} textAnchor={anchor(i, points.length)} fontSize={11.5} fontWeight={600} fill="#17211D">{format(p.value)}</text>
          )}
          {(points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && (
            <text x={x(i)} y={H - 6} textAnchor={anchor(i, points.length)} fontSize={11} fill={INK_MUTED}>{p.label}</text>
          )}
        </g>
      ))}
    </svg>
    </div>
  );
}

/** The same data as a table, behind a disclosure. */
export function DataTable({ summary, head, rows }: { summary: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-[12px]">
      <summary className="cursor-pointer text-muted-foreground">{summary}</summary>
      <table className="mt-2 w-full text-left tabular-nums">
        <thead><tr className="text-muted-foreground">{head.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border/50">{r.map((c, j) => <td key={j} className="py-1 pr-3">{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}
