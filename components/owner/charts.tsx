'use client';

import { dayLabel, num, num1 } from './format';

export interface BarPoint {
  day: string;
  value: number;
  /** Optional second series drawn as a narrower bar inside the first (for example failures inside requests). */
  value2?: number;
}

interface BarChartProps {
  points: BarPoint[];
  /** What the bars count, for example "visits". */
  unit: string;
  /** Name of the second series, when there is one. */
  unit2?: string;
  /** Formats a value for labels and tooltips. */
  format?: (n: number) => string;
  height?: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Hand-written SVG bar chart: y-axis max, first/middle/last x labels, a tooltip per bar and a text summary for screen readers. */
export function BarChart({ points, unit, unit2, format = (n) => num1(n), height = 190 }: BarChartProps) {
  const W = 720;
  const padL = 44;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const n = points.length;
  if (n === 0) return null;

  const peak = Math.max(0, ...points.map((p) => p.value));
  const max = niceMax(peak);
  const slot = innerW / n;
  const barW = Math.max(1, slot * 0.72);
  const total = points.reduce((s, p) => s + p.value, 0);
  const best = points.reduce((a, p) => (p.value > a.value ? p : a), points[0]);
  const summary =
    `Bar chart of ${unit} per day, ${dayLabel(points[0].day)} to ${dayLabel(points[n - 1].day)}. ` +
    `Total ${format(total)}. ` +
    (peak > 0 ? `Highest day ${dayLabel(best.day)} with ${format(best.value)}.` : 'No activity in this period.');

  const labelAt = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="ow-chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={summary} className="ow-svg">
        <line x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} className="ow-axis" />
        <line x1={padL} x2={W - padR} y1={padT} y2={padT} className="ow-grid" />
        <line x1={padL} x2={W - padR} y1={padT + innerH / 2} y2={padT + innerH / 2} className="ow-grid" />
        <text x={padL - 6} y={padT + 4} textAnchor="end" className="ow-axis-text">
          {format(max)}
        </text>
        <text x={padL - 6} y={padT + innerH} textAnchor="end" className="ow-axis-text">
          0
        </text>
        {points.map((p, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const h = (p.value / max) * innerH;
          const h2 = p.value2 !== undefined ? (Math.min(p.value2, p.value) / max) * innerH : 0;
          const tip = `${dayLabel(p.day)}: ${format(p.value)} ${unit}${p.value2 !== undefined && unit2 ? `, ${format(p.value2)} ${unit2}` : ''}`;
          return (
            <g key={p.day}>
              <title>{tip}</title>
              <rect x={padL + i * slot} y={padT} width={slot} height={innerH} fill="transparent" />
              {h > 0 && <rect x={x} y={padT + innerH - h} width={barW} height={Math.max(h, 1)} rx={barW > 4 ? 2 : 0} className="ow-bar" />}
              {h2 > 0 && <rect x={x + barW * 0.25} y={padT + innerH - h2} width={barW * 0.5} height={Math.max(h2, 1)} className="ow-bar2" />}
            </g>
          );
        })}
        {labelAt.map((i) => (
          <text
            key={i}
            x={padL + i * slot + slot / 2}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            className="ow-axis-text"
          >
            {dayLabel(points[i].day)}
          </text>
        ))}
      </svg>
      <p className="ow-legend">
        <span className="ow-swatch ow-swatch-1" aria-hidden="true" /> {unit}
        {unit2 && (
          <>
            <span className="ow-swatch ow-swatch-2" aria-hidden="true" /> {unit2}
          </>
        )}
        <span className="ow-legend-max">Scale tops out at {format(max)}</span>
      </p>
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  tone: 'bad' | 'warn' | 'good';
}

/** One horizontal stacked bar with a text legend (never color alone). */
export function StackedBar({ segments, ariaLabel }: { segments: Segment[]; ariaLabel: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div className="ow-stack" role="img" aria-label={ariaLabel}>
        {segments.map(
          (s) => s.value > 0 && <div key={s.label} className={`ow-stack-seg ow-stack-${s.tone}`} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${num(s.value)}`} />,
        )}
      </div>
      <ul className="ow-stack-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className={`ow-swatch ow-stack-${s.tone}`} aria-hidden="true" /> {s.label}: <strong>{num(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bar rows: value relative to the largest row. */
export function HBars({ rows, format = num }: { rows: Array<{ key: string; label: string; value: number; extra?: string }>; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="ow-hbars">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="ow-hbar-head">
            <span className="ow-hbar-label">{r.label}</span>
            <span className="ow-hbar-value">
              {format(r.value)}
              {r.extra ? ` · ${r.extra}` : ''}
            </span>
          </div>
          <div className="ow-hbar-track" aria-hidden="true">
            <div className="ow-hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
