'use client';

/**
 * Module 2 — Interactive 2D Kitchen Layout Canvas
 * SVG elevation view with click-to-select, pointer-drag, zoom, and pan.
 */

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Trash2, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  onItemsChange?: (newItems: BomItem[]) => void;
}

const SNAP_IN = 3;          // snap to 3-inch grid
const PX_PER_IN = 3.5;
const BASE_H = 56;
const WALL_H = 40;
const TRIM_H = 16;
const LABEL_PAD = 8;
const WALL_GAP = 36;

function snap(val: number): number {
  return Math.round(val / SNAP_IN) * SNAP_IN;
}

function codeToWidth(code: string): number {
  const c = code.toUpperCase();
  if (c === 'DW_SPACE')     return 24;
  if (c === 'RANGE_SPACE')  return 30;
  if (c === 'FRIDGE_SPACE') return 36;
  if (c === 'HOOD_SPACE')   return 30;
  if (c === 'EP')           return 3;
  const m = c.match(/^[A-Z]+(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (c.startsWith('W') && n > 100) return Math.floor(n / 100);
    return n > 100 ? Math.floor(n / 100) : n;
  }
  return 12;
}

function itemColor(item: BomItem): { fill: string; stroke: string; text: string } {
  const c = item.code.toUpperCase();
  if (item.category === 'appliance_spacer') {
    if (c.startsWith('DW'))                        return { fill: '#bfdbfe', stroke: '#3b82f6', text: '#1e40af' };
    if (c.startsWith('RANGE') || c.startsWith('HOOD')) return { fill: '#fed7aa', stroke: '#f97316', text: '#9a3412' };
    if (c.startsWith('FRIDGE'))                    return { fill: '#bbf7d0', stroke: '#22c55e', text: '#14532d' };
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

// ─── Single wall section ─────────────────────────────────────────────────────

interface WallSectionProps {
  wall: CanvasWall;
  items: BomItem[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onDragStart: (key: string, item: BomItem, clientX: number) => void;
  zoom: number;
}

function WallSection({ wall, items, selectedKey, onSelect, onDragStart, zoom }: WallSectionProps) {
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

  const renderCabinet = (item: BomItem, yPos: number, height: number, prefix: string, idx: number) => {
    const key = `${wall.id}-${prefix}-${idx}`;
    const x = Math.round(item.position_in * PX_PER_IN);
    const w = Math.round(codeToWidth(item.code) * PX_PER_IN);
    const col = itemColor(item);
    const isSel = selectedKey === key;
    const isDraggable = item.category !== 'opt_crown' && item.category !== 'opt_light_rail';

    return (
      <g key={key}
        style={{ cursor: isDraggable ? 'grab' : 'default' }}
        onPointerDown={isDraggable ? (e) => { e.preventDefault(); e.stopPropagation(); onSelect(key); onDragStart(key, item, e.clientX); } : undefined}
        onClick={(e) => { e.stopPropagation(); onSelect(isSel ? null : key); }}
      >
        <rect
          x={x} y={yPos}
          width={Math.max(w - 1, 1)} height={height}
          fill={isSel ? col.stroke : col.fill}
          stroke={isSel ? '#1e40af' : col.stroke}
          strokeWidth={isSel ? 2 : 0.5}
          rx={2}
        />
        {/* Selected indicator */}
        {isSel && <rect x={x} y={yPos} width={Math.max(w - 1, 1)} height={3} fill="#2563eb" rx={1} />}
        {w >= 20 && (
          <text x={x + w / 2} y={yPos + height / 2 - (prefix === 'b' && w >= 24 ? 4 : 0)} textAnchor="middle"
            fontSize={Math.min(9, w / 4)} fill={isSel ? '#fff' : col.text}
            style={{ pointerEvents: 'none', userSelect: 'none' }} fontWeight={isSel ? 700 : 500}>
            {item.code}
          </text>
        )}
        {prefix === 'b' && w >= 24 && (
          <text x={x + w / 2} y={yPos + height / 2 + 8} textAnchor="middle"
            fontSize={8} fill={isSel ? '#bfdbfe' : '#94a3b8'} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            {codeToWidth(item.code)}&quot;
          </text>
        )}
        <title>{item.code} · {codeToWidth(item.code)}&quot; wide · pos {item.position_in}&quot;</title>
      </g>
    );
  };

  return (
    <div style={{ marginBottom: WALL_GAP }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ width: 56, paddingTop: baseY, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Wall {wall.id}</span>
          <br />
          <span style={{ fontSize: 10, color: '#94a3b8' }}>{(wall.length_in / 12).toFixed(1)}′</span>
        </div>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <svg
            width={wallW + 20}
            height={totalH}
            style={{ display: 'block', minWidth: wallW + 20 }}
            onClick={() => onSelect(null)}
          >
            <line x1={0} y1={baseY + BASE_H} x2={wallW} y2={baseY + BASE_H} stroke="#cbd5e1" strokeWidth={2} />

            {openingZones.filter(o => o.type === 'door').map((o, i) => (
              <rect key={`door-${i}`} x={o.x} y={baseY} width={o.w} height={BASE_H}
                fill="#f8fafc" stroke="#e2e8f0" strokeWidth={0.5} strokeDasharray="3 2" />
            ))}
            {openingZones.filter(o => o.type === 'window').map((o, i) => (
              <g key={`win-${i}`}>
                <rect x={o.x} y={upperY} width={o.w} height={WALL_H} fill="#e0f2fe" stroke="#7dd3fc" strokeWidth={0.5} />
                <text x={o.x + o.w / 2} y={upperY + WALL_H / 2 + 4} textAnchor="middle" fontSize={9} fill="#0369a1">WIN</text>
              </g>
            ))}

            {crown.length > 0 && (
              <rect x={0} y={crownY} width={wallW} height={TRIM_H} fill="#fce7f3" stroke="#f9a8d4" strokeWidth={0.5} rx={2} />
            )}
            {crown.length > 0 && (
              <text x={wallW / 2} y={crownY + TRIM_H / 2 + 4} textAnchor="middle" fontSize={9} fill="#9d174d">
                {crown.map(c => c.code).join(' · ')}
              </text>
            )}

            {uppers.map((item, idx) => renderCabinet(item, upperY, WALL_H, 'u', idx))}
            {bases.map((item, idx)  => renderCabinet(item, baseY,  BASE_H, 'b', idx))}

            <line x1={0} y1={totalH - 14} x2={wallW} y2={totalH - 14} stroke="#e2e8f0" strokeWidth={0.5} />
            <line x1={0} y1={totalH - 18} x2={0} y2={totalH - 10} stroke="#e2e8f0" strokeWidth={0.5} />
            <line x1={wallW} y1={totalH - 18} x2={wallW} y2={totalH - 10} stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={wallW / 2} y={totalH - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">
              {wall.length_in}&quot; ({(wall.length_in / 12).toFixed(1)}′)
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Main canvas ─────────────────────────────────────────────────────────────

export function LayoutCanvas({ walls, items, warnings, onItemsChange }: LayoutCanvasProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragLive, setDragLive] = useState<{ key: string; posIn: number } | null>(null);

  const dragRef = useRef<{
    key: string;
    itemIdx: number;
    startClientX: number;
    startPosIn: number;
    wallLenIn: number;
    codeWidthIn: number;
  } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const wallMap = useMemo(() => {
    const m: Record<string, BomItem[]> = {};
    for (const w of walls) m[w.id] = [];
    for (const it of items) {
      const key = it.wall.replace('_back', '');
      if (m[key]) m[key].push(it);
    }
    return m;
  }, [walls, items]);

  // Selected item detail
  const selectedItem = useMemo(() => {
    if (!selectedKey) return null;
    const [wallId, , , idxStr] = selectedKey.split('-');
    const idx = parseInt(idxStr, 10);
    const wallItems = wallMap[wallId] ?? [];
    // find by matching the sequential index within filtered category
    const prefix = selectedKey.split('-')[2];
    const filtered = wallItems.filter(i =>
      prefix === 'u' ? (i.code.startsWith('W') && i.category === 'cabinets') :
      prefix === 'b' ? (['cabinets', 'appliance_spacer'].includes(i.category) && !i.code.startsWith('W') && !i.code.startsWith('TK') && i.category !== 'opt_crown' && i.category !== 'opt_light_rail') :
      false
    );
    return filtered[idx] ?? null;
  }, [selectedKey, wallMap]);

  const selectedWallId = selectedKey?.split('-')[0] ?? null;
  const selectedWall = walls.find(w => w.id === selectedWallId) ?? null;

  // ── Drag handling ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback((key: string, item: BomItem, clientX: number) => {
    const wallId = key.split('-')[0];
    const wall = walls.find(w => w.id === wallId);
    if (!wall || !onItemsChange) return;
    const itemIdx = items.findIndex(i => i === item);
    if (itemIdx < 0) return;

    dragRef.current = {
      key,
      itemIdx,
      startClientX: clientX,
      startPosIn: item.position_in,
      wallLenIn: wall.length_in,
      codeWidthIn: codeToWidth(item.code),
    };
    setDragLive({ key, posIn: item.position_in });
  }, [walls, items, onItemsChange]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { startClientX, startPosIn, wallLenIn, codeWidthIn } = dragRef.current;
      const deltaPx = (e.clientX - startClientX) / zoom;
      const deltaIn = deltaPx / PX_PER_IN;
      const raw = startPosIn + deltaIn;
      const snapped = Math.max(0, Math.min(snap(raw), wallLenIn - codeWidthIn));
      setDragLive({ key: dragRef.current.key, posIn: snapped });
    };

    const onUp = (e: PointerEvent) => {
      if (!dragRef.current || !onItemsChange) { dragRef.current = null; setDragLive(null); return; }
      const { startClientX, startPosIn, wallLenIn, codeWidthIn, itemIdx } = dragRef.current;
      const deltaPx = (e.clientX - startClientX) / zoom;
      const deltaIn = deltaPx / PX_PER_IN;
      const raw = startPosIn + deltaIn;
      const snapped = Math.max(0, Math.min(snap(raw), wallLenIn - codeWidthIn));

      const newItems = items.map((it, i) =>
        i === itemIdx ? { ...it, position_in: snapped } : it
      );
      onItemsChange(newItems);
      dragRef.current = null;
      setDragLive(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [items, zoom, onItemsChange]);

  // ── Pan handling ─────────────────────────────────────────────────────────
  const handleCanvasPanStart = (e: React.PointerEvent) => {
    if (dragRef.current) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleCanvasPanMove = (e: React.PointerEvent) => {
    if (!panRef.current) return;
    setPan({ x: panRef.current.panX + e.clientX - panRef.current.startX, y: panRef.current.panY + e.clientY - panRef.current.startY });
  };

  const handleCanvasPanEnd = () => { panRef.current = null; };

  // ── Zoom via scroll ───────────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(2.5, Math.max(0.4, z - e.deltaY * 0.001)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── Keyboard: Escape deselects, Delete removes ────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedKey(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKey && onItemsChange && selectedItem) {
        onItemsChange(items.filter(i => i !== selectedItem));
        setSelectedKey(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedKey, selectedItem, items, onItemsChange]);

  // Build items with live drag position applied
  const liveItems = useMemo(() => {
    if (!dragLive) return items;
    return items.map(it => {
      const wall = it.wall.replace('_back', '');
      const key = dragRef.current?.key;
      if (!key) return it;
      const [wid, , , idxStr] = key.split('-');
      if (wall !== wid) return it;
      const idx = parseInt(idxStr, 10);
      const prefix = key.split('-')[2];
      const filtered = items.filter(i =>
        i.wall.replace('_back', '') === wid &&
        (prefix === 'u' ? (i.code.startsWith('W') && i.category === 'cabinets') :
         ['cabinets', 'appliance_spacer'].includes(i.category) && !i.code.startsWith('W') && !i.code.startsWith('TK'))
      );
      const target = filtered[idx];
      return (it === target) ? { ...it, position_in: dragLive.posIn } : it;
    });
  }, [items, dragLive]);

  const liveWallMap = useMemo(() => {
    const m: Record<string, BomItem[]> = {};
    for (const w of walls) m[w.id] = [];
    for (const it of liveItems) {
      const key = it.wall.replace('_back', '');
      if (m[key]) m[key].push(it);
    }
    return m;
  }, [walls, liveItems]);

  if (!walls.length) return null;

  const nudgePosition = (deltaIn: number) => {
    if (!selectedItem || !onItemsChange || !selectedWall) return;
    const w = codeToWidth(selectedItem.code);
    const newPos = Math.max(0, Math.min(snap(selectedItem.position_in + deltaIn), selectedWall.length_in - w));
    onItemsChange(items.map(it => it === selectedItem ? { ...it, position_in: newPos } : it));
  };

  const deleteSelected = () => {
    if (!selectedItem || !onItemsChange) return;
    onItemsChange(items.filter(i => i !== selectedItem));
    setSelectedKey(null);
  };

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs font-black text-slate-600 uppercase tracking-wider">Layout Canvas</span>
        {onItemsChange && <span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full font-bold">Editable</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.min(2.5, z + 0.15))}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors" title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-bold text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.4, z - 0.15))}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors" title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors ml-1" title="Reset view">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {selectedItem && (
          <span className="text-[10px] text-slate-400">Del/⌫ to remove · drag to move</span>
        )}
      </div>

      {/* Canvas viewport */}
      <div
        ref={containerRef}
        className="overflow-hidden relative bg-slate-50"
        style={{ height: 420, cursor: panRef.current ? 'grabbing' : 'grab' }}
        onPointerDown={handleCanvasPanStart}
        onPointerMove={handleCanvasPanMove}
        onPointerUp={handleCanvasPanEnd}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            padding: '16px 8px',
            width: 'max-content',
          }}
        >
          {warnings?.map((w, i) => (
            <div key={i} className="text-xs text-amber-700 mb-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
              ⚠ {w}
            </div>
          ))}
          {walls.map(wall => (
            <WallSection
              key={wall.id}
              wall={wall}
              items={liveWallMap[wall.id] ?? []}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onDragStart={handleDragStart}
              zoom={zoom}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-slate-100 bg-white">
        {[
          { fill: '#dbeafe', stroke: '#60a5fa', label: 'Base' },
          { fill: '#fef9c3', stroke: '#eab308', label: 'Wall' },
          { fill: '#c7d2fe', stroke: '#6366f1', label: 'Sink base' },
          { fill: '#fed7aa', stroke: '#f97316', label: 'Range/hood' },
          { fill: '#bbf7d0', stroke: '#22c55e', label: 'Fridge' },
          { fill: '#bfdbfe', stroke: '#3b82f6', label: 'DW' },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1 text-[10px] text-slate-500">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: l.fill, border: `1px solid ${l.stroke}`, display: 'inline-block', flexShrink: 0 }} />
            {l.label}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-slate-400">Scroll to zoom · drag background to pan · click cabinet to select</span>
      </div>

      {/* Selected item detail panel */}
      {selectedItem && (
        <div className="border-t border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: itemColor(selectedItem).fill, border: `1px solid ${itemColor(selectedItem).stroke}` }} />
            <span className="font-mono font-black text-slate-800 text-sm">{selectedItem.code}</span>
            <span className="text-xs text-slate-400">{codeToWidth(selectedItem.code)}&quot; wide</span>
            <span className="text-xs text-slate-400">Wall {selectedItem.wall.replace('_back', '')}</span>
          </div>

          {/* Position nudge */}
          {onItemsChange && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Position</span>
              <button onClick={() => nudgePosition(-3)} className="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-600 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-sm font-black text-slate-700 w-12 text-center">{selectedItem.position_in}&quot;</span>
              <button onClick={() => nudgePosition(3)} className="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-600 transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {selectedItem.notes && (
            <span className="text-xs text-slate-400 italic flex-1 min-w-0 truncate">{selectedItem.notes}</span>
          )}

          {onItemsChange && (
            <button onClick={deleteSelected}
              className="ml-auto flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 transition-colors font-bold">
              <Trash2 className="w-3.5 h-3.5" />Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
