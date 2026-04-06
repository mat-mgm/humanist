import { memo, useState, useCallback } from 'react';
import { useOsStore } from '../store';

interface Props {
  onClose: () => void;
}

export const CreateEntityDialog = memo(function CreateEntityDialog({ onClose }: Props) {
  const [kind, setKind] = useState<string>('digital');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const createEntity = useOsStore(s => s.createEntity);
  const selectEntity = useOsStore(s => s.selectEntity);

  const handleCreate = useCallback(async () => {
    const trimmed = label.trim();
    if (!trimmed) { setError('Label is required.'); return; }
    
    setLoading(true);
    setError('');
    try {
      const id = await createEntity(kind, trimmed);
      selectEntity(id);
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, label, createEntity, selectEntity, onClose]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') onClose();
  }, [handleCreate, onClose]);

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
          borderRadius: 10, padding: '28px 32px', minWidth: 340,
          boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
        }}
        onKeyDown={handleKey}
      >
        <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          New Entity
        </h3>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.06em' }}>Kind</span>
          <select
            value={kind}
            onChange={e => setKind(e.target.value)}
            style={{
              display: 'block', width: '100%', marginTop: 6,
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
              fontSize: 13, cursor: 'pointer',
            }}
          >
            <option value="physical">Physical</option>
            <option value="digital">Digital</option>
            <option value="abstract">Abstract</option>
            <option value="agent">Agent</option>
            <option value="blob">Blob</option>
            <option value="temporal">Temporal</option>
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.06em' }}>Label</span>
          <input
            autoFocus
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Entity name…"
            style={{
              display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '7px 10px', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none',
            }}
          />
        </label>

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
            onClick={handleCreate}
            disabled={loading}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: 6,
              padding: '7px 18px', color: '#fff', cursor: loading ? 'wait' : 'pointer',
              fontSize: 13, fontWeight: 600, opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
});
