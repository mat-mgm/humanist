import { memo, useMemo, useState, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useOsStore } from '../store';
import { SpatialTrait, TemporalTrait } from '../models';
import { SearchableDropdown } from './SearchableDropdown';
import { ThreeViewer } from './ThreeViewer';
import { RelateDialog } from './RelateDialog';
import { CreateEntityDialog } from './CreateEntityDialog';

// ── Atomic selectors ──────────────────────────────────────────────────────────
const selectSelectedId = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityId;
const selectSelectedIds = (s: ReturnType<typeof useOsStore.getState>) => s.selectedIds;
const selectEntities = (s: ReturnType<typeof useOsStore.getState>) => s.entities;
const selectSelectEntity = (s: ReturnType<typeof useOsStore.getState>) => s.selectEntity;
const selectContextEntities = (s: ReturnType<typeof useOsStore.getState>) => s.contextEntities;
const selectBlobTraits = (s: ReturnType<typeof useOsStore.getState>) => s.blobTraits;
const selectSpatialTraits = (s: ReturnType<typeof useOsStore.getState>) => s.spatialTraits;
const selectTemporalTraits = (s: ReturnType<typeof useOsStore.getState>) => s.temporalTraits;
const selectEdges = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityEdges;

// ── Tag chip ──────────────────────────────────────────────────────────────────
const TagChip = memo(function TagChip({
  label, onRemove,
}: { label: string; onRemove: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: 'var(--tag-bg, rgba(100,120,255,0.15))',
      border: '1px solid var(--tag-border, rgba(100,120,255,0.35))',
      color: 'var(--accent)', borderRadius: 999, padding: '2px 9px',
      fontSize: 11, fontWeight: 600,
    }}>
      {label}
      <button
        onClick={onRemove}
        title="Remove tag"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11, padding: '0 0 0 2px', lineHeight: 1 }}
      >✕</button>
    </span>
  );
});

// ── Selection Panel (multi-select) ────────────────────────────────────────────
const SelectionPanel = memo(function SelectionPanel() {
  const selectedIds = useOsStore(selectSelectedIds);
  const entities = useOsStore(selectEntities);
  const { tagEntities, addEdgeAction, deleteEntities } = useOsStore();

  const [tagInput, setTagInput] = useState('');
  const [relLabel, setRelLabel] = useState('');
  const [relError, setRelError] = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectedEntities = useMemo(
    () => entities.filter(e => selectedIds.includes(e.id)),
    [entities, selectedIds]
  );

  const isTwoSelected = selectedIds.length === 2;
  const [nodeA, nodeB] = selectedEntities;

  const handleBulkTag = async () => {
    const t = tagInput.trim();
    if (!t || selectedIds.length === 0) return;
    await tagEntities(selectedIds, t);
    setTagInput('');
  };

  const handleCreateEdge = async () => {
    const label = relLabel.trim();
    if (!label || !isTwoSelected) return;
    setRelError('');
    try {
      await addEdgeAction(nodeA.id, nodeB.id, label);
      setRelLabel('');
    } catch (e: any) {
      setRelError(String(e));
    }
  };

  const doDelete = async () => {
    await deleteEntities(selectedIds);
    setConfirmDelete(false);
  };

  if (selectedIds.length < 2) return null;

  return (
    <div className="properties-view" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
          {selectedIds.length} entities selected
        </span>
        <div style={{ marginLeft: 'auto' }}>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete selected entities"
              style={{ background: 'none', border: '1px solid #ff6b6b', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#ff6b6b', fontSize: 11, fontWeight: 700 }}
            >
              🗑 Delete All
            </button>
          ) : (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#ff6b6b' }}>Sure?</span>
              <button onClick={doDelete} style={{ background: '#ff6b6b', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Yes</button>
              <button onClick={() => setConfirmDelete(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>No</button>
            </span>
          )}
        </div>
      </div>

      {/* Selected entities list */}
      <div style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Selection</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {selectedEntities.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span className={`kind-badge kind-${e.kind}`}>{e.kind}</span>
            <span style={{ color: 'var(--text-primary)', flex: 1 }}>{e.label}</span>
          </div>
        ))}
      </div>

      {/* Bulk Tag */}
      <div style={{ margin: '8px 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Tag All</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <SearchableDropdown
          value={tagInput}
          onChange={setTagInput}
          onSelect={(opt) => {
            setTagInput('');
            tagEntities(selectedIds, opt.label);
          }}
          options={entities.filter((e: any) => e.kind === 'abstract').map((e: any) => ({ id: e.id, label: e.label }))}
          placeholder="Tag name…"
          style={{ flex: 1 }}
        />
        <button
          onClick={handleBulkTag}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >Tag</button>
      </div>

      {/* Relate (only when exactly 2 nodes selected) */}
      {isTwoSelected && (
        <>
          <div style={{ margin: '16px 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Create Relationship</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginBottom: 8, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{nodeA?.label}</span>
            {' → '}label{' → '}
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{nodeB?.label}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={relLabel}
              onChange={ev => setRelLabel(ev.target.value)}
              onKeyDown={ev => ev.key === 'Enter' && handleCreateEdge()}
              placeholder="Relationship label…"
              style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 9px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }}
            />
            <button
              onClick={handleCreateEdge}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            >Relate</button>
          </div>
          {relError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '4px 0 0' }}>{relError}</p>}
        </>
      )}
    </div>
  );
});

// ── Entity Inspector ──────────────────────────────────────────────────────────
const EntityInspector = memo(function EntityInspector() {
  const selectedId = useOsStore(selectSelectedId);
  const entities = useOsStore(selectEntities);
  const edges = useOsStore(selectEdges);
  const spatialTraits = useOsStore(selectSpatialTraits);
  const temporalTraits = useOsStore(selectTemporalTraits);
  const selectEntity = useOsStore(selectSelectEntity);
  const { updateMetadata, deleteEntity, tagEntity, untagEntity, removeEdge, saveTemporalTrait, saveSpatialTrait } = useOsStore();

  const selected = useMemo(
    () => entities.find(e => e.id === selectedId) ?? null,
    [entities, selectedId],
  );

  // Derive tag edges (outgoing tagged_as) and other edges
  const tagEdges = useMemo(() => edges.filter(e => e.label === 'tagged_as' && `entity:${e.from}` === selectedId), [edges, selectedId]);
  const otherEdges = useMemo(() => edges.filter(e => e.label !== 'tagged_as'), [edges]);

  const temporalTrait = useMemo(() => {
    if (!selectedId) return undefined;
    return temporalTraits.find(t =>
      t.owner === selectedId ||
      t.owner === selectedId.replace('entity:', '') ||
      `entity:${t.owner}` === selectedId
    );
  }, [temporalTraits, selectedId]);

  const spatialTrait = useMemo(() => {
    if (!selectedId) return undefined;
    return spatialTraits.find(t =>
      t.owner === selectedId ||
      t.owner === selectedId.replace('entity:', '') ||
      `entity:${t.owner}` === selectedId
    );
  }, [spatialTraits, selectedId]);

  // Find the label for a short id
  const labelFor = useCallback((shortId: string) => {
    const found = entities.find(e => e.id === `entity:${shortId}` || e.id === shortId);
    return found?.label ?? shortId;
  }, [entities]);

  // Metadata editing
  const [editMeta, setEditMeta] = useState<Record<string, string> | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [metaError, setMetaError] = useState('');

  const startEditMeta = useCallback(() => {
    if (!selected) return;
    setEditMeta(Object.fromEntries(
      Object.entries(selected.metadata ?? {}).map(([k, v]) => [k, JSON.stringify(v)])
    ));
    setMetaError('');
  }, [selected]);

  const saveMeta = useCallback(async () => {
    if (!selected || !editMeta) return;
    try {
      const parsed = Object.fromEntries(
        Object.entries(editMeta).map(([k, v]) => {
          try { return [k, JSON.parse(v)]; } catch { return [k, v]; }
        })
      );
      await updateMetadata(selected.id, parsed);
      setEditMeta(null);
    } catch (e: any) {
      setMetaError(String(e));
    }
  }, [selected, editMeta, updateMetadata]);

  const addMetaRow = useCallback(() => {
    if (!newKey.trim()) return;
    setEditMeta(prev => ({ ...(prev ?? {}), [newKey.trim()]: newVal }));
    setNewKey(''); setNewVal('');
  }, [newKey, newVal]);

  // Tag input
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState('');
  const addTag = useCallback(async () => {
    const t = tagInput.trim();
    if (!t || !selected) return;
    setTagError('');
    try {
      await tagEntity(selected.id, t);
      setTagInput('');
    } catch (e: any) {
      setTagError(String(e));
    }
  }, [tagInput, selected, tagEntity]);

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const doDelete = useCallback(async () => {
    if (!selected) return;
    await deleteEntity(selected.id);
    setConfirmDelete(false);
  }, [selected, deleteEntity]);

  // Relate dialog
  const [showRelate, setShowRelate] = useState(false);

  // Temporal Editing
  const [editTemporal, setEditTemporal] = useState<Omit<TemporalTrait, "id"> | null>(null);
  const [tempError, setTempError] = useState('');

  const startEditTemporal = useCallback(() => {
    if (!selected) return;
    setEditTemporal({
      owner: selected.id,
      event_at: temporalTrait?.event_at ?? null,
      starts_at: temporalTrait?.starts_at ?? null,
      ends_at: temporalTrait?.ends_at ?? null,
      recurrence: temporalTrait?.recurrence ?? null,
    });
    setTempError('');
  }, [selected, temporalTrait]);

  const saveTemp = useCallback(async () => {
    if (!editTemporal) return;
    try {
      await saveTemporalTrait(editTemporal);
      setEditTemporal(null);
    } catch (e: any) {
      setTempError(String(e));
    }
  }, [editTemporal, saveTemporalTrait]);

  // Spatial Editing
  const [editSpatial, setEditSpatial] = useState<Omit<SpatialTrait, "id"> | null>(null);
  const [spatialError, setSpatialError] = useState('');

  const startEditSpatial = useCallback(() => {
    if (!selected) return;
    setEditSpatial({
      owner: selected.id,
      lat: spatialTrait?.lat ?? 0,
      lng: spatialTrait?.lng ?? 0,
      alt: spatialTrait?.alt ?? 0,
      heading: spatialTrait?.heading ?? 0,
      bbox: spatialTrait?.bbox ?? null,
      projection: spatialTrait?.projection ?? 'EPSG:4326',
    });
    setSpatialError('');
  }, [selected, spatialTrait]);

  const saveSpatial = useCallback(async () => {
    if (!editSpatial) return;
    try {
      await saveSpatialTrait(editSpatial);
      setEditSpatial(null);
    } catch (e: any) {
      setSpatialError(String(e));
    }
  }, [editSpatial, saveSpatialTrait]);

  if (!selected) {
    return (
      <div className="panel-placeholder">
        <div className="placeholder-icon">📐</div>
        <p>Click an entity to inspect it</p>
      </div>
    );
  }

  const shortId = selected.id.replace('entity:', '');

  return (
    <div className="properties-view" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className={`kind-badge kind-${selected.kind}`}>{selected.kind}</span>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{selected.label}</span>
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete entity"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}
          >
            🗑 Delete
          </button>
        ) : (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#ff6b6b' }}>Sure?</span>
            <button onClick={doDelete} style={{ background: '#ff6b6b', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Yes</button>
            <button onClick={() => setConfirmDelete(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>No</button>
          </span>
        )}
      </div>

      <div className="prop-row">
        <span className="prop-key">ID</span>
        <span className="prop-val mono" style={{ fontSize: 10, wordBreak: 'break-all' }}>{selected.id}</span>
      </div>

      {/* ── Tags ─────────────────────────────────────────────────────────── */}
      <div style={{ margin: '12px 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Tags</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 24 }}>
        {tagEdges.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No tags</span>}
        {tagEdges.map(e => {
          const tLabel = labelFor(e.to);
          return (
            <TagChip
              key={e.to}
              label={tLabel}
              onRemove={() => untagEntity(selected.id, tLabel)}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <SearchableDropdown
          value={tagInput}
          onChange={setTagInput}
          onSelect={async (opt) => {
            setTagInput('');
            try {
              await tagEntity(selected.id, opt.label);
            } catch (e: any) {
              setTagError(String(e));
            }
          }}
          options={entities.filter((e: any) => e.kind === 'abstract').map((e: any) => ({ id: e.id, label: e.label }))}
          placeholder="Add tag…"
          style={{ flex: 1 }}
        />
        <button
          onClick={addTag}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          +
        </button>
      </div>
      {tagError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '4px 0 0' }}>{tagError}</p>}

      {/* ── Metadata ─────────────────────────────────────────────────────── */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Metadata</span>
        {editMeta == null
          ? <button onClick={startEditMeta} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>✏ Edit</button>
          : <span style={{ display: 'flex', gap: 6 }}>
            <button onClick={saveMeta} style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Save</button>
            <button onClick={() => { setEditMeta(null); setMetaError(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>Cancel</button>
          </span>
        }
      </div>

      {editMeta == null ? (
        <>
          {Object.keys(selected.metadata ?? {}).length === 0
            ? <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No metadata</span>
            : Object.entries(selected.metadata ?? {}).map(([k, v]) => (
              <div className="prop-row" key={k}>
                <span className="prop-key">{k}</span>
                <span className="prop-val mono">{JSON.stringify(v)}</span>
              </div>
            ))
          }
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(editMeta).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                value={k}
                readOnly
                style={{ width: 100, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-hint)', fontSize: 11 }}
              />
              <input
                value={v}
                onChange={ev => setEditMeta(prev => ({ ...prev!, [k]: ev.target.value }))}
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
              />
              <button
                onClick={() => setEditMeta(prev => { const n = { ...prev! }; delete n[k]; return n; })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', fontSize: 13 }}
              >✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
            <input value={newKey} onChange={ev => setNewKey(ev.target.value)} placeholder="key" style={{ width: 100, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
            <input value={newVal} onChange={ev => setNewVal(ev.target.value)} placeholder="value" style={{ flex: 1, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
            <button onClick={addMetaRow} style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', color: '#fff', fontSize: 11 }}>+</button>
          </div>
          {metaError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '2px 0 0' }}>{metaError}</p>}
        </div>
      )}

      {/* ── Temporal ────────────────────────────────────────────────────── */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Temporal</span>
        {editTemporal == null
          ? <button onClick={startEditTemporal} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>✏ {temporalTrait ? 'Edit' : 'Add'}</button>
          : <span style={{ display: 'flex', gap: 6 }}>
            <button onClick={saveTemp} style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Save</button>
            <button onClick={() => { setEditTemporal(null); setTempError(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>Cancel</button>
          </span>
        }
      </div>

      {editTemporal == null ? (
        <div style={{ fontSize: 11, color: 'var(--text-hint)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!temporalTrait ? (
             <span>No temporal data</span>
          ) : (
            <>
              {temporalTrait.event_at && <div className="prop-row"><span className="prop-key">At</span><span className="prop-val mono">{temporalTrait.event_at}</span></div>}
              {temporalTrait.starts_at && <div className="prop-row"><span className="prop-key">Start</span><span className="prop-val mono">{temporalTrait.starts_at}</span></div>}
              {temporalTrait.ends_at && <div className="prop-row"><span className="prop-key">End</span><span className="prop-val mono">{temporalTrait.ends_at}</span></div>}
              {temporalTrait.recurrence && <div className="prop-row"><span className="prop-key">Recurrence</span><span className="prop-val mono">{temporalTrait.recurrence}</span></div>}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>EVENT AT</span>
            <input 
              type="text" 
              value={editTemporal.event_at ?? ''} 
              placeholder="e.g. 1789-07-14 or -3300-01-01"
              onChange={e => setEditTemporal(prev => ({ ...prev!, event_at: e.target.value || null }))}
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>STARTS AT</span>
              <input 
                type="text" 
                value={editTemporal.starts_at ?? ''} 
                placeholder="Start date"
                onChange={e => setEditTemporal(prev => ({ ...prev!, starts_at: e.target.value || null }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>ENDS AT</span>
              <input 
                type="text" 
                value={editTemporal.ends_at ?? ''} 
                placeholder="End date"
                onChange={e => setEditTemporal(prev => ({ ...prev!, ends_at: e.target.value || null }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
              />
            </label>
          </div>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>RECURRENCE (RRULE)</span>
            <input 
              type="text" 
              value={editTemporal.recurrence ?? ''} 
              onChange={e => setEditTemporal(prev => ({ ...prev!, recurrence: e.target.value || null }))}
              placeholder="e.g. FREQ=YEARLY"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
            />
          </label>
          {tempError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '2px 0 0' }}>{tempError}</p>}
        </div>
      )}

      {/* ── Spatial ────────────────────────────────────────────────────── */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Spatial</span>
        {editSpatial == null
          ? <button onClick={startEditSpatial} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>✏ {spatialTrait ? 'Edit' : 'Add'}</button>
          : <span style={{ display: 'flex', gap: 6 }}>
            <button onClick={saveSpatial} style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Save</button>
            <button onClick={() => { setEditSpatial(null); setSpatialError(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>Cancel</button>
          </span>
        }
      </div>

      {editSpatial == null ? (
        <div style={{ fontSize: 11, color: 'var(--text-hint)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!spatialTrait ? (
             <span>No spatial data</span>
          ) : (
            <>
              <div className="prop-row"><span className="prop-key">Lat</span><span className="prop-val mono">{spatialTrait.lat}</span></div>
              <div className="prop-row"><span className="prop-key">Lng</span><span className="prop-val mono">{spatialTrait.lng}</span></div>
              <div className="prop-row"><span className="prop-key">Alt</span><span className="prop-val mono">{spatialTrait.alt}</span></div>
              <div className="prop-row"><span className="prop-key">Heading</span><span className="prop-val mono">{spatialTrait.heading}°</span></div>
              {spatialTrait.bbox && (
                <div className="prop-row"><span className="prop-key">BBox</span><span className="prop-val mono">[{spatialTrait.bbox.join(', ')}]</span></div>
              )}
              {spatialTrait.projection && (
                <div className="prop-row"><span className="prop-key">Proj</span><span className="prop-val mono">{spatialTrait.projection}</span></div>
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>LATITUDE</span>
              <input 
                type="number" step="any"
                value={editSpatial.lat} 
                onChange={e => setEditSpatial(prev => ({ ...prev!, lat: parseFloat(e.target.value) || 0 }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>LONGITUDE</span>
              <input 
                type="number" step="any"
                value={editSpatial.lng} 
                onChange={e => setEditSpatial(prev => ({ ...prev!, lng: parseFloat(e.target.value) || 0 }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>ALTITUDE</span>
              <input 
                type="number" step="any"
                value={editSpatial.alt} 
                onChange={e => setEditSpatial(prev => ({ ...prev!, alt: parseFloat(e.target.value) || 0 }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>HEADING</span>
              <input 
                type="number" step="any"
                value={editSpatial.heading} 
                onChange={e => setEditSpatial(prev => ({ ...prev!, heading: parseFloat(e.target.value) || 0 }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
              />
            </label>
          </div>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>BOUNDING BOX [W, S, E, N] (Optional)</span>
            <input 
              type="text" 
              value={editSpatial.bbox ? editSpatial.bbox.join(', ') : ''} 
              onChange={e => {
                const str = e.target.value.trim();
                if (!str) {
                  setEditSpatial(prev => ({ ...prev!, bbox: null }));
                  return;
                }
                const parts = str.split(',').map(s => parseFloat(s.trim()));
                if (parts.length === 4 && parts.every(p => !isNaN(p))) {
                  setEditSpatial(prev => ({ ...prev!, bbox: parts }));
                } else {
                  // Keep whatever is there to not break typing, but it won't be a valid bbox until format matches
                }
              }}
              placeholder="e.g. -122.5, 37.7, -122.4, 37.8"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
            />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>PROJECTION</span>
            <input 
              type="text" 
              value={editSpatial.projection} 
              onChange={e => setEditSpatial(prev => ({ ...prev!, projection: e.target.value }))}
              placeholder="e.g. EPSG:4326"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
            />
          </label>
          {spatialError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '2px 0 0' }}>{spatialError}</p>}
        </div>
      )}

      {/* ── Relationships ──────────────────────────────────────────────── */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Relationships</span>
        <button
          onClick={() => setShowRelate(true)}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}
        >
          + Relate
        </button>
      </div>

      {otherEdges.length === 0
        ? <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No relationships</span>
        : otherEdges.map((edge, i) => {
          const isOut = `entity:${edge.from}` === selectedId || edge.from === shortId;
          const peerId = isOut ? edge.to : edge.from;
          const peerLabel = labelFor(peerId);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span style={{ color: isOut ? 'var(--accent)' : 'var(--text-hint)', fontWeight: 700, fontSize: 10 }}>{isOut ? '→' : '←'}</span>
              <span style={{ color: 'var(--text-hint)', fontStyle: 'italic', fontSize: 11 }}>{edge.label}</span>
              <span
                style={{ flex: 1, cursor: 'pointer', color: 'var(--text-primary)' }}
                onClick={() => selectEntity(`entity:${peerId}`)}
                title="Select entity"
              >
                {peerLabel}
              </span>
              <button
                onClick={() => removeEdge(
                  isOut ? selected.id : `entity:${peerId}`,
                  isOut ? `entity:${peerId}` : selected.id,
                  edge.label,
                )}
                title="Remove edge"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', fontSize: 12 }}
              >✕</button>
            </div>
          );
        })
      }

      {showRelate && (
        <RelateDialog
          sourceEntityId={selected.id}
          sourceLabel={selected.label}
          onClose={() => setShowRelate(false)}
        />
      )}
    </div>
  );
});

// ── Registry row ──────────────────────────────────────────────────────────────
const EntityRow = memo(function EntityRow({
  entity, isSelected, isContext, onSelect, onTag, onRelate, onDelete,
}: {
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
      <td><span className={`kind-badge kind-${entity.kind}`}>{entity.kind}</span></td>
      <td>{isSelected ? '◉' : isContext ? '◎' : ''}</td>
      <td style={{ position: 'relative' }}>
        {menu && (
          <div
            ref={menuRef}
            style={{
              position: 'absolute', right: 0, top: 0, zIndex: 100,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: 7, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              minWidth: 130, padding: '4px 0',
            }}
            onMouseLeave={() => setMenu(false)}
          >
            {[
              { label: 'Inspect', action: () => { onSelect(entity.id); setMenu(false); } },
              { label: 'Relate…', action: () => { onRelate(entity.id, entity.label); setMenu(false); } },
              { label: 'Tag…', action: () => { onTag(entity.id, entity.label); setMenu(false); } },
              { label: 'Delete', action: () => { onDelete(entity.id); setMenu(false); }, danger: true },
            ].map(item => (
              <div
                key={item.label}
                onClick={e => { e.stopPropagation(); item.action(); }}
                style={{
                  padding: '7px 14px', fontSize: 12, cursor: 'pointer',
                  color: (item as any).danger ? '#ff6b6b' : 'var(--text-primary)',
                }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = '')}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
});

// ── ViewportPanel ─────────────────────────────────────────────────────────────
export const ViewportPanel = memo(function ViewportPanel() {
  const [activeTab, setActiveTab] = useState<'properties' | 'preview' | 'registry'>('properties');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [quickTagId, setQuickTagId] = useState<string | null>(null);
  const [quickTagLabel, setQuickTagLabel] = useState('');
  const [quickTagInput, setQuickTagInput] = useState('');
  const [showRelateFor, setShowRelateFor] = useState<{ id: string; label: string } | null>(null);

  const selectedEntityId = useOsStore(selectSelectedId);
  const selectedIds = useOsStore(selectSelectedIds);
  const entities = useOsStore(selectEntities);
  const contextEntities = useOsStore(selectContextEntities);
  const selectEntity = useOsStore(selectSelectEntity);
  const blobTraits = useOsStore(selectBlobTraits);
  const { deleteEntity, tagEntity } = useOsStore();

  const contextIds = useMemo(() => contextEntities.map(e => e.id), [contextEntities]);
  const handleSelect = useCallback((id: string | null) => selectEntity(id), [selectEntity]);

  const filtered = useMemo(() =>
    entities.filter(e => e.label.toLowerCase().includes(search.toLowerCase())),
    [entities, search]
  );

  const selected = useMemo(() => entities.find(e => e.id === selectedEntityId) ?? null, [entities, selectedEntityId]);
  const blobTrait = selected ? blobTraits.find(b => b.owner === selected.id) : null;
  const isImage = blobTrait && blobTrait.mime.startsWith('image/');
  const isPdf = blobTrait && blobTrait.mime === 'application/pdf';
  const isCad = blobTrait && (blobTrait.mime === 'model/gltf-binary' || blobTrait.mime === 'model/gltf+json');
  const imageSrc = blobTrait?.localUrl ? convertFileSrc(blobTrait.localUrl) : null;

  const tabStyle = (tab: string) => ({
    background: 'none', border: 'none', padding: '10px 4px',
    borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
    color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-hint)',
    cursor: 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const,
  });

  return (
    <div className="panel viewport-panel">
      {/* Tab Bar */}
      <div className="panel-header" style={{ display: 'flex', gap: 16, padding: '0 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)' }}>
        <button style={tabStyle('properties')} onClick={() => setActiveTab('properties')}>Properties</button>
        <button style={tabStyle('preview')} onClick={() => setActiveTab('preview')}>Preview</button>
        <button style={tabStyle('registry')} onClick={() => setActiveTab('registry')}>Registry</button>
      </div>

      <div className="panel-body" style={{ padding: activeTab === 'registry' ? 0 : 12, overflow: 'auto' }}>

        {/* ── Properties Tab ───────────────────────────────────────────── */}
        {activeTab === 'properties' && (
          selectedIds.length > 1 ? <SelectionPanel /> : <EntityInspector />
        )}

        {/* ── Preview Tab ──────────────────────────────────────────────── */}
        {activeTab === 'preview' && (
          !selected ? (
            <div className="panel-placeholder">
              <div className="placeholder-icon">👁️</div>
              <p>No preview available</p>
            </div>
          ) : isImage && imageSrc ? (
            <div style={{ padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <img src={imageSrc} alt={selected.label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
            </div>
          ) : isPdf && imageSrc ? (
            <object data={imageSrc} type="application/pdf" width="100%" height="100%" style={{ borderRadius: 4, background: '#fff' }}>
              <div className="panel-placeholder"><p>PDF viewer not natively supported.</p></div>
            </object>
          ) : isCad && imageSrc ? (
            <ThreeViewer url={imageSrc} />
          ) : (
            <div className="panel-placeholder">
              <div className="placeholder-icon">📦</div>
              <p>Unknown blob structure.</p>
              <pre style={{ textAlign: 'left', fontSize: 10, background: '#111', padding: 8, borderRadius: 4, width: '90%', overflow: 'auto', color: '#ffb86c' }}>
                {blobTrait ? JSON.stringify({ ...blobTrait, isImage, isPdf, isCad }, null, 2) : "No BlobTrait attached to this Entity!"}
              </pre>
            </div>
          )
        )}

        {/* ── Registry Tab ─────────────────────────────────────────────── */}
        {activeTab === 'registry' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)' }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search entities…"
                style={{
                  flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 5, padding: '5px 9px', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
                }}
              />
              <button
                id="create-entity-btn"
                onClick={() => setShowCreate(true)}
                title="New entity (Alt+N)"
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
              >
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
                <thead>
                  <tr>
                    <th>Label</th><th>Kind</th><th>Context</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <EntityRow
                      key={e.id}
                      entity={e}
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
          </div>
        )}
      </div>

      {/* ── Global Dialogs ──────────────────────────────────────────────── */}
      {showCreate && <CreateEntityDialog onClose={() => setShowCreate(false)} />}

      {showRelateFor && (
        <RelateDialog
          sourceEntityId={showRelateFor.id}
          sourceLabel={showRelateFor.label}
          onClose={() => setShowRelateFor(null)}
        />
      )}

      {/* Quick-tag mini-modal */}
      {quickTagId && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setQuickTagId(null); }}
        >
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 9, padding: '20px 24px', minWidth: 300, boxShadow: '0 6px 32px rgba(0,0,0,0.5)' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>
              Add tag to <strong>{quickTagLabel}</strong>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                type="text"
                value={quickTagInput}
                onChange={e => setQuickTagInput(e.target.value)}
                onKeyDown={async ev => {
                  if (ev.key === 'Enter') {
                    await tagEntity(quickTagId!, quickTagInput.trim());
                    setQuickTagId(null);
                  }
                  if (ev.key === 'Escape') setQuickTagId(null);
                }}
                placeholder="Tag name…"
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
              />
              <button
                onClick={async () => { await tagEntity(quickTagId!, quickTagInput.trim()); setQuickTagId(null); }}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              >
                Tag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
