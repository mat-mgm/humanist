import { memo, useState, useCallback, useEffect } from 'react';
import { Trash2, Eye, EyeOff, Pencil, Check, X } from 'lucide-react';
import { useOsStore } from '../store';
import type { EdgeFlow, EdgeRouting, RelationshipType } from '../models';

const FLOW_OPTIONS: { value: EdgeFlow; label: string }[] = [
  { value: 'none',  label: 'Free'    },
  { value: 'down',  label: '↓ Down'  },
  { value: 'right', label: '→ Right' },
  { value: 'up',    label: '↑ Up'    },
  { value: 'left',  label: '← Left'  },
];

const ROUTING_OPTIONS: { value: EdgeRouting; label: string }[] = [
  { value: 'straight', label: 'Straight' },
  { value: 'step',     label: 'Step (┐)' },
  { value: 'arc',      label: 'Arc (~)'  },
];

const selectStyle: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
  padding: '3px 6px', color: 'var(--text-primary)', fontSize: 11, outline: 'none', flex: 1,
};

const fieldStyle: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
  padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none', width: '100%',
};

function checkRow(label: string, val: boolean, set: (v: boolean) => void) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
      <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} />
      {label}
    </label>
  );
}

// ── Inline edit form rendered as a table row expansion ────────────────────────
function EditRow({ rt, onSave, onCancel }: {
  rt: RelationshipType;
  onSave: (patch: Omit<RelationshipType, 'id'> & { id: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [label,      setLabel]      = useState(rt.label);
  const [transitive, setTransitive] = useState(rt.transitive);
  const [symmetric,  setSymmetric]  = useState(rt.symmetric);
  const [inherits,   setInherits]   = useState(rt.inherits_traits);
  const [visible,    setVisible]    = useState(rt.visible !== false);
  const [flow,       setFlow]       = useState<EdgeFlow>(rt.flow ?? 'none');
  const [routing,    setRouting]    = useState<EdgeRouting>(rt.routing ?? 'straight');
  const [color,      setColor]      = useState(rt.color ?? '');
  const [saving,     setSaving]     = useState(false);

  const save = useCallback(async () => {
    const lbl = label.trim();
    if (!lbl) return;
    setSaving(true);
    try {
      await onSave({
        id: rt.id,
        label: lbl,
        transitive,
        symmetric,
        inherits_traits: inherits,
        visible,
        flow: flow === 'none' ? null : flow,
        routing: routing === 'straight' ? null : routing,
        color: color.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  }, [label, transitive, symmetric, inherits, visible, flow, routing, color, rt.id, onSave]);

  return (
    <tr style={{ background: 'var(--bg-primary)' }}>
      <td colSpan={4} style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <input
            autoFocus
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
            style={fieldStyle}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={flow} onChange={e => setFlow(e.target.value as EdgeFlow)} style={selectStyle} title="Flow direction">
              {FLOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={routing} onChange={e => setRouting(e.target.value as EdgeRouting)} style={selectStyle} title="Edge routing">
              {ROUTING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="color"
              value={color || '#8b91a8'}
              onChange={e => setColor(e.target.value)}
              title="Edge color"
              style={{ width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', padding: 2, flexShrink: 0 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {checkRow('Transitive',    transitive, setTransitive)}
            {checkRow('Symmetric',     symmetric,  setSymmetric)}
            {checkRow('Inherits traits', inherits, setInherits)}
            {checkRow('Visible',       visible,    setVisible)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '4px 12px', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Check size={11} /> Save
            </button>
            <button
              onClick={onCancel}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 10px', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <X size={11} /> Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export const RelationPanel = memo(function RelationPanel() {
  const fetchRelationshipTypes = useOsStore(s => s.fetchRelationshipTypes);
  const saveRelationshipType   = useOsStore(s => s.saveRelationshipType);
  const deleteRelationshipType = useOsStore(s => s.deleteRelationshipType);
  const relationshipTypes      = useOsStore(s => s.relationshipTypes);

  useEffect(() => { fetchRelationshipTypes(); }, [fetchRelationshipTypes]);

  const [search,        setSearch]        = useState('');
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [newLabel,      setNewLabel]      = useState('');
  const [newTransitive, setNewTransitive] = useState(false);
  const [newSymmetric,  setNewSymmetric]  = useState(false);
  const [newInherits,   setNewInherits]   = useState(false);
  const [newVisible,    setNewVisible]    = useState(true);
  const [newFlow,       setNewFlow]       = useState<EdgeFlow>('none');
  const [newRouting,    setNewRouting]    = useState<EdgeRouting>('straight');
  const [newColor,      setNewColor]      = useState('');
  const [error,         setError]         = useState('');

  const submit = useCallback(async () => {
    const lbl = newLabel.trim();
    if (!lbl) { setError('Label is required'); return; }
    setError('');
    try {
      await saveRelationshipType({
        label: lbl,
        transitive: newTransitive,
        symmetric: newSymmetric,
        inherits_traits: newInherits,
        visible: newVisible,
        flow: newFlow === 'none' ? null : newFlow,
        routing: newRouting === 'straight' ? null : newRouting,
        color: newColor.trim() || null,
      });
      setNewLabel(''); setNewTransitive(false); setNewSymmetric(false);
      setNewInherits(false); setNewVisible(true);
      setNewFlow('none'); setNewRouting('straight'); setNewColor('');
    } catch (e: any) { setError(String(e)); }
  }, [newLabel, newTransitive, newSymmetric, newInherits, newVisible, newFlow, newRouting, newColor, saveRelationshipType]);

  const handleSaveEdit = useCallback(async (patch: Omit<RelationshipType, 'id'> & { id: string }) => {
    await saveRelationshipType(patch);
    setEditingId(null);
  }, [saveRelationshipType]);

  const filtered = relationshipTypes.filter(rt =>
    rt.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search bar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)', flexShrink: 0 }}>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search relationships…"
          style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--accent)', borderRadius: 4, padding: '5px 10px', color: 'var(--text-primary)', fontSize: 11, height: 28, outline: 'none' }}
        />
      </div>

      {/* Create form */}
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>New Type</span>
        <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)}
          placeholder="e.g. depends_on" style={fieldStyle}
          onKeyDown={e => e.key === 'Enter' && submit()} />
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={newFlow} onChange={e => setNewFlow(e.target.value as EdgeFlow)} style={selectStyle} title="Flow direction">
            {FLOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={newRouting} onChange={e => setNewRouting(e.target.value as EdgeRouting)} style={selectStyle} title="Edge routing">
            {ROUTING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input type="color" value={newColor || '#8b91a8'} onChange={e => setNewColor(e.target.value)}
            title="Edge color"
            style={{ width: 28, height: 28, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', cursor: 'pointer', padding: 2, flexShrink: 0 }} />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {checkRow('Transitive',      newTransitive, setNewTransitive)}
          {checkRow('Symmetric',       newSymmetric,  setNewSymmetric)}
          {checkRow('Inherits traits', newInherits,   setNewInherits)}
          {checkRow('Visible',         newVisible,    setNewVisible)}
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
              <tr><th>Label</th><th>Style</th><th>Flags</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(rt => {
                if (editingId === rt.id) {
                  return (
                    <EditRow
                      key={rt.id}
                      rt={rt}
                      onSave={handleSaveEdit}
                      onCancel={() => setEditingId(null)}
                    />
                  );
                }
                return (
                  <tr
                    key={rt.id}
                    style={{ opacity: rt.visible === false ? 0.5 : 1, cursor: 'default' }}
                  >
                    <td style={{ fontWeight: 600 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {rt.color && (
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: rt.color, flexShrink: 0, display: 'inline-block' }} />
                        )}
                        {rt.label}
                      </span>
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                      {[
                        rt.flow && rt.flow !== 'none' ? rt.flow : null,
                        rt.routing && rt.routing !== 'straight' ? rt.routing : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-hint)' }}>
                      {[rt.transitive && 'trans', rt.symmetric && 'sym', rt.inherits_traits && 'inh'].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <button
                        onClick={() => setEditingId(rt.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', padding: '0 3px', display: 'flex', alignItems: 'center' }}
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => saveRelationshipType({ ...rt, visible: !(rt.visible !== false) })}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: rt.visible !== false ? 'var(--text-hint)' : 'var(--accent)', padding: '0 3px', display: 'flex', alignItems: 'center' }}
                        title={rt.visible !== false ? 'Hide' : 'Show'}
                      >
                        {rt.visible !== false ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                      <button
                        onClick={() => deleteRelationshipType(rt.label)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', padding: '0 3px', display: 'flex', alignItems: 'center' }}
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
