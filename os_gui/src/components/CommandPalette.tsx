import { useEffect, useRef } from 'react';
import { TerminalPanel } from './TerminalPanel';

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
}

export function CommandPalette({ visible, onClose }: CommandPaletteProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      className="command-palette-overlay"
      style={{
        position: 'fixed',
        top: 36,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        // No background overlay, no blur — just the window itself
        pointerEvents: 'none',
      }}
    >
      <div
        ref={containerRef}
        className="command-palette-modal"
        style={{
          width: '50vw',
          maxWidth: 820,
          minWidth: 420,
          height: 280,
          backgroundColor: 'var(--bg-panel)',
          borderRadius: 10,
          boxShadow: '0 8px 40px rgba(0,0,0,0.55)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          pointerEvents: 'all',
        }}
      >
        <div
          className="command-palette-header"
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: 'var(--bg-secondary)',
            fontWeight: 600,
            fontSize: 13,
            color: 'var(--text-primary)',
          }}
        >
          <span style={{ color: 'var(--accent)' }}>&gt;_</span> Command Palette
          <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-hint)' }}>ESC to close</div>
        </div>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <TerminalPanel onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
