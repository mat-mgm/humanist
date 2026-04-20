import { memo, useState, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { useOsStore } from '../store';

export const OntologyPanel = memo(function OntologyPanel() {
  const fetchRelationshipTypes = useOsStore(s => s.fetchRelationshipTypes);
  const saveRelationshipType = useOsStore(s => s.saveRelationshipType);
  const deleteRelationshipType = useOsStore(s => s.deleteRelationshipType);
  const relationshipTypes = useOsStore(s => s.relationshipTypes);

  useEffect(() => { fetchRelationshipTypes(); }, [fetchRelationshipTypes]);

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

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Relationship Types</span>
      </div>

      {/* Type list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {relationshipTypes.length === 0
          ? <div style={{ padding: 16, fontSize: 11, color: 'var(--text-hint)' }}>No types defined yet.</div>
          : relationshipTypes.map(rt => (
            <div key={rt.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{rt.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                {[rt.transitive && 'transitive', rt.symmetric && 'symmetric', rt.inherits_traits && 'inherits'].filter(Boolean).join(' · ') || 'no flags'}
              </span>
              <button
                onClick={() => deleteRelationshipType(rt.label)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', fontSize: 12, padding: '0 4px' }}
                title="Delete"
              ><X size={11} /></button>
            </div>
          ))
        }
      </div>

      {/* Create form */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
    </div>
  );
});
