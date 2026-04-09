import { useRef, useState, useCallback, ReactNode } from 'react';

export type LayoutMode = 'master' | 'bstack' | 'monocle' | 'grid';

export interface PaneConfig {
  id: string;
  label: string;
  icon: string;
  content: ReactNode;
}

interface TilingLayoutProps {
  panes: PaneConfig[];
  mode: LayoutMode;
  focusedId: string | null;
  onFocus: (id: string) => void;
  gap?: number;
  onDetach?: (id: string) => void;
}

const MIN_PCT = 15;

export function TilingLayout({ panes, mode, focusedId, onFocus, gap = 8, onDetach }: TilingLayoutProps) {
  const [mSplit, setMSplit] = useState(55); // Master split %
  const [sSplit, setSSplit] = useState(50); // Stack split %
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'master' | 'stack' | null>(null);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    
    if (dragging.current === 'master') {
      const pct = mode === 'master' 
        ? ((e.clientX - rect.left) / rect.width) * 100
        : ((e.clientY - rect.top) / rect.height) * 100;
      setMSplit(Math.max(MIN_PCT, Math.min(100 - MIN_PCT, pct)));
    } else {
      const pct = mode === 'master'
        ? ((e.clientY - rect.top) / rect.height) * 100
        : ((e.clientX - rect.left) / rect.width) * 100;
      setSSplit(Math.max(MIN_PCT, Math.min(100 - MIN_PCT, pct)));
    }
  }, [mode]);

  const startDrag = useCallback((axis: 'master' | 'stack') => {
    dragging.current = axis;
  }, []);

  const stopDrag = useCallback(() => {
    dragging.current = null;
  }, []);

  if (panes.length === 0) {
    return <div className="tiling-root empty">No panes visible</div>;
  }

  if (mode === 'monocle' || panes.length === 1) {
    const focusedIndex = Math.max(0, panes.findIndex(p => p.id === focusedId));
    const pane = panes[focusedIndex];
    return (
      <div className="tiling-root" style={{ padding: gap }}>
        <Pane 
          config={pane} 
          isFocused={true} 
          onClick={() => onFocus(pane.id)} 
          onDetach={onDetach}
        />
      </div>
    );
  }

  if (mode === 'grid') {
    const topRow = panes.slice(0, 2);
    const bottomRow = panes.slice(2, 4);
    return (
      <div className="tiling-root layout-grid" ref={containerRef} onPointerMove={onPointerMove} onPointerUp={stopDrag} onPointerLeave={stopDrag} style={{ padding: gap, display: 'flex', flexDirection: 'column', gap }}>
        {/* TOP ROW */}
        <div style={{ display: 'flex', height: `${panes.length > 2 ? mSplit : 100}%`, gap, flexShrink: 0 }}>
          <div style={{ width: `${topRow.length > 1 ? sSplit : 100}%`, display: 'flex' }}>
             {topRow[0] && <Pane config={topRow[0]} isFocused={topRow[0].id === focusedId} onClick={() => onFocus(topRow[0].id)} onDetach={onDetach} />}
          </div>
          {topRow.length > 1 && (
            <>
              <div className="tiling-handle tiling-handle--col" style={{ margin: `0 -${gap / 2}px`, background: 'transparent' }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('stack'); }} />
              <div style={{ width: `${100 - sSplit}%`, display: 'flex' }}>
                 {topRow[1] && <Pane config={topRow[1]} isFocused={topRow[1].id === focusedId} onClick={() => onFocus(topRow[1].id)} onDetach={onDetach} />}
              </div>
            </>
          )}
        </div>
        
        {panes.length > 2 && (
          <>
            <div className="tiling-handle tiling-handle--row" style={{ margin: `-${gap / 2}px 0`, background: 'transparent' }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('master'); }} />
            
            {/* BOTTOM ROW */}
            <div style={{ display: 'flex', height: `${100 - mSplit}%`, gap, flexShrink: 0 }}>
              <div style={{ width: `${bottomRow.length > 1 ? sSplit : 100}%`, display: 'flex' }}>
                 {bottomRow[0] && <Pane config={bottomRow[0]} isFocused={bottomRow[0].id === focusedId} onClick={() => onFocus(bottomRow[0].id)} onDetach={onDetach} />}
              </div>
              {bottomRow.length > 1 && (
                <>
                  <div className="tiling-handle tiling-handle--col" style={{ margin: `0 -${gap / 2}px`, background: 'transparent' }} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('stack'); }} />
                  <div style={{ width: `${100 - sSplit}%`, display: 'flex' }}>
                     {bottomRow[1] && <Pane config={bottomRow[1]} isFocused={bottomRow[1].id === focusedId} onClick={() => onFocus(bottomRow[1].id)} onDetach={onDetach} />}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  const master = panes[0];
  const stack1 = panes[1];
  const stack2 = panes[2]; // Might be undefined
  
  // Layout rendering tree
  return (
    <div
      className={`tiling-root layout-${mode}`}
      ref={containerRef}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onPointerLeave={stopDrag}
      style={{ padding: gap, display: 'flex', flexDirection: mode === 'master' ? 'row' : 'column', gap }}
    >
      {/* MASTER AREA */}
      <div style={{ [mode === 'master' ? 'width' : 'height']: `${panes.length > 1 ? mSplit : 100}%`, display: 'flex', flexShrink: 0 }}>
        <Pane config={master} isFocused={master.id === focusedId} onClick={() => onFocus(master.id)} onDetach={onDetach} />
      </div>

      {panes.length > 1 && (
        <>
          {/* MASTER SPLITTER */}
          <div
            className={`tiling-handle tiling-handle--${mode === 'master' ? 'col' : 'row'}`}
            style={{ margin: mode === 'master' ? `0 -${gap / 2}px` : `-${gap / 2}px 0`, background: 'transparent' }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('master'); }}
          />

          {/* STACK AREA */}
          <div style={{ [mode === 'master' ? 'width' : 'height']: `${100 - mSplit}%`, display: 'flex', flexDirection: mode === 'master' ? 'column' : 'row', gap, flexShrink: 0 }}>
            <div style={{ [mode === 'master' ? 'height' : 'width']: panes.length > 2 ? `${sSplit}%` : '100%', display: 'flex' }}>
              <Pane config={stack1} isFocused={stack1.id === focusedId} onClick={() => onFocus(stack1.id)} onDetach={onDetach} />
            </div>

            {panes.length > 2 && stack2 && (
              <>
                {/* STACK SPLITTER */}
                <div
                  className={`tiling-handle tiling-handle--${mode === 'master' ? 'row' : 'col'}`}
                  style={{ margin: mode === 'master' ? `-${gap / 2}px 0` : `0 -${gap / 2}px`, background: 'transparent' }}
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('stack'); }}
                />
                
                <div style={{ [mode === 'master' ? 'height' : 'width']: `${100 - sSplit}%`, display: 'flex' }}>
                  <Pane config={stack2} isFocused={stack2.id === focusedId} onClick={() => onFocus(stack2.id)} onDetach={onDetach} />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Individual Pane ───────────────────────────────────────────────────────────

interface PaneProps {
  config: PaneConfig;
  isFocused: boolean;
  onClick: () => void;
  onDetach?: (id: string) => void;
}

function Pane({ config, isFocused, onClick, onDetach }: PaneProps) {
  return (
    <div 
      className={`tiling-pane ${isFocused ? 'tiling-pane--focused' : ''}`} 
      id={`pane-${config.id}`}
      style={{ flex: 1, minWidth: 0, minHeight: 0 }}
      onClickCapture={onClick}
    >
      <div className="pane-header">
        <span className="pane-icon">{config.icon}</span>
        <span className="pane-title">{config.label}</span>
        {onDetach && (
          <div style={{ marginLeft: 'auto', display: 'flex' }}>
            <span 
              className="pane-detach-btn" 
              style={{ cursor: 'pointer', padding: '0 4px', fontSize: '11px', color: 'var(--text-hint)' }}
              onClick={(e) => {
                e.stopPropagation();
                onDetach(config.id);
              }}
              title="Detach as Floating Panel"
            >
              ↗️
            </span>
          </div>
        )}
      </div>
      <div className="pane-body">
        {config.content}
      </div>
    </div>
  );
}
