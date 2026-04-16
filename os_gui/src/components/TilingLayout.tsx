import { useRef, useState, useCallback, ReactNode } from 'react';
import { useDrag, useDrop } from 'react-dnd';

export type LayoutMode = 'master' | 'bstack' | 'monocle' | 'grid';

export interface PaneConfig {
  id: string;
  label: string;
  icon: string;
  content: ReactNode;
}

export type SlotNode =
  | { type: 'pane'; id: string }
  | { type: 'tabgroup'; ids: string[]; active: string };

const DRAG_TYPE = 'PANEL';

type DragItem = { id: string; fromSlotIdx: number | null };

interface TilingLayoutProps {
  slots: SlotNode[];
  allPanes: PaneConfig[];
  mode: LayoutMode;
  focusedSlotIdx: number | null;
  onFocusSlot: (idx: number) => void;
  gap?: number;
  onDetach?: (id: string) => void;
  onMergeInto: (sourceId: string, targetSlotIdx: number) => void;
  onCloseTab: (slotIdx: number, tabId: string) => void;
  onDetachTab: (slotIdx: number, tabId: string) => void;
  onChangeActiveTab: (slotIdx: number, tabId: string) => void;
  onReorderTab: (slotIdx: number, draggedId: string, targetId: string) => void;
}

const MIN_PCT = 15;

export function TilingLayout({
  slots, allPanes, mode, focusedSlotIdx, onFocusSlot, gap = 8,
  onDetach, onMergeInto, onCloseTab, onDetachTab, onChangeActiveTab, onReorderTab,
}: TilingLayoutProps) {
  const [mSplit, setMSplit] = useState(55);
  const [sSplit, setSSplit] = useState(50);
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

  const startDrag = useCallback((axis: 'master' | 'stack') => { dragging.current = axis; }, []);
  const stopDrag  = useCallback(() => { dragging.current = null; }, []);

  const renderSlot = (slot: SlotNode, slotIdx: number) => {
    if (slot.type === 'pane') {
      const cfg = allPanes.find(p => p.id === slot.id);
      if (!cfg) return null;
      return (
        <SlotPane
          key={slot.id}
          config={cfg}
          slotIdx={slotIdx}
          isFocused={focusedSlotIdx === slotIdx}
          onClick={() => onFocusSlot(slotIdx)}
          onDetach={onDetach}
          onMergeInto={onMergeInto}
        />
      );
    }
    return (
      <TabGroupPane
        key={slot.ids.join(',')}
        slot={slot}
        slotIdx={slotIdx}
        allPanes={allPanes}
        isFocused={focusedSlotIdx === slotIdx}
        onFocus={() => onFocusSlot(slotIdx)}
        onMergeInto={onMergeInto}
        onCloseTab={onCloseTab}
        onDetachTab={onDetachTab}
        onChangeActiveTab={onChangeActiveTab}
        onReorderTab={onReorderTab}
      />
    );
  };

  if (slots.length === 0) return <div className="tiling-root empty">No panes visible</div>;

  if (mode === 'monocle' || slots.length === 1) {
    const idx = focusedSlotIdx != null && focusedSlotIdx < slots.length ? focusedSlotIdx : 0;
    return (
      <div className="tiling-root" style={{ padding: gap }}>
        {renderSlot(slots[idx], idx)}
      </div>
    );
  }

  if (mode === 'grid') {
    const topRow    = slots.slice(0, 2);
    const bottomRow = slots.slice(2, 4);
    return (
      <div className="tiling-root layout-grid" ref={containerRef}
        onPointerMove={onPointerMove} onPointerUp={stopDrag} onPointerLeave={stopDrag}
        style={{ padding: gap, display: 'flex', flexDirection: 'column', gap }}>
        <div style={{ display: 'flex', height: `${slots.length > 2 ? mSplit : 100}%`, gap, flexShrink: 0 }}>
          <div style={{ width: `${topRow.length > 1 ? sSplit : 100}%`, display: 'flex' }}>
            {topRow[0] && renderSlot(topRow[0], 0)}
          </div>
          {topRow.length > 1 && (
            <>
              <div className="tiling-handle tiling-handle--col" style={{ margin: `0 -${gap / 2}px`, background: 'transparent' }}
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('stack'); }} />
              <div style={{ width: `${100 - sSplit}%`, display: 'flex' }}>
                {renderSlot(topRow[1], 1)}
              </div>
            </>
          )}
        </div>
        {slots.length > 2 && (
          <>
            <div className="tiling-handle tiling-handle--row" style={{ margin: `-${gap / 2}px 0`, background: 'transparent' }}
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('master'); }} />
            <div style={{ display: 'flex', height: `${100 - mSplit}%`, gap, flexShrink: 0 }}>
              <div style={{ width: `${bottomRow.length > 1 ? sSplit : 100}%`, display: 'flex' }}>
                {bottomRow[0] && renderSlot(bottomRow[0], 2)}
              </div>
              {bottomRow.length > 1 && (
                <>
                  <div className="tiling-handle tiling-handle--col" style={{ margin: `0 -${gap / 2}px`, background: 'transparent' }}
                    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('stack'); }} />
                  <div style={{ width: `${100 - sSplit}%`, display: 'flex' }}>
                    {renderSlot(bottomRow[1], 3)}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // master / bstack
  const master = slots[0];
  const stack1 = slots[1];
  const stack2 = slots[2];

  return (
    <div className={`tiling-root layout-${mode}`} ref={containerRef}
      onPointerMove={onPointerMove} onPointerUp={stopDrag} onPointerLeave={stopDrag}
      style={{ padding: gap, display: 'flex', flexDirection: mode === 'master' ? 'row' : 'column', gap }}>
      <div style={{ [mode === 'master' ? 'width' : 'height']: `${slots.length > 1 ? mSplit : 100}%`, display: 'flex', flexShrink: 0 }}>
        {renderSlot(master, 0)}
      </div>
      {slots.length > 1 && (
        <>
          <div className={`tiling-handle tiling-handle--${mode === 'master' ? 'col' : 'row'}`}
            style={{ margin: mode === 'master' ? `0 -${gap / 2}px` : `-${gap / 2}px 0`, background: 'transparent' }}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('master'); }} />
          <div style={{ [mode === 'master' ? 'width' : 'height']: `${100 - mSplit}%`, display: 'flex', flexDirection: mode === 'master' ? 'column' : 'row', gap, flexShrink: 0 }}>
            <div style={{ [mode === 'master' ? 'height' : 'width']: slots.length > 2 ? `${sSplit}%` : '100%', display: 'flex' }}>
              {renderSlot(stack1, 1)}
            </div>
            {slots.length > 2 && stack2 && (
              <>
                <div className={`tiling-handle tiling-handle--${mode === 'master' ? 'row' : 'col'}`}
                  style={{ margin: mode === 'master' ? `-${gap / 2}px 0` : `0 -${gap / 2}px`, background: 'transparent' }}
                  onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); startDrag('stack'); }} />
                <div style={{ [mode === 'master' ? 'height' : 'width']: `${100 - sSplit}%`, display: 'flex' }}>
                  {renderSlot(stack2, 2)}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Single-pane slot ──────────────────────────────────────────────────────────
interface SlotPaneProps {
  config: PaneConfig;
  slotIdx: number;
  isFocused: boolean;
  onClick: () => void;
  onDetach?: (id: string) => void;
  onMergeInto: (sourceId: string, targetSlotIdx: number) => void;
}

function SlotPane({ config, slotIdx, isFocused, onClick, onDetach, onMergeInto }: SlotPaneProps) {
  const [{ isDragging }, dragRef] = useDrag(() => ({
    type: DRAG_TYPE,
    item: { id: config.id, fromSlotIdx: slotIdx } as DragItem,
    collect: monitor => ({ isDragging: monitor.isDragging() }),
  }), [config.id, slotIdx]);

  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: DRAG_TYPE,
    canDrop: (item: DragItem) => item.id !== config.id,
    drop: (item: DragItem) => onMergeInto(item.id, slotIdx),
    collect: monitor => ({ isOver: monitor.isOver() && monitor.canDrop() }),
  }), [config.id, slotIdx, onMergeInto]);

  const setRef = (el: HTMLDivElement | null) => {
    (dragRef as any)(el);
    (dropRef as any)(el);
  };

  return (
    <div
      className={`tiling-pane ${isFocused ? 'tiling-pane--focused' : ''}`}
      id={`pane-${config.id}`}
      style={{ flex: 1, minWidth: 0, minHeight: 0, opacity: isDragging ? 0.4 : 1 }}
      onClickCapture={onClick}
    >
      <div
        ref={setRef}
        className="pane-header"
        style={{
          cursor: 'grab',
          background: isOver ? 'var(--accent)' : undefined,
          transition: 'background 0.1s',
        }}
      >
        <span className="pane-icon">{config.icon}</span>
        <span className="pane-title" style={{ color: isOver ? '#fff' : undefined }}>{config.label}</span>
        {onDetach && (
          <div style={{ marginLeft: 'auto', display: 'flex' }}>
            <span className="pane-detach-btn"
              style={{ cursor: 'pointer', padding: '0 4px', fontSize: '11px', color: isOver ? '#fff' : 'var(--text-hint)' }}
              onClick={e => { e.stopPropagation(); onDetach(config.id); }}
              title="Detach as Floating Panel">↗️</span>
          </div>
        )}
      </div>
      <div className="pane-body">{config.content}</div>
    </div>
  );
}

// ── Tab-group slot ────────────────────────────────────────────────────────────
interface TabGroupPaneProps {
  slot: Extract<SlotNode, { type: 'tabgroup' }>;
  slotIdx: number;
  allPanes: PaneConfig[];
  isFocused: boolean;
  onFocus: () => void;
  onMergeInto: (sourceId: string, targetSlotIdx: number) => void;
  onCloseTab: (slotIdx: number, tabId: string) => void;
  onDetachTab: (slotIdx: number, tabId: string) => void;
  onChangeActiveTab: (slotIdx: number, tabId: string) => void;
  onReorderTab: (slotIdx: number, draggedId: string, targetId: string) => void;
}

function TabGroupPane({
  slot, slotIdx, allPanes, isFocused, onFocus,
  onMergeInto, onCloseTab, onDetachTab, onChangeActiveTab, onReorderTab,
}: TabGroupPaneProps) {
  const activeConfig = allPanes.find(p => p.id === slot.active);

  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: DRAG_TYPE,
    canDrop: (item: DragItem) => !slot.ids.includes(item.id),
    drop: (item: DragItem) => onMergeInto(item.id, slotIdx),
    collect: monitor => ({ isOver: monitor.isOver() && monitor.canDrop() }),
  }), [slot.ids, slotIdx, onMergeInto]);

  return (
    <div
      className={`tiling-pane tiling-pane--tabgroup ${isFocused ? 'tiling-pane--focused' : ''}`}
      style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      onClickCapture={onFocus}
    >
      {/* Tab bar — also the drop target */}
      <div
        ref={dropRef as any}
        className="pane-header"
        style={{
          display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px',
          background: isOver ? 'color-mix(in srgb, var(--accent) 20%, var(--bg-panel-header))' : undefined,
          flexWrap: 'nowrap', overflowX: 'auto',
          transition: 'background 0.1s',
        }}
      >
        {slot.ids.map(id => {
          const cfg = allPanes.find(p => p.id === id);
          if (!cfg) return null;
          return (
            <TabChip
              key={id}
              config={cfg}
              slotIdx={slotIdx}
              isActive={id === slot.active}
              onActivate={() => onChangeActiveTab(slotIdx, id)}
              onClose={() => onCloseTab(slotIdx, id)}
              onDetach={() => onDetachTab(slotIdx, id)}
              onReorderTab={onReorderTab}
            />
          );
        })}
        {isOver && (
          <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginLeft: 4, whiteSpace: 'nowrap' }}>+ Drop here</span>
        )}
      </div>

      {/* Active pane body */}
      <div className="pane-body" style={{ flex: 1, minHeight: 0 }}>
        {activeConfig ? activeConfig.content : null}
      </div>
    </div>
  );
}

// ── Individual tab chip ───────────────────────────────────────────────────────
interface TabChipProps {
  config: PaneConfig;
  slotIdx: number;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDetach: () => void;
  onReorderTab: (slotIdx: number, draggedId: string, targetId: string) => void;
}

function TabChip({ config, slotIdx, isActive, onActivate, onClose, onDetach, onReorderTab }: TabChipProps) {
  const [{ isDragging }, dragRef] = useDrag(() => ({
    type: DRAG_TYPE,
    item: { id: config.id, fromSlotIdx: slotIdx } as DragItem,
    collect: monitor => ({ isDragging: monitor.isDragging() }),
  }), [config.id, slotIdx]);

  // Drop target for reordering within the same tabgroup
  const [{ isReorderOver }, dropRef] = useDrop(() => ({
    accept: DRAG_TYPE,
    canDrop: (item: DragItem) => item.fromSlotIdx === slotIdx && item.id !== config.id,
    drop: (item: DragItem) => onReorderTab(slotIdx, item.id, config.id),
    collect: monitor => ({ isReorderOver: monitor.isOver() && monitor.canDrop() }),
  }), [slotIdx, config.id, onReorderTab]);

  const setRef = (el: HTMLDivElement | null) => {
    (dragRef as any)(el);
    (dropRef as any)(el);
  };

  return (
    <div
      ref={setRef}
      onClick={e => { e.stopPropagation(); onActivate(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', borderRadius: 4, cursor: 'grab',
        background: isReorderOver ? 'var(--bg-secondary)' : isActive ? 'var(--bg)' : 'transparent',
        borderBottom: isActive ? '2px solid var(--accent)' : isReorderOver ? '2px solid var(--accent)' : '2px solid transparent',
        fontSize: 11, fontWeight: isActive ? 600 : 400,
        color: isActive ? 'var(--text-primary)' : 'var(--text-hint)',
        opacity: isDragging ? 0.4 : 1,
        flexShrink: 0, userSelect: 'none',
        outline: isReorderOver ? '1px solid var(--accent)' : undefined,
        transition: 'background 0.1s, color 0.1s, outline 0.05s',
      }}
    >
      <span>{config.icon}</span>
      <span>{config.label}</span>
      <span
        onClick={e => { e.stopPropagation(); onDetach(); }}
        title="Detach tab"
        style={{ fontSize: 9, color: 'var(--text-hint)', padding: '0 1px', lineHeight: 1, cursor: 'pointer', opacity: 0.6 }}
      >↗</span>
      <span
        onClick={e => { e.stopPropagation(); onClose(); }}
        title="Close tab"
        style={{ fontSize: 10, color: 'var(--text-hint)', padding: '0 1px', lineHeight: 1, cursor: 'pointer' }}
      >×</span>
    </div>
  );
}
