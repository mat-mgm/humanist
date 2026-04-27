import { lazy, Suspense, useState, useRef, useCallback, useEffect } from 'react';
import { TimelineView } from './TimelineView';
import { CalendarView } from './CalendarView';

const GlobePanel = lazy(() => import('./GlobePanel').then(m => ({ default: m.GlobePanel })));

export function CausalPanel() {
  const [bottomTab, setBottomTab] = useState<'timeline' | 'calendar'>('timeline');
  const [splitPct, setSplitPct]   = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeRef    = useRef<{ startY: number; startPct: number; containerH: number } | null>(null);

  const onSplitDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const containerH = containerRef.current.getBoundingClientRect().height;
    resizeRef.current = { startY: e.clientY, startPct: splitPct, containerH };
    const onMove = (ev: PointerEvent) => {
      if (!resizeRef.current) return;
      const delta    = ev.clientY - resizeRef.current.startY;
      const deltaPct = (delta / resizeRef.current.containerH) * 100;
      setSplitPct(Math.max(15, Math.min(85, resizeRef.current.startPct + deltaPct)));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [splitPct]);

  useEffect(() => {
    const forceTimeline = () => setBottomTab('timeline');
    window.addEventListener('humanist:benchmark-prepare', forceTimeline);
    return () => window.removeEventListener('humanist:benchmark-prepare', forceTimeline);
  }, []);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Globe — top, takes splitPct% of total height */}
      <div style={{ flex: `0 0 ${splitPct}%`, minHeight: 0, overflow: 'hidden' }}>
        <Suspense fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-hint)', fontSize: 12 }}>
            Loading globe…
          </div>
        }>
          <GlobePanel />
        </Suspense>
      </div>

      {/* Drag handle */}
      <div
        onPointerDown={onSplitDragStart}
        className="causal-split-handle"
      />

      {/* Tab switcher */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        height: 28, flexShrink: 0,
        background: 'var(--bg-panel-header)',
        borderBottom: '1px solid var(--border)',
        padding: '0 8px',
      }}>
        {(['timeline', 'calendar'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setBottomTab(tab)}
            style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              padding: '2px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: bottomTab === tab ? 'var(--accent)' : 'transparent',
              color: bottomTab === tab ? '#fff' : 'var(--text-hint)',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {tab === 'timeline' ? 'Timeline' : 'Calendar'}
          </button>
        ))}
      </div>

      {/* Bottom — timeline or calendar, takes remaining space */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {bottomTab === 'timeline' ? <TimelineView /> : <CalendarView />}
      </div>

    </div>
  );
}
