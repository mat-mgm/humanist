import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

import { useOsStore, resolvedLabel } from '../store';
import { EntitySnapshot, LabelTrait, SpatialTrait, TemporalTrait } from '../models';
import { SearchableDropdown } from './SearchableDropdown';
import { ThreeViewer } from './ThreeViewer';
import { PdfViewer } from './PdfViewer';
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

// ── Ontology Panel ────────────────────────────────────────────────────────────
const OntologyPanel = memo(function OntologyPanel() {
  const { fetchRelationshipTypes, saveRelationshipType, deleteRelationshipType } = useOsStore();
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
              >✕</button>
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

// ── Entity Inspector ──────────────────────────────────────────────────────────
const EntityInspector = memo(function EntityInspector({
  editFormat,
  setEditFormat,
  onEditInTerminal,
  onOpenExternal,
  blobTrait,
  isSpawning
}: {
  editFormat: 'yaml' | 'json' | 'markdown',
  setEditFormat: (f: any) => void,
  onEditInTerminal: () => void,
  onOpenExternal: () => void,
  blobTrait: any,
  isSpawning: boolean
}) {
  const selectedId = useOsStore(selectSelectedId);
  const entities = useOsStore(selectEntities);
  const edges = useOsStore(selectEdges);
  const spatialTraits = useOsStore(selectSpatialTraits);
  const temporalTraits = useOsStore(selectTemporalTraits);
  const selectEntity = useOsStore(selectSelectEntity);
  const { updateMetadata, deleteEntity, tagEntity, untagEntity, removeEdge, saveTemporalTrait, saveSpatialTrait, fetchEntityHistory, getEntityAsOf, fetchLabelTraits, saveLabelTrait, deleteLabelTrait } = useOsStore();
  const entityHistory = useOsStore(s => s.entityHistory);
  const labelTraits = useOsStore(s => s.labelTraits);
  const activeLocale = useOsStore(s => s.activeLocale);

  const selected = useMemo(
    () => entities.find(e => e.id === selectedId) ?? null,
    [entities, selectedId],
  );

  const allLabelTraits = useOsStore(s => s.allLabelTraits);
  const selectedDisplayLabel = useMemo(
    () => selected ? resolvedLabel(selected, allLabelTraits, activeLocale) : '',
    [selected, allLabelTraits, activeLocale],
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

  // Edge inspector
  const [selectedEdgeIdx, setSelectedEdgeIdx] = useState<number | null>(null);
  useEffect(() => { setSelectedEdgeIdx(null); }, [selectedId]);

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

  // Inherited spatial trait (resolved when entity has no own SpatialTrait)
  const { getEffectiveSpatialTrait } = useOsStore();
  const [inheritedSpatial, setInheritedSpatial] = useState<SpatialTrait | null>(null);

  useEffect(() => {
    if (!selectedId || spatialTrait) { setInheritedSpatial(null); return; }
    getEffectiveSpatialTrait(selectedId).then(t => setInheritedSpatial(t ?? null));
  }, [selectedId, spatialTrait, getEffectiveSpatialTrait]);

  // Translations section state
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [newLang, setNewLang] = useState('');
  const [newText, setNewText] = useState('');

  const openTranslations = useCallback(async () => {
    if (!selected) return;
    await fetchLabelTraits(selected.id);
    setTranslationsOpen(true);
  }, [selected, fetchLabelTraits]);

  const addTranslation = useCallback(async () => {
    if (!selected || !newLang.trim() || !newText.trim()) return;
    const id = `label_trait:${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
    await saveLabelTrait({
      id,
      owner: selected.id,
      lang: newLang.trim().toLowerCase(),
      text: newText.trim(),
    });
    setNewLang('');
    setNewText('');
  }, [selected, newLang, newText, saveLabelTrait]);

  // History section state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<EntitySnapshot | null>(null);

  const openHistory = useCallback(async () => {
    if (!selected) return;
    await fetchEntityHistory(selected.id);
    setHistoryOpen(true);
  }, [selected, fetchEntityHistory]);

  const loadSnapshot = useCallback(async (changedAt: string) => {
    if (!selected) return;
    const snap = await getEntityAsOf(selected.id, changedAt);
    setSnapshot(snap);
  }, [selected, getEntityAsOf]);

  const clearSnapshot = useCallback(() => setSnapshot(null), []);

  // Clear per-entity state when selection changes
  useEffect(() => {
    setHistoryOpen(false);
    setSnapshot(null);
    setTranslationsOpen(false);
    setNewLang('');
    setNewText('');
  }, [selectedId]);

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
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{selectedDisplayLabel}</span>
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
            inheritedSpatial ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: 'var(--accent)', fontStyle: 'italic', marginBottom: 4 }}>Inherited from ancestor</span>
                <div className="prop-row"><span className="prop-key">Lat</span><span className="prop-val mono">{inheritedSpatial.lat}</span></div>
                <div className="prop-row"><span className="prop-key">Lng</span><span className="prop-val mono">{inheritedSpatial.lng}</span></div>
                <div className="prop-row"><span className="prop-key">Alt</span><span className="prop-val mono">{inheritedSpatial.alt}</span></div>
                <div className="prop-row"><span className="prop-key">Heading</span><span className="prop-val mono">{inheritedSpatial.heading}°</span></div>
              </div>
            ) : (
              <span>No spatial data</span>
            )
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
          const isEdgeSelected = selectedEdgeIdx === i;
          const hasPayload = edge.strength != null || edge.latency != null || (edge.metadata && Object.keys(edge.metadata).length > 0);
          return (
            <div key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12, cursor: 'pointer' }}
                onClick={() => setSelectedEdgeIdx(isEdgeSelected ? null : i)}
              >
                <span style={{ color: isOut ? 'var(--accent)' : 'var(--text-hint)', fontWeight: 700, fontSize: 10 }}>{isOut ? '→' : '←'}</span>
                <span style={{ color: 'var(--text-hint)', fontStyle: 'italic', fontSize: 11 }}>{edge.label}</span>
                <span
                  style={{ flex: 1, color: 'var(--text-primary)' }}
                  onClick={e => { e.stopPropagation(); selectEntity(`entity:${peerId}`); }}
                  title="Select entity"
                >
                  {peerLabel}
                </span>
                {hasPayload && <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700 }}>●</span>}
                <button
                  onClick={e => { e.stopPropagation(); removeEdge(
                    isOut ? selected.id : `entity:${peerId}`,
                    isOut ? `entity:${peerId}` : selected.id,
                    edge.label,
                  ); }}
                  title="Remove edge"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', fontSize: 12 }}
                >✕</button>
              </div>
              {isEdgeSelected && (
                <div style={{ padding: '6px 0 8px 16px', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ color: 'var(--text-hint)', marginBottom: 2, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Edge payload</div>
                  <div className="prop-row"><span className="prop-key">Strength</span><span className="prop-val mono">{edge.strength ?? '—'}</span></div>
                  <div className="prop-row"><span className="prop-key">Latency</span><span className="prop-val mono">{edge.latency != null ? `${edge.latency} ms` : '—'}</span></div>
                  {edge.metadata && Object.keys(edge.metadata).length > 0 && (
                    <div>
                      <span style={{ color: 'var(--text-hint)', fontSize: 10 }}>Metadata:</span>
                      <pre style={{ margin: '2px 0 0', padding: '4px 6px', borderRadius: 4, background: 'var(--bg)', fontSize: 10, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                        {JSON.stringify(edge.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
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

      {/* ── History ───────────────────────────────────────────────────── */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          onClick={historyOpen ? () => setHistoryOpen(false) : openHistory}
        >
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>History</span>
          <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{historyOpen ? '▲' : '▼'}</span>
        </div>

        {historyOpen && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {entityHistory.length === 0
              ? <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No history records</span>
              : entityHistory.map((snap) => (
                <div
                  key={snap.id}
                  onClick={() => loadSnapshot(snap.changed_at)}
                  style={{
                    padding: '4px 6px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                    background: snapshot?.id === snap.id ? 'var(--bg-secondary)' : 'transparent',
                    border: '1px solid transparent',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = snapshot?.id === snap.id ? 'var(--bg-secondary)' : 'transparent')}
                >
                  <span style={{ color: 'var(--text-hint)', fontFamily: 'monospace', flexShrink: 0 }}>
                    {new Date(snap.changed_at).toLocaleString()}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {snap.label}
                  </span>
                  <span className={`kind-badge kind-${snap.kind}`}>{snap.kind}</span>
                </div>
              ))
            }

            {snapshot && (
              <div style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    Viewing snapshot — read only
                  </span>
                  <button
                    onClick={clearSnapshot}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 12, padding: 0 }}
                  >✕</button>
                </div>
                <div style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--text-hint)' }}>Label: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{snapshot.label}</span>
                </div>
                <div style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--text-hint)' }}>Kind: </span>
                  <span className={`kind-badge kind-${snapshot.kind}`}>{snapshot.kind}</span>
                </div>
                <div style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--text-hint)' }}>Recorded: </span>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    {new Date(snapshot.changed_at).toLocaleString()}
                  </span>
                </div>
                {Object.keys(snapshot.metadata ?? {}).length > 0 && (
                  <div style={{ fontSize: 11 }}>
                    <span style={{ color: 'var(--text-hint)', display: 'block', marginBottom: 4 }}>Metadata:</span>
                    <pre style={{
                      margin: 0, padding: '6px 8px', borderRadius: 4,
                      background: 'var(--bg)', color: 'var(--text-primary)',
                      fontSize: 10, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                    }}>
                      {JSON.stringify(snapshot.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Translations ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          onClick={translationsOpen ? () => setTranslationsOpen(false) : openTranslations}
        >
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>
            Translations
            {selected?.lang_canonical && <span style={{ fontWeight: 400, marginLeft: 6, textTransform: 'none' }}>({selected.lang_canonical})</span>}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{translationsOpen ? '▲' : '▼'}</span>
        </div>

        {translationsOpen && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {labelTraits.length === 0
              ? <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No translations</span>
              : labelTraits.map((t: LabelTrait) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    fontFamily: 'monospace', fontSize: 10, padding: '2px 6px',
                    borderRadius: 3, background: 'var(--bg-secondary)', color: 'var(--accent)',
                    flexShrink: 0, minWidth: 28, textAlign: 'center',
                  }}>{t.lang}</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.text}
                  </span>
                  {t.lang === activeLocale && (
                    <span style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }}>active</span>
                  )}
                  <button
                    onClick={() => deleteLabelTrait(t.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 12, padding: '0 2px', flexShrink: 0 }}
                    title="Delete translation"
                  >✕</button>
                </div>
              ))
            }
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <input
                value={newLang}
                onChange={e => setNewLang(e.target.value)}
                placeholder="lang (e.g. de)"
                maxLength={10}
                style={{
                  width: 64, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '4px 6px', fontSize: 11, color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <input
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="translated label"
                style={{
                  flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '4px 6px', fontSize: 11, color: 'var(--text-primary)',
                  outline: 'none',
                }}
                onKeyDown={e => e.key === 'Enter' && addTranslation()}
              />
              <button
                onClick={addTranslation}
                disabled={!newLang.trim() || !newText.trim()}
                style={{
                  background: 'var(--accent)', border: 'none', borderRadius: 4,
                  padding: '4px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600,
                  opacity: (!newLang.trim() || !newText.trim()) ? 0.5 : 1,
                }}
              >Add</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Advanced Terminal Editor ──────────────────────────────────── */}
      <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Terminal Editor</span>
          <span style={{ fontSize: 10, color: 'var(--text-hint)', opacity: 0.7 }}>Uses local $EDITOR</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={editFormat}
            onChange={(e) => setEditFormat(e.target.value as any)}
            style={{
              flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '4px 8px', fontSize: 11, color: 'var(--text-primary)',
              outline: 'none'
            }}
          >
            <option value="yaml">YAML</option>
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
          </select>
          <button
            onClick={() => onEditInTerminal()}
            disabled={isSpawning}
            style={{
              background: isSpawning ? 'var(--text-hint)' : 'var(--accent)', border: 'none', borderRadius: 5,
              padding: '4px 12px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600,
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)', opacity: isSpawning ? 0.7 : 1
            }}
          >
            {isSpawning ? 'Spawning...' : 'Edit in Terminal'}
          </button>
          
          {blobTrait && (
            <button
              onClick={() => onOpenExternal()}
              style={{
                background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5,
                padding: '4px 12px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 11, fontWeight: 600,
              }}
              title="Open blob in default system editor"
            >
              Open Externally
            </button>
          )}
        </div>
      </div>
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
  const [activeTab, setActiveTab] = useState<'properties' | 'preview' | 'registry' | 'ontology'>('properties');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [quickTagId, setQuickTagId] = useState<string | null>(null);
  const [quickTagLabel, setQuickTagLabel] = useState('');
  const [quickTagInput, setQuickTagInput] = useState('');
  const [showRelateFor, setShowRelateFor] = useState<{ id: string; label: string } | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState<string>('');
  const [editFormat, setEditFormat] = useState<'yaml' | 'json' | 'markdown'>('yaml');
  const saveBlobContent = useOsStore(s => s.saveBlobContent);
  const [isSpawning, setIsSpawning] = useState(false);

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
  const isText = blobTrait && (blobTrait.mime.startsWith('text/') || blobTrait.mime === 'application/json');
  const imageSrc = blobTrait?.localUrl ? convertFileSrc(blobTrait.localUrl) : null;

  const onOpenExternal = async () => {
    if (!blobTrait?.localUrl) {
       console.warn('Open External failed: No localUrl available for blob');
       return;
    }
    console.debug('Opening external path:', blobTrait.localUrl);
    try {
      await invoke('open_external_path', { path: blobTrait.localUrl });
    } catch (err) {
      console.error('Failed to open external editor:', err);
      alert('External editor failed: ' + err);
    }
  };

  const onEditInTerminal = async () => {
    if (!selected || isSpawning) return;
    setIsSpawning(true);
    const setActivePtySession = useOsStore.getState().setActivePtySession;
    const sessionId = `edit-${selected.id}`;
    
    console.debug('Launching terminal editor for session:', sessionId);
    try {
      setActivePtySession(sessionId);
      await invoke('edit_entity_in_terminal', { entityId: selected.id, format: editFormat });
    } catch (err) {
      console.error('Failed to open terminal editor:', err);
      alert('Terminal editor failed to start: ' + err);
      setActivePtySession('main');
    } finally {
      setIsSpawning(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'preview' && isText && imageSrc) {
      fetch(imageSrc)
        .then(res => res.text())
        .then(txt => {
          setTextContent(txt);
          setEditedContent(txt);
        })
        .catch(err => setTextContent(`Failed to load text: ${err}`));
    } else {
      setTextContent(null);
      setIsEditing(false);
    }
  }, [activeTab, isText, imageSrc]);

  const onSave = async () => {
    if (!blobTrait) return;
    try {
      await saveBlobContent(blobTrait.storage_id, editedContent);
      setTextContent(editedContent);
      setIsEditing(false);
    } catch (e) {
      console.error('Failed to save blob:', e);
    }
  };

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
        <button style={tabStyle('ontology')} onClick={() => setActiveTab('ontology')}>Ontology</button>
      </div>

      <div className="panel-body" style={{ padding: activeTab === 'registry' || activeTab === 'ontology' ? 0 : 12, overflow: 'auto' }}>

        {/* ── Properties Tab ───────────────────────────────────────────── */}
        {activeTab === 'properties' && (
          selectedIds.length > 1
            ? <SelectionPanel />
            : <EntityInspector 
                editFormat={editFormat} 
                setEditFormat={setEditFormat} 
                onEditInTerminal={onEditInTerminal}
                onOpenExternal={onOpenExternal}
                blobTrait={blobTrait}
                isSpawning={isSpawning}
              />
        )}

        {/* ── Preview Tab ──────────────────────────────────────────────── */}
        {activeTab === 'preview' && (
          !selected ? (
            <div className="panel-placeholder">
              <div className="placeholder-icon">👁️</div>
              <p>No preview available</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
              {/* Preview Action Bar */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingBottom: 4 }}>
                {blobTrait && (
                  <button
                    onClick={onOpenExternal}
                    style={{
                      fontSize: 10, padding: '4px 8px', borderRadius: 4,
                      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                      color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600
                    }}
                    title="Open in default system editor"
                  >
                    Open Externally
                  </button>
                )}
                {selected && (
                  <button
                    onClick={onEditInTerminal}
                    disabled={isSpawning}
                    style={{
                      fontSize: 10, padding: '4px 8px', borderRadius: 4,
                      background: isSpawning ? 'var(--text-hint)' : 'var(--bg-secondary)', 
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600,
                      opacity: isSpawning ? 0.7 : 1
                    }}
                    title="Open in terminal $EDITOR"
                  >
                    {isSpawning ? 'Spawning...' : 'Edit in Term'}
                  </button>
                )}
                {isText && !isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    style={{
                      fontSize: 10, padding: '4px 8px', borderRadius: 4,
                      background: 'var(--accent)', border: 'none',
                      color: '#fff', cursor: 'pointer', fontWeight: 600
                    }}
                  >
                    Edit Content
                  </button>
                )}
                {isText && isEditing && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {editedContent !== textContent && (
                      <span style={{ fontSize: 9, color: 'var(--accent)', alignSelf: 'center', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Unsaved Edits
                      </span>
                    )}
                    <button
                      onClick={onSave}
                      style={{
                        fontSize: 10, padding: '4px 8px', borderRadius: 4,
                        background: 'var(--accent)', border: 'none',
                        color: '#fff', cursor: 'pointer', fontWeight: 600
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setIsEditing(false); setEditedContent(textContent || ''); }}
                      style={{
                        fontSize: 10, padding: '4px 8px', borderRadius: 4,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                        color: 'var(--text-hint)', cursor: 'pointer', fontWeight: 600
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Main Preview Area */}
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {isImage && imageSrc ? (
                  <div style={{ padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                    <img src={imageSrc} alt={selected.label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} />
                  </div>
                ) : isPdf && imageSrc ? (
                  <PdfViewer url={imageSrc} />
                ) : isCad && imageSrc ? (
                  <ThreeViewer url={imageSrc} />
                ) : isText && textContent !== null ? (
                  isEditing ? (
                    <textarea
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      spellCheck={false}
                      style={{
                        width: '100%', height: '100%', padding: '12px',
                        background: 'var(--bg-primary)', color: 'var(--text-primary)',
                        border: '1px solid var(--border)', borderRadius: 4,
                        fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.5,
                        resize: 'none', outline: 'none',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
                      }}
                    />
                  ) : (
                    <div style={{ padding: 12, minHeight: '100%', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
                      <pre style={{ margin: 0, fontSize: 13, fontFamily: 'var(--font-mono)', lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                        {textContent}
                      </pre>
                    </div>
                  )
                ) : (
                  <div className="panel-placeholder">
                    <div className="placeholder-icon">📦</div>
                    <p>Unknown blob structure.</p>
                    <pre style={{ textAlign: 'left', fontSize: 10, background: '#111', padding: 8, borderRadius: 4, width: '90%', overflow: 'auto', color: '#ffb86c' }}>
                      {blobTrait ? JSON.stringify({ ...blobTrait, isImage, isPdf, isCad }, null, 2) : "No BlobTrait attached to this Entity!"}
                    </pre>
                  </div>
                )}
              </div>
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

        {/* ── Ontology Tab ─────────────────────────────────────────────── */}
        {activeTab === 'ontology' && <OntologyPanel />}

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
