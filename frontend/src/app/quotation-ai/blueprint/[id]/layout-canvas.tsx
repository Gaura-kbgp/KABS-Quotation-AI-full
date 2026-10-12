'use client';

/**
 * Module 2 — Visual 2D Kitchen Layout Canvas
 * SVG-based floor plan view showing cabinets, appliances, and openings per wall.
 */

import { useMemo, useState } from 'react';

interface CanvasWall {
  id: string;
  length_in: number;
  kind?: string;
  openings?: { type: string; start_in: number; width_in: number }[];
  appliances?: { type: string; center_in: number; width_in: number }[];
}

interface BomItem {
  code: string;
  qty: number;
  wall: string;
  position_in: number;
  category: string;
  notes?: string;
}

interface LayoutCanvasProps {
  walls: CanvasWall[];
  items: BomItem[];
  warnings?: string[];
}

// Derive width from cabinet code (inches)
function codeToWidth(code: string): number {
  const c = code.toUpperCase();
  if (c === 'DW_SPACE')    return 24;
  if (c === 'RANGE_SPACE') return 30;
  if (c === 'FRIDGE_SPACE') return 36;
  if (c === 'HOOD_SPACE')  return 30;
  if (c === 'EP')          return 3;
  // W3036 → 30, B30 → 30, SB36 → 36, UF3 → 3
  const m = c.match(/^[A-Z]+(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    // Wall cabinets like W3036 → first 2 digits = width
    if (c.startsWith('W') && n > 100) return Math.floor(n / 100);
    return n > 100 ? Math.floor(n / 100) : n;
  }
  return 12;
}

// Color per category/type
function itemColor(item: BomItem): { fill: string; stroke: string; text: string } {
  const c = item.code.toUpperCase();
  if (item.category === 'appliance_spacer') {
    if (c.startsWith('DW'))     return { fill: '#bfdbfe', stroke: '#3b82f6', text: '#1e40af' };
    if (c.startsWith('RANGE') || c.startsWith('HOOD')) return { fill: '#fed7aa', stroke: '#f97316', text: '#9a3412' };
    if (c.startsWith('FRIDGE')) return { fill: '#bbf7d0', stroke: '#22c55e', text: '#14532d' };
    return { fill: '#e2e8f0', stroke: '#94a3b8', text: '#334155' };
  }
  if (c.startsWith('SB')) return { fill: '#c7d2fe', stroke: '#6366f1', text: '#3730a3' };
  if (c.startsWith('W'))  return { fill: '#fef9c3', stroke: '#eab308', text: '#713f12' };
  if (c.startsWith('B'))  return { fill: '#dbeafe', stroke: '#60a5fa', text: '#1e3a8a' };
  if (c.startsWith('UF') || c === 'EP') return { fill: '#f3f4f6', stroke: '#9ca3af', text: '#374151' };
  if (item.category === 'opt_crown' || item.category === 'opt_light_rail')
    return { fill: '#fce7f3', stroke: '#ec4899', text: '#831843' };
  return { fill: '#f1f5f9', stroke: '#cbd5e1', text: '#334155' };
}

const PX_PER_IN = 3.5;   // scale: inches → SVG pixels
const BASE_H = 56;        // height for base cabinet row
const WALL_H = 40;        // height for wall cabinet row
const TRIM_H = 16;        // crown / light rail row
const LABEL_PAD = 8;
const WALL_GAP = 36;      // vertical gap between wall sections
const MARGIN_L = 64;      // left margin for wall labels
const MARGIN_R = 20;

function WallSection({ wall, items }: { wall: CanvasWall; items: BomItem[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const wallW = Math.round(wall.length_in * PX_PER_IN);

  const bases  = items.filter(i => ['cabinets', 'appliance_spacer'].includes(i.category) && !i.code.startsWith('W') && !i.code.startsWith('TK') && i.category !== 'opt_crown' && i.category !== 'opt_light_rail');
  const uppers = items.filter(i => i.code.startsWith('W') && i.category === 'cabinets');
  const crown  = items.filter(i => i.category === 'opt_crown' || i.category === 'opt_light_rail');

  const totalH = (crown.length ? TRIM_H + 4 : 0) + (uppers.length ? WALL_H + 4 : 0) + BASE_H + LABEL_PAD * 2 + 20;
  const crownY = LABEL_PAD;
  const upperY = crownY + (crown.length ? TRIM_H + 4 : 0);
  const baseY  = upperY + (uppers.length ? WALL_H + 4 : 0);

  const openingZones = (wall.openings ?? []).map(o => ({
    x: Math.round(o.start_in * PX_PER_IN),
    w: Math.round(o.width_in * PX_PER_IN),
    type: o.type,
  }));

  return (
    <div style={{ marginBottom: WALL_GAP }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ width: MARGIN_L, paddingTop: baseY, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Wall {wall.id}
          </span>
          <br />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {(wall.length_in / 12).toFixed(1)}′
          </span>
          {wall.kind && wall.kind !== 'wall' && (
            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-accent)' }}>
              ({wall.kind})
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <svg
            width={wallW + MARGIN_R}
            height={totalH}
            style={{ display: 'block', minWidth: wallW + MARGIN_R }}
          >
            {/* Wall floor line */}
            <line x1={0} y1={baseY + BASE_H} x2={wallW} y2={baseY + BASE_H}
              stroke="var(--border-strong)" strokeWidth={2} />

            {/* Opening gaps (doors) */}
            {openingZones.filter(o => o.type === 'door').map((o, i) => (
              <rect key={`door-${i}`} x={o.x} y={baseY} width={o.w} height={BASE_H}
                fill="#f8fafc" stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3 2" />
            ))}

            {/* Window lines */}
            {openingZones.filter(o => o.type === 'window').map((o, i) => (
              <g key={`win-${i}`}>
                <rect x={o.x} y={upperY} width={o.w} height={WALL_H}
                  fill="#e0f2fe" stroke="#7dd3fc" strokeWidth={0.5} />
                <text x={o.x + o.w / 2} y={upperY + WALL_H / 2 + 4} textAnchor="middle"
                  fontSize={9} fill="#0369a1">WIN</text>
              </g>
            ))}

            {/* Crown / trim strip */}
            {crown.length > 0 && (
              <rect x={0} y={crownY} width={wallW} height={TRIM_H}
                fill="#fce7f3" stroke="#f9a8d4" strokeWidth={0.5} rx={2} />
            )}
            {crown.length > 0 && (
              <text x={wallW / 2} y={crownY + TRIM_H / 2 + 4} textAnchor="middle"
                fontSize={9} fill="#9d174d">
                {crown.map(c => c.code).join(' · ')}
              </text>
            )}

            {/* Upper cabinets */}
            {uppers.map((item, idx) => {
              const x = Math.round(item.position_in * PX_PER_IN);
              const w = Math.round(codeToWidth(item.code) * PX_PER_IN);
              const col = itemColor(item);
              const key = `u-${idx}`;
              return (
                <g key={key} onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)}>
                  <rect x={x} y={upperY} width={Math.max(w - 1, 1)} height={WALL_H}
                    fill={hovered === key ? col.stroke : col.fill}
                    stroke={col.stroke} strokeWidth={0.5} rx={1} />
                  {w >= 20 && (
                    <text x={x + w / 2} y={upperY + WALL_H / 2 + 4} textAnchor="middle"
                      fontSize={Math.min(9, w / 4)} fill={hovered === key ? '#fff' : col.text}
                      style={{ pointerEvents: 'none' }}>
                      {item.code}
                    </text>
                  )}
                  {hovered === key && (
                    <title>{item.code} — {item.notes || item.category}</title>
                  )}
                </g>
              );
            })}

            {/* Base cabinets */}
            {bases.map((item, idx) => {
              const x = Math.round(item.position_in * PX_PER_IN);
              const w = Math.round(codeToWidth(item.code) * PX_PER_IN);
              const col = itemColor(item);
              const key = `b-${idx}`;
              return (
                <g key={key} onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)}>
                  <rect x={x} y={baseY} width={Math.max(w - 1, 1)} height={BASE_H}
                    fill={hovered === key ? col.stroke : col.fill}
                    stroke={col.stroke} strokeWidth={0.5} rx={2} />
                  {w >= 20 && (
                    <text x={x + w / 2} y={baseY + BASE_H / 2 - 4} textAnchor="middle"
                      fontSize={Math.min(9, w / 4)} fill={hovered === key ? '#fff' : col.text}
                      style={{ pointerEvents: 'none' }} fontWeight={500}>
                      {item.code}
                    </text>
                  )}
                  {w >= 24 && (
                    <text x={x + w / 2} y={baseY + BASE_H / 2 + 8} textAnchor="middle"
                      fontSize={8} fill={hovered === key ? '#e2e8f0' : '#94a3b8'}
                      style={{ pointerEvents: 'none' }}>
                      {codeToWidth(item.code)}&quot;
                    </text>
                  )}
                  {hovered === key && (
                    <title>{item.code} — {item.notes || item.category}</title>
                  )}
                </g>
              );
            })}

            {/* Dimension line */}
            <line x1={0} y1={totalH - 14} x2={wallW} y2={totalH - 14}
              stroke="var(--border)" strokeWidth={0.5} />
            <line x1={0} y1={totalH - 18} x2={0} y2={totalH - 10}
              stroke="var(--border)" strokeWidth={0.5} />
            <line x1={wallW} y1={totalH - 18} x2={wallW} y2={totalH - 10}
              stroke="var(--border)" strokeWidth={0.5} />
            <text x={wallW / 2} y={totalH - 4} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
              {wall.length_in}&quot; ({(wall.length_in / 12).toFixed(1)}′)
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}

export function LayoutCanvas({ walls, items, warnings }: LayoutCanvasProps) {
  const wallMap = useMemo(() => {
    const m: Record<string, BomItem[]> = {};
    for (const w of walls) m[w.id] = [];
    for (const it of items) {
      const key = it.wall.replace('_back', '');
      if (m[key]) m[key].push(it);
    }
    return m;
  }, [walls, items]);

  if (!walls.length) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Layout preview
        </h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { fill: '#dbeafe', stroke: '#60a5fa', label: 'Base' },
            { fill: '#fef9c3', stroke: '#eab308', label: 'Wall' },
            { fill: '#c7d2fe', stroke: '#6366f1', label: 'Sink base' },
            { fill: '#fed7aa', stroke: '#f97316', label: 'Range/hood' },
            { fill: '#bbf7d0', stroke: '#22c55e', label: 'Fridge' },
            { fill: '#bfdbfe', stroke: '#3b82f6', label: 'DW' },
          ].map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: l.fill, border: `1px solid ${l.stroke}`, display: 'inline-block' }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {warnings?.map((w, i) => (
        <div key={i} style={{ fontSize: 12, color: 'var(--text-warning)', marginBottom: 6, padding: '4px 8px', background: 'var(--bg-warning)', borderRadius: 4 }}>
          ⚠ {w}
        </div>
      ))}

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '16px 8px', background: 'var(--surface-1)' }}>
        {walls.map(wall => (
          <WallSection key={wall.id} wall={wall} items={wallMap[wall.id] ?? []} />
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        Hover over a cabinet to see its details. Scroll horizontally for long walls.
      </p>
    </div>
  );
}
