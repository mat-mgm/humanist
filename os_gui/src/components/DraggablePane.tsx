import { useState } from 'react';
import { Rnd } from 'react-rnd';
import { PaneConfig } from './TilingLayout';

interface DraggablePaneProps {
  config: PaneConfig;
  isFocused: boolean;
  onClick: () => void;
  onAttach: (id: string) => void;
}

export function DraggablePane({ config, isFocused, onClick, onAttach }: DraggablePaneProps) {
  const [size, setSize] = useState({ width: 400, height: 500 });
  const [position, setPosition] = useState({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 250 });

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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <span 
              className="pane-detach-btn" 
              style={{ cursor: 'pointer', padding: '0 4px', fontSize: '11px', color: 'var(--text-hint)' }}
              onClick={(e) => {
                e.stopPropagation();
                onAttach(config.id);
              }}
              title="Attach to Layout"
            >
              ↙️
            </span>
          </div>
        </div>
        <div className="pane-body">
          {config.content}
        </div>
      </div>
    </Rnd>
  );
}
