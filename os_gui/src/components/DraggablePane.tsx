import { useState } from 'react';
import { Rnd } from 'react-rnd';
import { PaneConfig, SlotNode } from './TilingLayout';

interface DraggablePaneProps {
  config: PaneConfig;
  isFocused: boolean;
  onClick: () => void;
  onAttach: (id: string) => void;
  tiledSlots: SlotNode[];
  allPanes: PaneConfig[];
  onMergeInto: (sourceId: string, targetSlotIdx: number) => void;
}

function slotLabel(slot: SlotNode, allPanes: PaneConfig[]): string {
  if (slot.type === 'pane') {
    const cfg = allPanes.find(p => p.id === slot.id);
    return cfg ? `${cfg.icon} ${cfg.label}` : slot.id;
  }
  return slot.ids
    .map(id => { const cfg = allPanes.find(p => p.id === id); return cfg ? cfg.icon : id; })
    .join(' ') + ' (tabs)';
}

export function DraggablePane({ config, isFocused, onClick, onAttach, tiledSlots, allPanes, onMergeInto }: DraggablePaneProps) {
  const [size, setSize] = useState({ width: 400, height: 500 });
  const [position, setPosition] = useState({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 250 });
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);

  return (
    <Rnd
      size={size}
      position={position}
      onDragStop={(_e, d) => {
        setPosition({ x: d.x, y: d.y });
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        setSize({
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        });
        setPosition(position);
      }}
      minWidth={300}
      minHeight={250}
      bounds="window"
      dragHandleClassName="pane-header"
      style={{ zIndex: isFocused ? 1000 : 900, display: 'flex', flexDirection: 'column' }}
      onMouseDownCapture={onClick}
    >
      <div
        className={`tiling-pane ${isFocused ? 'tiling-pane--focused' : ''}`}
        style={{ flex: 1, minWidth: 0, minHeight: 0, width: '100%', height: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
      >
        <div className="pane-header" style={{ cursor: 'move' }}>
          <span className="pane-icon">{config.icon}</span>
          <span className="pane-title">{config.label}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, position: 'relative' }}>
            {/* Attach as tab into existing slot */}
            {tiledSlots.length > 0 && (
              <span
                style={{ cursor: 'pointer', padding: '0 4px', fontSize: '11px', color: 'var(--text-hint)', userSelect: 'none' }}
                onClick={e => { e.stopPropagation(); setMergeMenuOpen(v => !v); }}
                title="Attach as tab into slot"
              >⊕</span>
            )}
            {mergeMenuOpen && (
              <div
                style={{
                  position: 'absolute', top: '100%', right: 0, zIndex: 10001,
                  background: 'var(--bg-panel)', border: '1px solid var(--border)',
                  borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  minWidth: 160, padding: '4px 0',
                }}
                onMouseLeave={() => setMergeMenuOpen(false)}
              >
                <div style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Merge into slot
                </div>
                {tiledSlots.map((slot, idx) => (
                  <div
                    key={idx}
                    onClick={e => { e.stopPropagation(); setMergeMenuOpen(false); onMergeInto(config.id, idx); }}
                    style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text-primary)' }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
                    onMouseLeave={ev => (ev.currentTarget.style.background = '')}
                  >
                    {slotLabel(slot, allPanes)}
                  </div>
                ))}
              </div>
            )}
            {/* Attach as new tile */}
            <span
              className="pane-detach-btn"
              style={{ cursor: 'pointer', padding: '0 4px', fontSize: '11px', color: 'var(--text-hint)' }}
              onClick={e => { e.stopPropagation(); onAttach(config.id); }}
              title="Attach to Layout as new tile"
            >↙️</span>
          </div>
        </div>
        <div className="pane-body">
          {config.content}
        </div>
      </div>
    </Rnd>
  );
}
