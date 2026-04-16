import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useOsStore } from '../store';

const RULER_H = 32;
const ROW_H   = 34;
const ROW_PAD = 4;

const EVENT_COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fb923c', '#a78bfa',
  '#38bdf8', '#f87171', '#4ade80', '#e879f9', '#facc15',
];

const fmtYear = (jsYear: number) => jsYear > 0 ? `${jsYear} CE` : `${1 - jsYear} BCE`;
const isPoint = (trait: { event_at?: string | null; starts_at?: string | null }) =>
  !!trait.event_at && !trait.starts_at;

const TIME_MIN  = new Date('-010100-01-01').getTime();
const TIME_MAX  = Date.now() + 3.15e10;
const ZOOM_MAX  = 1e12;
const INIT_CENTER = new Date('-005000-01-01').getTime();
const INIT_ZOOM   = 1.5e10;

const MS = {
  second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
  week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000,
  decade: 315_360_000_000, century: 3_153_600_000_000,
  millennium: 31_536_000_000_000, tenKyr: 315_360_000_000_000,
};
const MS_SORTED = Object.entries(MS).sort((a, b) => a[1] - b[1]);

export function TimelineView() {
  const { temporalTraits, entities, selectedIds, setSelectedIds } = useOsStore();

  const [zoom, setZoom]           = useState(INIT_ZOOM);
  const [centerTime, setCenterTime] = useState(INIT_CENTER);
  const containerRef  = useRef<HTMLDivElement>(null);
  const [width, setWidth]   = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth); setHeight(el.clientHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const timelineEvents = useMemo(() =>
    temporalTraits.map(t => ({ trait: t, entity: entities.find(e => e.id === t.owner) })).filter(e => e.entity),
  [temporalTraits, entities]);

  const selectedTemporalId = useMemo(() => {
    const sel = selectedIds[0];
    return sel ? (timelineEvents.find(e => e.entity?.id === sel)?.entity?.id ?? null) : null;
  }, [selectedIds, timelineEvents]);

  const clampTime = useCallback((t: number) => {
    if (!isFinite(t)) return 0;
    return Math.max(TIME_MIN, Math.min(TIME_MAX, t));
  }, []);

  const timeToX = useCallback((t: number) => width / 2 + (t - centerTime) / zoom, [centerTime, zoom, width]);
  const xToTime = useCallback((x: number) => centerTime + (x - width / 2) * zoom, [centerTime, zoom, width]);

  const handleReset = useCallback(() => {
    const times: number[] = [];
    for (const { trait } of timelineEvents) {
      for (const s of [trait.event_at, trait.starts_at, trait.ends_at]) {
        if (!s) continue;
        const t = new Date(s).getTime();
        if (isFinite(t)) times.push(t);
      }
      if (trait.starts_at && !trait.ends_at) times.push(Date.now());
    }
    if (times.length === 0) return;
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = maxT - minT || 3.15e10;
    const w = Math.max(width, 400);
    setZoom(Math.max(10, Math.min(span / (w * 0.8), ZOOM_MAX)));
    setCenterTime(clampTime(minT + span / 2));
  }, [timelineEvents, width, clampTime]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.2 : 0.8;
      const mx = e.clientX - (containerRef.current?.getBoundingClientRect().left ?? 0);
      const mt = xToTime(mx);
      const nz = Math.max(10, Math.min(zoom * factor, ZOOM_MAX));
      setZoom(nz);
      setCenterTime(clampTime(mt - (mx - width / 2) * nz));
    } else {
      setCenterTime(prev => clampTime(prev + e.deltaX * zoom));
    }
  };

  const isDragging = useRef(false);
  const lastX      = useRef(0);
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    lastX.current = e.clientX;
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setCenterTime(prev => clampTime(prev - (e.clientX - lastX.current) * zoom));
      lastX.current = e.clientX;
    };
    const onUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [zoom, clampTime]);

  // RRULE expansion
  const expandedEvents = useMemo(() => {
    const visStart = xToTime(0);
    const visEnd   = xToTime(width > 0 ? width : 1200);

    const parseRRule = (rrule: string) => ({
      freq:       /FREQ=(\w+)/i.exec(rrule)?.[1]?.toUpperCase() ?? '',
      byMonth:    /BYMONTH=(\d+)/i.exec(rrule)?.[1] ? parseInt(/BYMONTH=(\d+)/i.exec(rrule)![1]) - 1 : null,
      byMonthDay: /BYMONTHDAY=(\d+)/i.exec(rrule)?.[1] ? parseInt(/BYMONTHDAY=(\d+)/i.exec(rrule)![1]) : null,
      interval:   /INTERVAL=(\d+)/i.exec(rrule)?.[1] ? parseInt(/INTERVAL=(\d+)/i.exec(rrule)![1]) : 1,
    });

    type EvtExt = typeof timelineEvents[number] & { isRecurring?: boolean; baseId?: string };
    const result: EvtExt[] = [];
    for (const ev of timelineEvents) {
      if (!ev.trait.recurrence || !ev.trait.event_at) { result.push(ev); continue; }
      const baseT = new Date(ev.trait.event_at).getTime();
      if (!isFinite(baseT)) { result.push(ev); continue; }

      const { freq, byMonth, byMonthDay, interval } = parseRRule(ev.trait.recurrence);
      const baseDate = new Date(ev.trait.event_at);
      const instances: number[] = [];
      const MAX_OCC = 500;

      if (freq === 'YEARLY') {
        const mo = byMonth ?? baseDate.getMonth();
        const day = byMonthDay ?? baseDate.getDate();
        const sy = new Date(visStart).getFullYear() - 1;
        const ey = new Date(visEnd).getFullYear() + 1;
        for (let yr = sy; yr <= ey && instances.length < MAX_OCC; yr += interval) {
          const t = new Date(yr, mo, day).getTime();
          if (t >= visStart && t <= visEnd) instances.push(t);
        }
      } else if (freq === 'MONTHLY') {
        const day = byMonthDay ?? baseDate.getDate();
        let d = new Date(new Date(visStart).getFullYear(), new Date(visStart).getMonth(), day);
        while (d.getTime() <= visEnd && instances.length < MAX_OCC) {
          const t = d.getTime();
          if (t >= visStart) instances.push(t);
          d = new Date(d.getFullYear(), d.getMonth() + interval, day);
        }
      } else if (freq === 'WEEKLY') {
        const step = interval * 7 * 86_400_000;
        let t = baseT + Math.ceil((visStart - baseT) / step) * step;
        while (t <= visEnd && instances.length < MAX_OCC) { if (t >= visStart) instances.push(t); t += step; }
      } else if (freq === 'DAILY') {
        const step = interval * 86_400_000;
        let t = baseT + Math.ceil((visStart - baseT) / step) * step;
        while (t <= visEnd && instances.length < MAX_OCC) { if (t >= visStart) instances.push(t); t += step; }
      } else { result.push(ev); continue; }

      if (instances.length === 0) continue;
      instances.forEach(t => result.push({
        trait: { ...ev.trait, event_at: new Date(t).toISOString(), id: `${ev.trait.id}_${t}` },
        entity: ev.entity, isRecurring: true, baseId: ev.trait.id,
      }));
    }
    return result;
  }, [timelineEvents, xToTime, width]);

  // Row-packing
  const packedEvents = useMemo(() => {
    const spans     = (expandedEvents as any[]).filter((e: any) => !isPoint(e.trait) && !e.isRecurring);
    const points    = (expandedEvents as any[]).filter((e: any) =>  isPoint(e.trait) && !e.isRecurring);
    const recurring = (expandedEvents as any[]).filter((e: any) =>  e.isRecurring);

    const getRange = (e: any): [number, number] => {
      const tStart = new Date(e.trait.event_at || e.trait.starts_at || '').getTime();
      const tEnd   = e.trait.ends_at ? new Date(e.trait.ends_at).getTime() : e.trait.starts_at ? Date.now() : tStart;
      return [isFinite(tStart) ? tStart : 0, isFinite(tEnd) ? tEnd : 0];
    };

    const assignRows = (evts: any[]) => {
      const sorted = [...evts].sort((a, b) => getRange(a)[0] - getRange(b)[0]);
      const rowEnds: number[] = [];
      const rowOf = new Map<string, number>();
      for (const e of sorted) {
        const [s, end] = getRange(e);
        const row = rowEnds.findIndex(re => re <= s);
        if (row === -1) { rowEnds.push(end); rowOf.set(e.trait.id, rowEnds.length - 1); }
        else { rowEnds[row] = end; rowOf.set(e.trait.id, row); }
      }
      return evts.map(e => rowOf.get(e.trait.id) ?? 0);
    };

    const spanRows  = assignRows(spans);
    const pointRows = assignRows(points);
    const recurRows = assignRows(recurring);
    const maxSpanRow  = spanRows.length  > 0 ? Math.max(...spanRows)  + 1 : 0;
    const maxPointRow = pointRows.length > 0 ? Math.max(...pointRows) + 1 : 0;

    return [
      ...spans.map((e: any, i: number)     => ({ ...e, absRow: spanRows[i],                               colorIdx: i,                         track: 'span' })),
      ...points.map((e: any, i: number)    => ({ ...e, absRow: maxSpanRow + pointRows[i],                  colorIdx: spans.length + i,          track: 'point' })),
      ...recurring.map((e: any, i: number) => ({ ...e, absRow: maxSpanRow + maxPointRow + recurRows[i],    colorIdx: spans.length + points.length + i, track: 'recurring' })),
    ];
  }, [expandedEvents]);

  // Tick generation
  const computeTicks = useCallback(() => {
    if (width === 0) return { ticks: [] as { t: number; x: number }[], interval: MS.year };
    const MIN_TICK_PX = 90;
    const startT = xToTime(0), endT = xToTime(width);
    let interval = MS_SORTED[MS_SORTED.length - 1][1];
    for (const [, v] of MS_SORTED) { if (v / zoom >= MIN_TICK_PX) { interval = v; break; } }
    const first = Math.ceil(startT / interval) * interval;
    const raw: number[] = [];
    for (let t = first; t <= endT; t += interval) raw.push(t);
    const ticks: { t: number; x: number }[] = [];
    let lastTX = -Infinity;
    for (const t of raw) {
      const x = timeToX(t);
      if (x - lastTX >= MIN_TICK_PX) { ticks.push({ t, x }); lastTX = x; }
    }
    return { ticks, interval };
  }, [xToTime, timeToX, width, zoom]);

  const formatTick = (t: number, interval: number): string => {
    const d = new Date(t);
    const yr = d.getFullYear();
    if (interval >= MS.tenKyr)     { const k = Math.round(Math.abs(yr) / 1000); return `${k}k ${yr >= 0 ? 'CE' : 'BCE'}`; }
    if (interval >= MS.millennium) { const k = Math.floor(Math.abs(yr) / 1000); return `${k}k ${yr >= 0 ? 'CE' : 'BCE'}`; }
    if (interval >= MS.century)    { const nth = (n: number) => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; return `${nth(Math.floor(Math.abs(yr) / 100) + 1)}c ${yr >= 0 ? 'CE' : 'BCE'}`; }
    if (interval >= MS.decade)  return fmtYear(Math.floor(yr / 10) * 10);
    if (interval >= MS.year)    return fmtYear(yr);
    if (interval >= MS.month)   return `${d.toLocaleString('default', { month: 'short' })} ${fmtYear(yr)}`;
    if (interval >= MS.day)     return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const navBtn: React.CSSProperties = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    borderRadius: 4, padding: '4px 8px', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 11,
  };

  const { ticks, interval } = computeTicks();
  const totalRows = packedEvents.length > 0 ? Math.max(...packedEvents.map(e => e.absRow)) + 1 : 1;
  const contentH  = totalRows * ROW_H + 16;

  return (
    <div className="panel timeline-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      {/* Toolbar */}
      <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)', height: 40, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Timeline</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={handleReset} title="Fit all events" style={{ ...navBtn, color: 'var(--accent)', borderColor: 'var(--accent)', fontSize: 11 }}>⟳ Reset</button>
          <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{fmtYear(new Date(centerTime).getFullYear())} · Ctrl+scroll to zoom</span>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'grab', display: 'flex', flexDirection: 'column' }}
        onMouseDown={handleMouseDown} onWheel={handleWheel}>
        {/* Ruler */}
        <div style={{ position: 'relative', height: RULER_H, flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', zIndex: 5 }}>
          {ticks.map(({ t, x }) => (
            <div key={t} style={{ position: 'absolute', left: x, bottom: 0, height: 10, borderLeft: '1px solid var(--text-hint)' }}>
              <span style={{ position: 'absolute', bottom: 12, left: 4, fontSize: 10, color: 'var(--text-hint)', whiteSpace: 'nowrap' }}>{formatTick(t, interval)}</span>
            </div>
          ))}
          {(() => {
            const nx = timeToX(Date.now());
            return nx >= 2 && nx <= width - 2 ? (
              <div style={{ position: 'absolute', left: nx, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', pointerEvents: 'none' }}>
                <div style={{ width: 1, flex: 1, background: 'var(--accent)', opacity: 0.8 }} />
                <span style={{ position: 'absolute', bottom: 2, left: 3, fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.04em', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>Today</span>
              </div>
            ) : null;
          })()}
        </div>

        {/* Event area */}
        <div style={{ flex: 1, overflowY: contentH > (height - RULER_H) ? 'auto' : 'hidden', overflowX: 'hidden', position: 'relative' }}>
          <div style={{ position: 'relative', height: Math.max(contentH, height - RULER_H) }}>
            {(() => {
              const nx = timeToX(Date.now());
              return nx >= 0 && nx <= width ? <div style={{ position: 'absolute', left: nx, top: 0, bottom: 0, width: 1, background: 'var(--accent)', opacity: 0.15, pointerEvents: 'none' }} /> : null;
            })()}

            {(() => {
              const recurringGroups = new Map<string, typeof packedEvents>();
              for (const e of packedEvents) {
                if ((e as any).track !== 'recurring') continue;
                const bid = (e as any).baseId ?? e.trait.id;
                if (!recurringGroups.has(bid)) recurringGroups.set(bid, []);
                recurringGroups.get(bid)!.push(e);
              }
              const renderedRecurBase = new Set<string>();

              return packedEvents.map(({ trait, entity, absRow, colorIdx, ...rest }) => {
                const isSelected = entity?.id === selectedTemporalId;
                const startStr = trait.event_at || trait.starts_at;
                if (!startStr) return null;
                const startT = new Date(startStr).getTime();
                if (!isFinite(startT)) return null;

                const x   = timeToX(startT);
                const top = 8 + absRow * ROW_H;
                const color = EVENT_COLORS[colorIdx % EVENT_COLORS.length];
                const pt    = isPoint(trait);
                const track = (rest as any).track as string;

                let barW = 3;
                if (trait.starts_at) {
                  const endT = trait.ends_at ? new Date(trait.ends_at).getTime() : Date.now();
                  barW = Math.max(4, (endT - startT) / zoom);
                }

                if (track === 'recurring') {
                  const baseId = (rest as any).baseId ?? trait.id;
                  if (renderedRecurBase.has(baseId)) return null;
                  const group = recurringGroups.get(baseId) ?? [];
                  const sortedGroup = [...group].sort((a, b) => new Date(a.trait.event_at!).getTime() - new Date(b.trait.event_at!).getTime());
                  let spacing = Infinity;
                  if (sortedGroup.length >= 2) {
                    const x0 = timeToX(new Date(sortedGroup[0].trait.event_at!).getTime());
                    const x1 = timeToX(new Date(sortedGroup[1].trait.event_at!).getTime());
                    spacing = Math.abs(x1 - x0);
                  }
                  renderedRecurBase.add(baseId);

                  if (spacing < 16 && sortedGroup.length > 0) {
                    const visX0 = Math.max(0, timeToX(new Date(sortedGroup[0].trait.event_at!).getTime()));
                    const visX1 = Math.min(width, timeToX(new Date(sortedGroup[sortedGroup.length - 1].trait.event_at!).getTime()) + 4);
                    const bandW = Math.max(20, visX1 - visX0);
                    const stripeW = Math.max(2, spacing * 0.6);
                    return (
                      <div key={`recur_band_${baseId}`}
                        onClick={e => { e.stopPropagation(); entity && setSelectedIds([entity.id]); }}
                        style={{ position: 'absolute', left: visX0, top, width: bandW, height: ROW_H - ROW_PAD,
                          background: `repeating-linear-gradient(90deg, ${color}55 0px, ${color}55 ${stripeW}px, transparent ${stripeW}px, transparent ${spacing}px)`,
                          border: `1px solid ${color}88`, borderRadius: 4, cursor: 'pointer', overflow: 'visible',
                          boxShadow: isSelected ? `0 0 8px ${color}88` : 'none', zIndex: isSelected ? 10 : 1 }}>
                        <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                          {entity?.label} <span style={{ opacity: 0.6, fontSize: 10 }}>🔁 ×{sortedGroup.length}</span>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <>
                      {sortedGroup.map(ev => {
                        const ex = timeToX(new Date(ev.trait.event_at!).getTime());
                        if (ex < -10 || ex > width + 10) return null;
                        const isSel = ev.entity?.id === selectedTemporalId;
                        return (
                          <div key={ev.trait.id} onClick={e => { e.stopPropagation(); ev.entity && setSelectedIds([ev.entity.id]); }}
                            style={{ position: 'absolute', left: ex, top, width: 0, height: ROW_H - ROW_PAD, cursor: 'pointer', zIndex: isSel ? 10 : 2 }}>
                            <div style={{ position: 'absolute', left: 0, top: 14, width: 2, height: ROW_H - 18, background: color, borderRadius: '0 0 2px 2px', opacity: 0.8 }} />
                            <div style={{ position: 'absolute', left: -4, top: 2, width: isSel ? 12 : 10, height: isSel ? 12 : 10, background: color, border: '2px solid var(--bg)', borderRadius: '50%', boxShadow: isSel ? `0 0 6px ${color}` : 'none' }} />
                            {spacing >= 80 && (
                              <span style={{ position: 'absolute', left: 8, top: 3, fontSize: 10, color: 'var(--text-primary)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{ev.entity?.label}</span>
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                }

                if (x + barW < 0 || x > width) return null;

                if (pt) {
                  return (
                    <div key={trait.id} onClick={e => { e.stopPropagation(); entity && setSelectedIds([entity.id]); }}
                      style={{ position: 'absolute', left: x, top, width: 0, height: ROW_H - ROW_PAD, cursor: 'pointer', zIndex: isSelected ? 10 : 2 }}>
                      <div style={{ position: 'absolute', left: 0, top: 14, width: 2, height: ROW_H - 18, background: color, borderRadius: '0 0 2px 2px', opacity: isSelected ? 1 : 0.8 }} />
                      <div style={{ position: 'absolute', left: -5, top: 2, width: isSelected ? 14 : 12, height: isSelected ? 14 : 12, background: color, border: '2px solid var(--bg)', borderRadius: '50%', boxShadow: isSelected ? `0 0 8px ${color}` : 'none' }} />
                      <span style={{ position: 'absolute', left: 10, top: 3, fontSize: 11, fontWeight: isSelected ? 700 : 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{entity?.label}</span>
                    </div>
                  );
                }

                return (
                  <div key={trait.id} onClick={e => { e.stopPropagation(); entity && setSelectedIds([entity.id]); }}
                    style={{ position: 'absolute', left: x, top, width: Math.max(4, barW), height: ROW_H - ROW_PAD,
                      background: isSelected ? color : `${color}30`, border: `2px solid ${color}`,
                      borderRadius: 4, cursor: 'pointer', boxShadow: isSelected ? `0 0 10px ${color}88` : 'none',
                      zIndex: isSelected ? 10 : 1, transition: 'all 0.15s', userSelect: 'none', overflow: 'visible' }}
                    onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.2)'; e.currentTarget.style.zIndex = '5'; }}
                    onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.zIndex = isSelected ? '10' : '1'; }}>
                    <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: isSelected ? 700 : 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{entity?.label}</span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
