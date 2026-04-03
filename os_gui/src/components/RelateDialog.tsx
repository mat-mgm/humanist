import { memo, useState, useCallback, useMemo } from 'react';
import { useOsStore } from '../store';

interface Props {
  sourceEntityId: string;
  sourceLabel: string;
  onClose: () => void;
}

export const RelateDialog = memo(function RelateDialog({ sourceEntityId, sourceLabel, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [targetLabel, setTargetLabel] = useState('');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const entities = useOsStore(s => s.entities);
  const addEdgeAction = useOsStore(s => s.addEdgeAction);

  const candidates = useMemo(() =>
    entities.filter(e =>
      e.id !== sourceEntityId &&
      e.label.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 12),
    [entities, search, sourceEntityId]
  );

  const handleSelect = useCallback((id: string, label: string) => {
    setTargetId(id);
    setTargetLabel(label);
    setSearch(label);
  }, []);

  const handleRelate = useCallback(async () => {
    if (!targetId) { setError('Select a target entity.'); return; }
    const lbl = edgeLabel.trim();
    if (!lbl) { setError('Edge label is required.'); return; }
    setLoading(true);
    setError('');
    try {
      await addEdgeAction(sourceEntityId, targetId, lbl);
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [targetId, edgeLabel, addEdgeAction, sourceEntityId, onClose]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  const showDropdown = search.length > 0 && !targetId;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '28px 32px', minWidth: 380,
          boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
        }}
        onKeyDown={handleKey}
      >
        <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          New Relationship
        </h3>

        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.06em' }}>From</span>
          <div style={{ marginTop: 6, padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, color: 'var(--text-primary)' }}>
            {sourceLabel}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.06em' }}>Edge Label</span>
          <input
            autoFocus
            type="text"
            value={edgeLabel}
            onChange={e => setEdgeLabel(e.target.value)}
            placeholder="e.g. deployed_on, depends_on, uses…"
            style={{
              display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none',
            }}
          />
        </div>

        <div style={{ marginBottom: 20, position: 'relative' }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.06em' }}>To</span>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setTargetId(''); setTargetLabel(''); }}
            placeholder="Search entities…"
            style={{
              display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none',
            }}
          />
          {showDropdown && candidates.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: '0 0 6px 6px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              maxHeight: 200, overflowY: 'auto',
            }}>
              {candidates.map(e => (
                <div
                  key={e.id}
                  onClick={() => handleSelect(e.id, e.label)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                    color: 'var(--text-primary)', borderBottom: '1px solid var(--border)',
                    display: 'flex', gap: 8, alignItems: 'center',
                  }}
                  onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
                  onMouseLeave={ev => (ev.currentTarget.style.background = '')}
                >
                  <span className={`kind-badge kind-${e.kind}`}>{e.kind}</span>
                  {e.label}
                </div>
              ))}
            </div>
          )}
          {targetId && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-hint)' }}>
              Selected: <span style={{ color: 'var(--accent)' }}>{targetLabel}</span>
              <button
                onClick={() => { setTargetId(''); setTargetLabel(''); setSearch(''); }}
                style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 11 }}
              >
                ✕ clear
              </button>
            </div>
          )}
        </div>

        {error && (
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--error, #ff6b6b)' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              padding: '7px 16px', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleRelate}
            disabled={loading}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: 6,
              padding: '7px 18px', color: '#fff', cursor: loading ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 600, opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Linking…' : 'Create Edge'}
          </button>
        </div>
      </div>
    </div>
  );
});
