import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ThemedSelectOption {
  value: string;
  label: string;
  hint?: ReactNode;
}

interface ThemedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
  size?: 'sm' | 'md';
}

// Minimal click-to-open dropdown. Behaves like a native <select> (click to
// open, click an option to choose, Escape / outside-click to close) but every
// pixel honors CSS variables, so it matches the active theme on platforms
// where the OS renders the native <select> popup unstyled.
export function ThemedSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  width = '100%',
  size = 'md',
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);
  const padY = size === 'sm' ? 3 : 5;
  const fontSize = size === 'sm' ? 11 : 12;

  const triggerStyle: CSSProperties = {
    width,
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: `${padY}px 28px ${padY}px 10px`,
    fontSize,
    cursor: disabled ? 'not-allowed' : 'pointer',
    outline: 'none',
    textAlign: 'left',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    minHeight: size === 'sm' ? 24 : 28,
    opacity: disabled ? 0.6 : 1,
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width }}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        style={triggerStyle}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown size={12} color="var(--text-hint)" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: 2,
          maxHeight: 280,
          overflowY: 'auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          zIndex: 400,
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        }}>
          {options.map(opt => {
            const active = opt.value === value;
            return (
              <div
                key={opt.value}
                onMouseDown={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  padding: '6px 10px',
                  fontSize,
                  cursor: 'pointer',
                  color: active ? 'var(--accent)' : 'var(--text-primary)',
                  background: active ? 'var(--bg-primary)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-primary)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = active ? 'var(--bg-primary)' : 'transparent')}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.label}
                </span>
                {opt.hint && <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{opt.hint}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
