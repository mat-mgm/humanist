import { memo, useState, useMemo, useCallback, useRef } from 'react';
import { useOsStore } from '../store';
import { RelateDialog } from './RelateDialog';

// ── Row ───────────────────────────────────────────────────────────────────────
const EntityRow = memo(function EntityRow({ entity, isSelected, isContext, onSelect, onTag, onRelate, onDelete }: {
  entity: any;
  isSelected: boolean;
  isContext: boolean;
  onSelect: (id: string | null) => void;
  onTag: (id: string, label: string) => void;
  onRelate: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  return (
    <tr
      onClick={() => onSelect(isSelected ? null : entity.id)}
      onContextMenu={e => { e.preventDefault(); setMenu(m => !m); }}
      style={{ cursor: 'pointer', position: 'relative' }}
      className={isSelected ? 'row-selected' : isContext ? 'row-context' : ''}
    >
      <td title={entity.id}>{entity.label}</td>
      <td><span className={`kind-badge kind-${entity.category}`}>{entity.category}</span></td>
      <td>{isSelected ? '◉' : isContext ? '◎' : ''}</td>
      <td style={{ position: 'relative' }}>
        {menu && (
          <div ref={menuRef}
            style={{ position: 'absolute', right: 0, top: 0, zIndex: 100, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 7, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', minWidth: 130, padding: '4px 0' }}
            onMouseLeave={() => setMenu(false)}>
            {[
              { label: 'Inspect',  action: () => { onSelect(entity.id); setMenu(false); } },
              { label: 'Relate…',  action: () => { onRelate(entity.id, entity.label); setMenu(false); } },
              { label: 'Tag…',     action: () => { onTag(entity.id, entity.label); setMenu(false); } },
              { label: 'Delete',   action: () => { onDelete(entity.id); setMenu(false); }, danger: true },
            ].map(item => (
              <div key={item.label} onClick={e => { e.stopPropagation(); item.action(); }}
                style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: (item as any).danger ? '#ff6b6b' : 'var(--text-primary)' }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                {item.label}
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
});

// ── Panel ─────────────────────────────────────────────────────────────────────
export const EntityRegistry = memo(function EntityRegistry() {
  const entities        = useOsStore(s => s.entities);
  const selectedEntityId = useOsStore(s => s.selectedEntityId);
  const contextEntities = useOsStore(s => s.contextEntities);
  const selectEntity = useOsStore(s => s.selectEntity);
  const deleteEntity = useOsStore(s => s.deleteEntity);
  const tagEntity = useOsStore(s => s.tagEntity);
  const setActiveActivity = useOsStore(s => s.setActiveActivity);
  const setSidePanelOpen = useOsStore(s => s.setSidePanelOpen);
  const addCreateInputDraft = useOsStore(s => s.addCreateInputDraft);

  const [search, setSearch]             = useState('');
  const [quickTagId, setQuickTagId]     = useState<string | null>(null);
  const [quickTagLabel, setQuickTagLabel] = useState('');
  const [quickTagInput, setQuickTagInput] = useState('');
  const [showRelateFor, setShowRelateFor] = useState<{ id: string; label: string } | null>(null);

  const contextIds = useMemo(() => contextEntities.map(e => e.id), [contextEntities]);
  const filtered   = useMemo(() => entities.filter(e => e.label.toLowerCase().includes(search.toLowerCase())), [entities, search]);
  const handleSelect = useCallback((id: string | null) => selectEntity(id), [selectEntity]);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)', flexShrink: 0 }}>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entities…"
          style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 9px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
        <button onClick={() => { setActiveActivity('inputs'); setSidePanelOpen(true); addCreateInputDraft(); }} title="New entity (Ctrl+N)"
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
          + New
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 16 }}>
          <p>No entities found.</p>
          <p className="hint">Use Ctrl+N or click [+ New] to create one.</p>
        </div>
      ) : (
        <table className="entity-table" style={{ flex: 1 }}>
          <thead><tr><th>Label</th><th>Kind</th><th>Context</th><th></th></tr></thead>
          <tbody>
            {filtered.map(e => (
              <EntityRow key={e.id} entity={e}
                isSelected={e.id === selectedEntityId}
                isContext={contextIds.includes(e.id)}
                onSelect={handleSelect}
                onTag={(id, label) => { setQuickTagId(id); setQuickTagLabel(label); setQuickTagInput(''); }}
                onRelate={(id, label) => setShowRelateFor({ id, label })}
                onDelete={id => deleteEntity(id)}
              />
            ))}
          </tbody>
        </table>
      )}
      {showRelateFor && (
        <RelateDialog sourceEntityId={showRelateFor.id} sourceLabel={showRelateFor.label} onClose={() => setShowRelateFor(null)} />
      )}

      {quickTagId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setQuickTagId(null); }}>
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 9, padding: '20px 24px', minWidth: 300, boxShadow: '0 6px 32px rgba(0,0,0,0.5)' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>
              Add tag to <strong>{quickTagLabel}</strong>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input autoFocus type="text" value={quickTagInput} onChange={e => setQuickTagInput(e.target.value)}
                onKeyDown={async ev => {
                  if (ev.key === 'Enter') { await tagEntity(quickTagId!, quickTagInput.trim()); setQuickTagId(null); }
                  if (ev.key === 'Escape') setQuickTagId(null);
                }}
                placeholder="Tag name…"
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
              <button onClick={async () => { await tagEntity(quickTagId!, quickTagInput.trim()); setQuickTagId(null); }}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Tag</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
