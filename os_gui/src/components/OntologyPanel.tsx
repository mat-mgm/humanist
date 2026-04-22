import { memo, useState, useCallback, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { useOsStore } from '../store';

export const RelationshipsPanel = memo(function RelationshipsPanel() {
  const fetchRelationshipTypes = useOsStore(s => s.fetchRelationshipTypes);
  const saveRelationshipType = useOsStore(s => s.saveRelationshipType);
  const deleteRelationshipType = useOsStore(s => s.deleteRelationshipType);
  const relationshipTypes = useOsStore(s => s.relationshipTypes);

  useEffect(() => { fetchRelationshipTypes(); }, [fetchRelationshipTypes]);

  const [search, setSearch] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTransitive, setNewTransitive] = useState(false);
  const [newSymmetric, setNewSymmetric] = useState(false);
  const [newInherits, setNewInherits] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    const lbl = newLabel.trim();
    if (!lbl) { setError('Label is required'); return; }
    setError('');
    try {
      await saveRelationshipType({ label: lbl, transitive: newTransitive, symmetric: newSymmetric, inherits_traits: newInherits });
      setNewLabel(''); setNewTransitive(false); setNewSymmetric(false); setNewInherits(false);
    } catch (e: any) { setError(String(e)); }
  }, [newLabel, newTransitive, newSymmetric, newInherits, saveRelationshipType]);

  const fieldStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none', width: '100%',
  };
  const checkRow = (label: string, val: boolean, set: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
      <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} />
      {label}
    </label>
  );

  const filtered = relationshipTypes.filter(rt =>
    rt.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search bar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)', flexShrink: 0 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search relationships…"
          style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 9px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
        />
      </div>

      {/* Create form */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>New Type</span>
        <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. is_hosted_on" style={fieldStyle}
          onKeyDown={e => e.key === 'Enter' && submit()} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {checkRow('Transitive', newTransitive, setNewTransitive)}
          {checkRow('Symmetric', newSymmetric, setNewSymmetric)}
          {checkRow('Inherits traits', newInherits, setNewInherits)}
        </div>
        {error && <span style={{ fontSize: 11, color: '#ff6b6b' }}>{error}</span>}
        <button onClick={submit} style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
          + Add
        </button>
      </div>

      {/* Type list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 16, fontSize: 11, color: 'var(--text-hint)' }}>
            {relationshipTypes.length === 0 ? 'No types defined yet.' : 'No matches.'}
          </div>
        ) : (
          <table className="entity-table">
            <thead>
              <tr><th>Label</th><th>Flags</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(rt => (
                <tr key={rt.id}>
                  <td style={{ fontWeight: 600 }}>{rt.label}</td>
                  <td style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                    {[rt.transitive && 'transitive', rt.symmetric && 'symmetric', rt.inherits_traits && 'inherits'].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>
                    <button
                      onClick={() => deleteRelationshipType(rt.label)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', padding: '0 4px', display: 'flex', alignItems: 'center' }}
                      title="Delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
