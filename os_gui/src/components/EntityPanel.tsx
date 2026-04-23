import { memo, useState, useMemo, useCallback, useRef } from 'react';
import { useOsStore } from '../store';
import { RelateDialog } from './RelateDialog';

// ── Row ───────────────────────────────────────────────────────────────────────
const EntityRow = memo(function EntityRow({ entity, tags, isSelected, isContext, onSelect, onTag, onRelate, onDelete }: {
  entity: any;
  tags: string[];
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
      <td title={entity.id}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span>{entity.label}</span>
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: 'var(--accent)22', color: 'var(--accent)',
                  border: '1px solid var(--accent)44', fontWeight: 600,
                  letterSpacing: '0.03em',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </td>
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
export const EntityPanel = memo(function EntityPanel() {
  const entities        = useOsStore(s => s.allEntities);
  const allTagEdges     = useOsStore(s => s.allTagEdges);
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

  // Build tag index: bare entityId (no "entity:" prefix) → [tagLabel, ...]
  // Backend strips the "entity:" prefix from edge.from / edge.to, so we must
  // add it back when looking up in allEntities (which carry full IDs).
  const tagsByEntityId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of allTagEdges) {
      const tagEntity = entities.find(e => e.id === `entity:${edge.to}`);
      if (!tagEntity) continue;
      const existing = map.get(edge.from) ?? [];
      existing.push(tagEntity.label);
      map.set(edge.from, existing);
    }
    return map;
  }, [allTagEdges, entities]);

  // Collect all unique tag labels for the tag-search dropdown
  const allTagLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const tags of tagsByEntityId.values()) {
      for (const t of tags) labels.add(t);
    }
    return Array.from(labels).sort();
  }, [tagsByEntityId]);

  const contextIds = useMemo(() => contextEntities.map(e => e.id), [contextEntities]);

  // Parse search: "#tagName" filters by tag; otherwise label search
  const tagSearch = search.startsWith('#') ? search.slice(1).toLowerCase() : null;
  const labelSearch = tagSearch === null ? search.toLowerCase() : '';

  const filtered = useMemo(() => {
    if (tagSearch !== null) {
      // Filter entities that have at least one tag matching the search
      if (tagSearch === '') return entities; // just "#" with nothing after
      return entities.filter(e => {
        const tags = tagsByEntityId.get(e.id.replace('entity:', '')) ?? [];
        return tags.some(t => t.toLowerCase().includes(tagSearch));
      });
    }
    return entities.filter(e => e.label.toLowerCase().includes(labelSearch));
  }, [entities, tagsByEntityId, tagSearch, labelSearch]);

  const handleSelect = useCallback((id: string | null) => selectEntity(id), [selectEntity]);

  // Suggest matching tags when typing "#…"
  const tagSuggestions = useMemo(() => {
    if (tagSearch === null || tagSearch === '') return [];
    return allTagLabels.filter(t => t.toLowerCase().includes(tagSearch)).slice(0, 6);
  }, [tagSearch, allTagLabels]);

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)', flexShrink: 0 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entities… or #tag"
            style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--accent)', borderRadius: 4, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 11, height: 28, outline: 'none', boxSizing: 'border-box' }} />
          {tagSuggestions.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', marginTop: 2 }}>
              {tagSuggestions.map(t => (
                <div key={t} onClick={() => setSearch(`#${t}`)}
                  style={{ padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--accent)', display: 'flex', gap: 6, alignItems: 'center', borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-primary)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontWeight: 700 }}>#</span>{t}
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => { setActiveActivity('inputs'); setSidePanelOpen(true); addCreateInputDraft(); }} title="New entity (Ctrl+N)"
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          + New
        </button>
      </div>

      {/* Tag filter hint */}
      {tagSearch !== null && (
        <div style={{ padding: '4px 10px', fontSize: 10, color: 'var(--text-hint)', background: 'var(--accent)11', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          Filtering by tag — <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 10, padding: 0 }}>clear</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 16 }}>
          <p>{tagSearch !== null ? `No entities tagged "${tagSearch}".` : 'No entities found.'}</p>
          {tagSearch === null && <p className="hint">Use Ctrl+N or click [+ New] to create one.</p>}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table className="entity-table">
            <thead><tr><th>Label</th><th>Kind</th><th>Context</th><th></th></tr></thead>
            <tbody>
              {filtered.map(e => (
                <EntityRow key={e.id} entity={e}
                  tags={tagsByEntityId.get(e.id.replace('entity:', '')) ?? []}
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
        </div>
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
