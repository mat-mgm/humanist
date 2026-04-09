import React, { useState, useRef, useMemo, useEffect } from 'react';

export interface DropdownOption {
  id: string;
  label: string;
}

interface SearchableDropdownProps {
  value: string;
  onChange: (val: string) => void;
  onSelect?: (opt: DropdownOption) => void;
  options: DropdownOption[];
  placeholder: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * A custom searchable dropdown that follows the app theme and supports keyboard navigation.
 */
export function SearchableDropdown({
  value,
  onChange,
  onSelect,
  options,
  placeholder,
  style = {},
  className = ""
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const low = value.toLowerCase();
    const matches = value && !options.find(o => o.label === value) 
      ? options.filter(o => o.label.toLowerCase().includes(low)) 
      : options;
    return matches.slice(0, 50);
  }, [value, options]);

  // Reset highlight index when filtered list changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (idx: number) => {
    const opt = filtered[idx];
    if (opt) {
      if (onSelect) {
        onSelect(opt);
      } else {
        onChange(opt.label);
      }
      setIsOpen(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown') setIsOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(prev => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(highlightIndex);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`searchable-dropdown ${className}`} style={{ position: 'relative', ...style }}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          color: 'var(--text-primary)',
          width: '100%',
          outline: 'none',
          height: 22
        }}
      />
      {isOpen && filtered.length > 0 && (
        <div className="custom-dropdown-list">
          {filtered.map((opt, idx) => (
            <div
              key={opt.id}
              className="custom-dropdown-item"
              style={{
                background: idx === highlightIndex ? 'var(--accent)' : 'transparent',
                color: idx === highlightIndex ? '#000' : 'var(--text-primary)',
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
              onClick={() => handleSelect(idx)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
