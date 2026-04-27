import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, Pencil, Info, X, Minus, Clipboard, Check, FilePlus2, Database } from 'lucide-react';

import { useOsStore, entityValues, resolvedLabel } from '../store';
import { EntitySnapshot, LabelTrait, SpatialTrait, TableTrait, TableColumn, TemporalTrait } from '../models';
import { SearchableDropdown } from './SearchableDropdown';
import { RelateDialog } from './RelateDialog';

const KIND_COLORS: Record<string, string> = {
  physical: '#5a9cff',
  digital:  '#7aff8c',
  abstract: '#ffd166',
  persona:  '#ff8b94',
};

// Graph-search-style entity dropdown. Selects an existing tag or, on Enter
// with no match, lets the parent create a new one via free-text.
function TagSearchDropdown({
  value, onChange, onSelect, onEnterFreeText, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (label: string) => void;
  onEnterFreeText: () => void;
  options: { id: string; label: string; category: string }[];
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const blurT = useRef<number | null>(null);
  const q = value.trim().toLowerCase();
  const filtered = useMemo(() =>
    !q ? options.slice(0, 80) : options.filter(o => o.label.toLowerCase().includes(q)).slice(0, 80),
    [q, options]);
  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        type="text" value={value} placeholder={placeholder ?? 'Add tag…'}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { if (blurT.current) window.clearTimeout(blurT.current); setFocused(true); }}
        onBlur={() => { blurT.current = window.setTimeout(() => setFocused(false), 150); }}
        onKeyDown={e => { if (e.key === 'Enter') onEnterFreeText(); }}
        style={{
          width: '100%', background: 'var(--bg-primary)',
          border: '1px solid var(--accent)', color: 'var(--text-primary)',
          padding: '5px 10px', borderRadius: 4, outline: 'none',
          fontSize: 11, height: 28,
        }}
      />
      {focused && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: 27, left: 0, right: 0,
          maxHeight: 220, overflowY: 'auto',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderRadius: 4, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {filtered.map(o => (
            <div
              key={o.id}
              onMouseDown={() => { onSelect(o.label); }}
              style={{
                padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                color: 'var(--text-primary)', borderBottom: '1px solid var(--border)',
                display: 'flex', gap: 6, alignItems: 'center',
              }}
              onMouseEnter={el => (el.currentTarget.style.background = 'var(--bg-primary)')}
              onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
            >
              <span style={{ color: KIND_COLORS[o.category] ?? 'var(--text-hint)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{o.category}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Atomic selectors ──────────────────────────────────────────────────────────
const selectSelectedId   = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityId;
const selectSelectedIds  = (s: ReturnType<typeof useOsStore.getState>) => s.selectedIds;
const selectEntities     = (s: ReturnType<typeof useOsStore.getState>) => s.entities;
const selectSelectEntity = (s: ReturnType<typeof useOsStore.getState>) => s.selectEntity;
const selectSpatialTraits = (s: ReturnType<typeof useOsStore.getState>) => s.spatialTraits;
const selectTemporalTraits = (s: ReturnType<typeof useOsStore.getState>) => s.temporalTraits;
const selectKeyValueTraits = (s: ReturnType<typeof useOsStore.getState>) => s.keyValueTraits;
const selectEdges        = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityEdges;

function formatBlobSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return 'Unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

// ── Tag chip ──────────────────────────────────────────────────────────────────
const TagChip = memo(function TagChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: 'var(--tag-bg, rgba(100,120,255,0.15))',
      border: '1px solid var(--tag-border, rgba(100,120,255,0.35))',
      color: 'var(--accent)', borderRadius: 999, padding: '2px 9px',
      fontSize: 11, fontWeight: 600,
    }}>
      {label}
      <button onClick={onRemove} title="Remove tag"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', padding: '0 0 0 2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}><Minus size={10} /></button>
    </span>
  );
});

// ── Selection Panel (multi-select) ────────────────────────────────────────────
const SelectionPanel = memo(function SelectionPanel() {
  const selectedIds = useOsStore(selectSelectedIds);
  const entities    = useOsStore(selectEntities);
  const tagEntities = useOsStore(s => s.tagEntities);
  const addEdgeAction = useOsStore(s => s.addEdgeAction);
  const deleteEntities = useOsStore(s => s.deleteEntities);

  const [tagInput, setTagInput]       = useState('');
  const [relLabel, setRelLabel]       = useState('');
  const [relError, setRelError]       = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Preserve selection order: iterate selectedIds to build the list
  const selectedEntities = useMemo(() =>
    selectedIds.map(id => entities.find(e => e.id === id)).filter(Boolean) as typeof entities,
    [entities, selectedIds]);
  const isTwoSelected    = selectedIds.length === 2;
  const [nodeA, nodeB]   = selectedEntities;

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
    try { await addEdgeAction(nodeA.id, nodeB.id, label); setRelLabel(''); }
    catch (e: any) { setRelError(String(e)); }
  };

  const doDelete = async () => { await deleteEntities(selectedIds); setConfirmDelete(false); };

  if (selectedIds.length < 2) return null;

  return (
    <div className="properties-view" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{selectedIds.length} entities selected</span>
        <div style={{ marginLeft: 'auto' }}>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)}
              style={{ background: 'none', border: '1px solid #ff6b6b', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#ff6b6b', fontSize: 11, fontWeight: 700 }}>
              <Trash2 size={12} style={{ marginRight: 4 }} /> Delete All
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

      <div style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Selection</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {selectedEntities.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span className={`kind-badge kind-${e.category}`}>{e.category}</span>
            <span style={{ color: 'var(--text-primary)', flex: 1 }}>{e.label}</span>
          </div>
        ))}
      </div>

      <div style={{ margin: '8px 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Tag All</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <SearchableDropdown
          value={tagInput} onChange={setTagInput}
          onSelect={(opt) => { setTagInput(''); tagEntities(selectedIds, opt.label); }}
          options={entities.filter((e: any) => e.category === 'abstract').map((e: any) => ({ id: e.id, label: e.label }))}
          placeholder="Tag name…" style={{ flex: 1 }}
        />
        <button onClick={handleBulkTag}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Tag</button>
      </div>

      {isTwoSelected && (
        <>
          <div style={{ margin: '16px 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Create Relationship</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginBottom: 8, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{nodeA?.label}</span>{' → '}label{' → '}
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{nodeB?.label}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" value={relLabel} onChange={ev => setRelLabel(ev.target.value)}
              onKeyDown={ev => ev.key === 'Enter' && handleCreateEdge()} placeholder="Relationship label…"
              style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 9px', color: 'var(--text-primary)', fontSize: 12, outline: 'none' }} />
            <button onClick={handleCreateEdge}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Relate</button>
          </div>
          {relError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '4px 0 0' }}>{relError}</p>}
        </>
      )}
    </div>
  );
});

// ── Single entity inspector ───────────────────────────────────────────────────
const SingleInspector = memo(function SingleInspector() {
  const selectedId       = useOsStore(selectSelectedId);
  const entities         = useOsStore(selectEntities);
  const edges            = useOsStore(selectEdges);
  const spatialTraits    = useOsStore(selectSpatialTraits);
  const temporalTraits   = useOsStore(selectTemporalTraits);
  const keyValueTraits   = useOsStore(selectKeyValueTraits);
  const selectEntity     = useOsStore(selectSelectEntity);
  const entityHistory    = useOsStore(s => s.entityHistory);
  const labelTraits      = useOsStore(s => s.labelTraits);
  const activeLocale     = useOsStore(s => s.activeLocale);
  const allLabelTraits   = useOsStore(s => s.allLabelTraits);
  const blobTraits       = useOsStore(s => s.blobTraits);

  const tableTraits      = useOsStore(s => s.tableTraits);
  const saveTableTrait   = useOsStore(s => s.saveTableTrait);
  const deleteTableTrait = useOsStore(s => s.deleteTableTrait);

  const saveEntityData = useOsStore(s => s.saveEntityData);
  const deleteEntity = useOsStore(s => s.deleteEntity);
  const tagEntity = useOsStore(s => s.tagEntity);
  const untagEntity = useOsStore(s => s.untagEntity);
  const removeEdge = useOsStore(s => s.removeEdge);
  const saveTemporalTrait = useOsStore(s => s.saveTemporalTrait);
  const saveSpatialTrait = useOsStore(s => s.saveSpatialTrait);
  const fetchEntityHistory = useOsStore(s => s.fetchEntityHistory);
  const getEntityAsOf = useOsStore(s => s.getEntityAsOf);
  const fetchLabelTraits = useOsStore(s => s.fetchLabelTraits);
  const saveLabelTrait = useOsStore(s => s.saveLabelTrait);
  const deleteLabelTrait = useOsStore(s => s.deleteLabelTrait);
  const getEffectiveSpatialTrait = useOsStore(s => s.getEffectiveSpatialTrait);


  const selected = useMemo(() => entities.find(e => e.id === selectedId) ?? null, [entities, selectedId]);
  const selectedValues = useMemo(
    () => selected ? entityValues(selected.id, keyValueTraits) : {},
    [selected, keyValueTraits],
  );
  const ownBlobTraits = selected ? blobTraits.filter(b => b.owner === selected.id) : [];
  const blobTrait = ownBlobTraits[0] ?? null;
  const blobSourcePath = blobTrait?.localUrl ?? null;

  const selectedDisplayLabel = useMemo(
    () => selected ? resolvedLabel(selected, allLabelTraits, activeLocale) : '',
    [selected, allLabelTraits, activeLocale],
  );

  const tagEdges   = useMemo(() => edges.filter(e => e.label === 'tagged_as' && `entity:${e.from}` === selectedId), [edges, selectedId]);
  const otherEdges = useMemo(() => edges.filter(e => e.label !== 'tagged_as'), [edges]);

  const temporalTrait = useMemo(() => {
    if (!selectedId) return undefined;
    return temporalTraits.find(t =>
      t.owner === selectedId || t.owner === selectedId.replace('entity:', '') || `entity:${t.owner}` === selectedId
    );
  }, [temporalTraits, selectedId]);

  const spatialTrait = useMemo(() => {
    if (!selectedId) return undefined;
    return spatialTraits.find(t =>
      t.owner === selectedId || t.owner === selectedId.replace('entity:', '') || `entity:${t.owner}` === selectedId
    );
  }, [spatialTraits, selectedId]);

  const labelFor = useCallback((shortId: string) => {
    const found = entities.find(e => e.id === `entity:${shortId}` || e.id === shortId);
    return found?.label ?? shortId;
  }, [entities]);

  // Metadata editing
  const [editMeta, setEditMeta]     = useState<Record<string, string> | null>(null);
  const [newKey, setNewKey]         = useState('');
  const [newVal, setNewVal]         = useState('');
  const [metaError, setMetaError]   = useState('');

  const startEditMeta = useCallback(() => {
    if (!selected) return;
    setEditMeta(Object.fromEntries(Object.entries(selectedValues).map(([k, v]) => [k, JSON.stringify(v)])));
    setMetaError('');
  }, [selected, selectedValues]);

  const saveMeta = useCallback(async () => {
    if (!selected || !editMeta) return;
    try {
      const parsed = Object.fromEntries(Object.entries(editMeta).map(([k, v]) => {
        try { return [k, JSON.parse(v)]; } catch { return [k, v]; }
      }));
      await saveEntityData(selected.id, parsed);
      setEditMeta(null);
    } catch (e: any) { setMetaError(String(e)); }
  }, [selected, editMeta, saveEntityData]);

  const addMetaRow = useCallback(() => {
    if (!newKey.trim()) return;
    setEditMeta(prev => ({ ...(prev ?? {}), [newKey.trim()]: newVal }));
    setNewKey(''); setNewVal('');
  }, [newKey, newVal]);

  // Tag input (graph-search-style dropdown)
  const [tagInput, setTagInput] = useState('');
  const [tagError, setTagError] = useState('');
  const tagOptions = useMemo(() =>
    entities
      .filter((e: any) => e.category === 'abstract')
      .map((e: any) => ({ id: e.id, label: resolvedLabel(e, allLabelTraits, activeLocale), category: e.category })),
    [entities, allLabelTraits, activeLocale]);
  const submitTag = useCallback(async (label: string) => {
    if (!selected) return;
    setTagError('');
    try { await tagEntity(selected.id, label); setTagInput(''); }
    catch (e: any) { setTagError(String(e)); }
  }, [selected, tagEntity]);

  // Tables
  const ownTableTraits = useMemo(
    () => selected ? tableTraits.filter(t => t.owner === selected.id) : [],
    [tableTraits, selected],
  );
  const [newTableNs, setNewTableNs]    = useState('');
  const [newTableCols, setNewTableCols] = useState('col1');
  const [tableError, setTableError]     = useState('');
  const addTable = useCallback(async () => {
    if (!selected) return;
    const ns = newTableNs.trim();
    if (!ns) { setTableError('Namespace required'); return; }
    if (ownTableTraits.some(t => t.namespace === ns)) {
      setTableError(`A table with namespace "${ns}" already exists`); return;
    }
    const cols: TableColumn[] = newTableCols.split(',')
      .map(s => s.trim()).filter(Boolean)
      .map(name => ({ name, data_type: 'string', nullable: true }));
    if (cols.length === 0) { setTableError('At least one column required'); return; }
    setTableError('');
    try {
      await saveTableTrait(selected.id, ns, cols, []);
      setNewTableNs(''); setNewTableCols('col1');
    } catch (e: any) { setTableError(String(e)); }
  }, [selected, newTableNs, newTableCols, ownTableTraits, saveTableTrait]);

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const doDelete = useCallback(async () => {
    if (!selected) return;
    await deleteEntity(selected.id);
    setConfirmDelete(false);
  }, [selected, deleteEntity]);

  // Relate dialog
  const [showRelate, setShowRelate] = useState(false);

  // Copy ULID feedback flag
  const [idCopied, setIdCopied] = useState(false);

  // Blob attach state
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [storeFilter, setStoreFilter] = useState('');
  const fetchBlobTraits = useOsStore(s => s.fetchBlobTraits);

  const handleAttachFromFile = useCallback(async () => {
    if (!selected) return;
    setAttachError(null);
    try {
      const paths = await invoke<string[]>('pick_native_import_files');
      if (!paths || paths.length === 0) return;
      setAttachBusy(true);
      for (const p of paths) {
        await invoke('attach_blob_to_entity', { entityId: selected.id, filePath: p });
      }
      await fetchBlobTraits();
    } catch (e) { setAttachError(String(e)); }
    finally { setAttachBusy(false); }
  }, [selected, fetchBlobTraits]);

  const handleAttachFromStore = useCallback(async (sourceBlobId: string) => {
    if (!selected) return;
    setAttachError(null);
    setAttachBusy(true);
    try {
      await invoke('attach_existing_blob_to_entity', { entityId: selected.id, sourceBlobTraitId: sourceBlobId });
      await fetchBlobTraits();
      setShowStorePicker(false);
      setStoreFilter('');
    } catch (e) { setAttachError(String(e)); }
    finally { setAttachBusy(false); }
  }, [selected, fetchBlobTraits]);

  const handleDetachBlob = useCallback(async (blobTraitId: string) => {
    setAttachError(null);
    try {
      await invoke('delete_blob_trait', { blobTraitId });
      await fetchBlobTraits();
    } catch (e) { setAttachError(String(e)); }
  }, [fetchBlobTraits]);

  // Edge inspector
  const [selectedEdgeIdx, setSelectedEdgeIdx] = useState<number | null>(null);
  useEffect(() => { setSelectedEdgeIdx(null); }, [selectedId]);

  // Temporal editing
  const [editTemporal, setEditTemporal] = useState<Omit<TemporalTrait, 'id'> | null>(null);
  const [tempError, setTempError]       = useState('');

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
    try { await saveTemporalTrait(editTemporal); setEditTemporal(null); }
    catch (e: any) { setTempError(String(e)); }
  }, [editTemporal, saveTemporalTrait]);

  // Spatial editing
  const [editSpatial, setEditSpatial]   = useState<Omit<SpatialTrait, 'id'> | null>(null);
  const [spatialError, setSpatialError] = useState('');

  const startEditSpatial = useCallback(() => {
    if (!selected) return;
    setEditSpatial({
      owner: selected.id,
      lat: spatialTrait?.lat ?? 0, lng: spatialTrait?.lng ?? 0,
      alt: spatialTrait?.alt ?? 0, heading: spatialTrait?.heading ?? 0,
      bbox: spatialTrait?.bbox ?? null, projection: spatialTrait?.projection ?? 'EPSG:4326',
    });
    setSpatialError('');
  }, [selected, spatialTrait]);

  const saveSpatial = useCallback(async () => {
    if (!editSpatial) return;
    try { await saveSpatialTrait(editSpatial); setEditSpatial(null); }
    catch (e: any) { setSpatialError(String(e)); }
  }, [editSpatial, saveSpatialTrait]);

  // Inherited spatial
  const [inheritedSpatial, setInheritedSpatial] = useState<SpatialTrait | null>(null);
  useEffect(() => {
    if (!selectedId || spatialTrait) { setInheritedSpatial(null); return; }
    getEffectiveSpatialTrait(selectedId).then(t => setInheritedSpatial(t ?? null));
  }, [selectedId, spatialTrait, getEffectiveSpatialTrait]);

  // Translations
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
    await saveLabelTrait({ id, owner: selected.id, lang: newLang.trim().toLowerCase(), text: newText.trim() });
    setNewLang(''); setNewText('');
  }, [selected, newLang, newText, saveLabelTrait]);

  // History
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshot, setSnapshot]       = useState<EntitySnapshot | null>(null);

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

  // Terminal editor callbacks
  const onOpenExternal = async () => {
    if (!blobTrait?.localUrl) return;
    try { await invoke('open_external_path', { path: blobTrait.localUrl }); }
    catch (err) { alert('External editor failed: ' + err); }
  };

  const onOpenInEditor = () => {
    if (!selected) return;
    const { setActiveActivity, setEditionEntity } = useOsStore.getState();
    setEditionEntity(selected.id);
    setActiveActivity('edition');
  };

  // Reset per-entity state on selection change
  useEffect(() => {
    setHistoryOpen(false); setSnapshot(null);
    setTranslationsOpen(false); setNewLang(''); setNewText('');
  }, [selectedId]);

  if (!selected) {
    return (
      <div className="panel-placeholder">
        <div className="placeholder-icon"><Info size={32} /></div>
        <p>Click an entity to inspect it</p>
      </div>
    );
  }

  const shortId = selected.id.replace('entity:', '');

  return (
    <div className="properties-view" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <span className={`kind-badge kind-${selected.category}`}>{selected.category}</span>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{selectedDisplayLabel}</span>
        <button onClick={onOpenInEditor} title="Open in editor"
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>
          <Pencil size={12} style={{ marginRight: 4 }} /> Edit
        </button>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>
            <Trash2 size={12} style={{ marginRight: 4 }} /> Delete
          </button>
        ) : (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#ff6b6b' }}>Sure?</span>
            <button onClick={doDelete} style={{ background: '#ff6b6b', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Yes</button>
            <button onClick={() => setConfirmDelete(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>No</button>
          </span>
        )}
      </div>

      <div className="prop-row" style={{ alignItems: 'center' }}>
        <span className="prop-key">ID</span>
        <span className="prop-val mono" style={{ fontSize: 10, wordBreak: 'break-all', flex: 1 }}>{selected.id}</span>
        <button
          onClick={async () => {
            try { await navigator.clipboard.writeText(shortId); setIdCopied(true); window.setTimeout(() => setIdCopied(false), 1200); }
            catch { /* clipboard may be unavailable */ }
          }}
          title="Copy ULID"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: idCopied ? 'var(--accent)' : 'var(--text-hint)', display: 'flex', alignItems: 'center' }}
        >
          {idCopied ? <Check size={13} /> : <Clipboard size={12} />}
        </button>
      </div>

      {/* Tags */}
      <div style={{ margin: '12px 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Tags</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 24 }}>
        {tagEdges.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No tags</span>}
        {tagEdges.map(e => {
          const tLabel = labelFor(e.to);
          return <TagChip key={e.to} label={tLabel} onRemove={() => untagEntity(selected.id, tLabel)} />;
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <TagSearchDropdown
          value={tagInput} onChange={setTagInput}
          onSelect={(label) => submitTag(label)}
          onEnterFreeText={() => { const t = tagInput.trim(); if (t) submitTag(t); }}
          options={tagOptions} placeholder="Add tag…"
        />
        <button onClick={() => { const t = tagInput.trim(); if (t) submitTag(t); }}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '5px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+</button>
      </div>
      {tagError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '4px 0 0' }}>{tagError}</p>}

      {/* Relationships */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Relationships</span>
        <button onClick={() => setShowRelate(true)}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12, cursor: 'pointer' }}
                onClick={() => setSelectedEdgeIdx(isEdgeSelected ? null : i)}>
                <span style={{ color: isOut ? 'var(--accent)' : 'var(--text-hint)', fontWeight: 700, fontSize: 10 }}>{isOut ? '→' : '←'}</span>
                <span style={{ color: 'var(--text-hint)', fontStyle: 'italic', fontSize: 11 }}>{edge.label}</span>
                <span style={{ flex: 1, color: 'var(--text-primary)' }}
                  onClick={e => { e.stopPropagation(); selectEntity(`entity:${peerId}`); }} title="Select entity">
                  {peerLabel}
                </span>
                {hasPayload && <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700 }}>●</span>}
                <button onClick={e => { e.stopPropagation(); removeEdge(
                  isOut ? selected.id : `entity:${peerId}`,
                  isOut ? `entity:${peerId}` : selected.id, edge.label,
                ); }} title="Remove edge"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', display: 'flex', alignItems: 'center' }}><Trash2 size={12} /></button>
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

      {/* History */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          onClick={historyOpen ? () => setHistoryOpen(false) : openHistory}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>History</span>
          <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{historyOpen ? '▲' : '▼'}</span>
        </div>
        {historyOpen && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {entityHistory.length === 0
              ? <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No history records</span>
              : entityHistory.map((snap) => (
                <div key={snap.id} onClick={() => loadSnapshot(snap.changed_at)}
                  style={{ padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 11, background: snapshot?.id === snap.id ? 'var(--bg-secondary)' : 'transparent', border: '1px solid transparent', color: 'var(--text-primary)', display: 'flex', gap: 8, alignItems: 'baseline' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                  onMouseLeave={e => (e.currentTarget.style.background = snapshot?.id === snap.id ? 'var(--bg-secondary)' : 'transparent')}>
                  <span style={{ color: 'var(--text-hint)', fontFamily: 'monospace', flexShrink: 0 }}>{new Date(snap.changed_at).toLocaleString()}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snap.label}</span>
                  <span className={`kind-badge kind-${snap.category}`}>{snap.category}</span>
                </div>
              ))
            }
            {snapshot && (
              <div style={{ marginTop: 8, padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Viewing snapshot — read only</span>
                  <button onClick={clearSnapshot} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', padding: 0, display: 'flex', alignItems: 'center' }}><X size={12} /></button>
                </div>
                <div style={{ fontSize: 11 }}><span style={{ color: 'var(--text-hint)' }}>Label: </span><span style={{ color: 'var(--text-primary)' }}>{snapshot.label}</span></div>
                <div style={{ fontSize: 11 }}><span style={{ color: 'var(--text-hint)' }}>Category: </span><span className={`kind-badge kind-${snapshot.category}`}>{snapshot.category}</span></div>
                <div style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--text-hint)' }}>Recorded: </span>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{new Date(snapshot.changed_at).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Translations */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          onClick={translationsOpen ? () => setTranslationsOpen(false) : openTranslations}>
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
                  <span style={{ fontFamily: 'monospace', fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--bg-secondary)', color: 'var(--accent)', flexShrink: 0, minWidth: 28, textAlign: 'center' }}>{t.lang}</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
                  {t.lang === activeLocale && <span style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }}>active</span>}
                  <button onClick={() => deleteLabelTrait(t.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-hint)', padding: '0 2px', flexShrink: 0, display: 'flex', alignItems: 'center' }} title="Delete translation"><Trash2 size={11} /></button>
                </div>
              ))
            }
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <input value={newLang} onChange={e => setNewLang(e.target.value)} placeholder="lang (e.g. de)" maxLength={10}
                style={{ width: 64, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', fontSize: 11, color: 'var(--text-primary)', outline: 'none' }} />
              <input value={newText} onChange={e => setNewText(e.target.value)} placeholder="translated label"
                style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', fontSize: 11, color: 'var(--text-primary)', outline: 'none' }}
                onKeyDown={e => e.key === 'Enter' && addTranslation()} />
              <button onClick={addTranslation} disabled={!newLang.trim() || !newText.trim()}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600, opacity: (!newLang.trim() || !newText.trim()) ? 0.5 : 1 }}>Add</button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Metadata</span>
        {editMeta == null
          ? <button onClick={startEditMeta} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}><Pencil size={11} style={{ marginRight: 3 }} /> Edit</button>
          : <span style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveMeta} style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Save</button>
              <button onClick={() => { setEditMeta(null); setMetaError(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>Cancel</button>
            </span>
        }
      </div>
      {editMeta == null ? (
        <>
          {Object.keys(selectedValues).length === 0
            ? <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No metadata</span>
            : Object.entries(selectedValues).map(([k, v]) => (
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
              <input value={k} readOnly style={{ width: 100, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-hint)', fontSize: 11 }} />
              <input value={v} onChange={ev => setEditMeta(prev => ({ ...prev!, [k]: ev.target.value }))}
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
              <button onClick={() => setEditMeta(prev => { const n = { ...prev! }; delete n[k]; return n; })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ff6b6b', display: 'flex', alignItems: 'center' }}><Trash2 size={12} /></button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
            <input value={newKey} onChange={ev => setNewKey(ev.target.value)} placeholder="key"
              style={{ width: 100, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
            <input value={newVal} onChange={ev => setNewVal(ev.target.value)} placeholder="value"
              style={{ flex: 1, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
            <button onClick={addMetaRow}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', color: '#fff', fontSize: 11 }}>+</button>
          </div>
          {metaError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '2px 0 0' }}>{metaError}</p>}
        </div>
      )}

      {/* Blobs */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Documents ({ownBlobTraits.length})</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={handleAttachFromFile}
            disabled={attachBusy}
            title="Attach a file from disk"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: attachBusy ? 'wait' : 'pointer', color: 'var(--text-hint)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, opacity: attachBusy ? 0.6 : 1 }}
          >
            <FilePlus2 size={11} />File
          </button>
          <button
            onClick={() => { setShowStorePicker(v => !v); setStoreFilter(''); }}
            disabled={attachBusy}
            title="Attach an existing blob from the store"
            style={{ background: showStorePicker ? 'var(--bg-primary)' : 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: attachBusy ? 'wait' : 'pointer', color: showStorePicker ? 'var(--accent)' : 'var(--text-hint)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Database size={11} />Store
          </button>
        </span>
      </div>

      {showStorePicker && (
        <div style={{ marginBottom: 8, padding: 6, border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg-secondary)' }}>
          <input
            type="text"
            value={storeFilter}
            onChange={ev => setStoreFilter(ev.target.value)}
            placeholder="Filter by filename or mime…"
            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none', marginBottom: 6 }}
          />
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(() => {
              const candidates = blobTraits.filter(t => t.owner !== selected.id);
              const q = storeFilter.trim().toLowerCase();
              const filtered = q
                ? candidates.filter(t => t.filename.toLowerCase().includes(q) || t.mime.toLowerCase().includes(q))
                : candidates;
              if (filtered.length === 0) {
                return <span style={{ fontSize: 11, color: 'var(--text-hint)', padding: '4px 6px' }}>No matching blobs in store.</span>;
              }
              return filtered.slice(0, 80).map(t => (
                <button
                  key={t.id}
                  onClick={() => handleAttachFromStore(t.id)}
                  disabled={attachBusy}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 7px', textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.filename}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-hint)', flexShrink: 0 }}>{t.mime}</span>
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      {attachError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '0 0 6px' }}>{attachError}</p>}

      {ownBlobTraits.length === 0 ? (
        <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No documents</span>
      ) : ownBlobTraits.map(b => (
        <div key={b.id} style={{ marginBottom: 10, padding: '6px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{b.filename}</span>
            {b.localUrl && (
              <button onClick={async () => { try { await invoke('open_external_path', { path: b.localUrl }); } catch (err) { alert('External editor failed: ' + err); } }}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 10, flexShrink: 0 }}>
                Open
              </button>
            )}
            <button
              onClick={() => handleDetachBlob(b.id)}
              title="Detach this blob from the entity"
              style={{ background: 'none', border: '1px solid rgba(255,107,107,0.3)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer', color: '#ff6b6b', flexShrink: 0, display: 'flex', alignItems: 'center' }}
            >
              <X size={11} />
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="prop-row"><span className="prop-key">Mime</span><span className="prop-val mono">{b.mime}</span></div>
            <div className="prop-row"><span className="prop-key">Size</span><span className="prop-val mono">{formatBlobSize(b.size)}</span></div>
            {b.localUrl && <div className="prop-row"><span className="prop-key">Path</span><span className="prop-val mono" style={{ wordBreak: 'break-all' }}>{b.localUrl}</span></div>}
          </div>
        </div>
      ))}

      {/* Spatial */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Spatial</span>
        {editSpatial == null
          ? <button onClick={startEditSpatial} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}><Pencil size={11} style={{ marginRight: 3 }} /> {spatialTrait ? 'Edit' : 'Add'}</button>
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
            ) : <span>No spatial data</span>
          ) : (
            <>
              <div className="prop-row"><span className="prop-key">Lat</span><span className="prop-val mono">{spatialTrait.lat}</span></div>
              <div className="prop-row"><span className="prop-key">Lng</span><span className="prop-val mono">{spatialTrait.lng}</span></div>
              <div className="prop-row"><span className="prop-key">Alt</span><span className="prop-val mono">{spatialTrait.alt}</span></div>
              <div className="prop-row"><span className="prop-key">Heading</span><span className="prop-val mono">{spatialTrait.heading}°</span></div>
              {spatialTrait.bbox && <div className="prop-row"><span className="prop-key">BBox</span><span className="prop-val mono">[{spatialTrait.bbox.join(', ')}]</span></div>}
              {spatialTrait.projection && <div className="prop-row"><span className="prop-key">Proj</span><span className="prop-val mono">{spatialTrait.projection}</span></div>}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['lat','lng','alt','heading'] as const).map(field => (
              <label key={field} style={{ display: 'block' }}>
                <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>{field.toUpperCase()}</span>
                <input type="number" step="any" value={(editSpatial as any)[field]}
                  onChange={e => setEditSpatial(prev => ({ ...prev!, [field]: parseFloat(e.target.value) || 0 }))}
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
              </label>
            ))}
          </div>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>BOUNDING BOX [W, S, E, N]</span>
            <input type="text" value={editSpatial.bbox ? editSpatial.bbox.join(', ') : ''}
              onChange={e => {
                const str = e.target.value.trim();
                if (!str) { setEditSpatial(prev => ({ ...prev!, bbox: null })); return; }
                const parts = str.split(',').map(s => parseFloat(s.trim()));
                if (parts.length === 4 && parts.every(p => !isNaN(p))) setEditSpatial(prev => ({ ...prev!, bbox: parts }));
              }}
              placeholder="e.g. -122.5, 37.7, -122.4, 37.8"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>PROJECTION</span>
            <input type="text" value={editSpatial.projection}
              onChange={e => setEditSpatial(prev => ({ ...prev!, projection: e.target.value }))}
              placeholder="e.g. EPSG:4326"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
          </label>
          {spatialError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '2px 0 0' }}>{spatialError}</p>}
        </div>
      )}

      {/* Temporal */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Temporal</span>
        {editTemporal == null
          ? <button onClick={startEditTemporal} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}><Pencil size={11} style={{ marginRight: 3 }} /> {temporalTrait ? 'Edit' : 'Add'}</button>
          : <span style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveTemp} style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Save</button>
              <button onClick={() => { setEditTemporal(null); setTempError(''); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>Cancel</button>
            </span>
        }
      </div>
      {editTemporal == null ? (
        <div style={{ fontSize: 11, color: 'var(--text-hint)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!temporalTrait ? <span>No temporal data</span> : (
            <>
              {temporalTrait.event_at  && <div className="prop-row"><span className="prop-key">At</span><span className="prop-val mono">{temporalTrait.event_at}</span></div>}
              {temporalTrait.starts_at && <div className="prop-row"><span className="prop-key">Start</span><span className="prop-val mono">{temporalTrait.starts_at}</span></div>}
              {temporalTrait.ends_at   && <div className="prop-row"><span className="prop-key">End</span><span className="prop-val mono">{temporalTrait.ends_at}</span></div>}
              {temporalTrait.recurrence && <div className="prop-row"><span className="prop-key">Recurrence</span><span className="prop-val mono">{temporalTrait.recurrence}</span></div>}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>EVENT AT</span>
            <input type="text" value={editTemporal.event_at ?? ''} placeholder="e.g. 1789-07-14 or -3300-01-01"
              onChange={e => setEditTemporal(prev => ({ ...prev!, event_at: e.target.value || null }))}
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>STARTS AT</span>
              <input type="text" value={editTemporal.starts_at ?? ''} placeholder="Start date"
                onChange={e => setEditTemporal(prev => ({ ...prev!, starts_at: e.target.value || null }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>ENDS AT</span>
              <input type="text" value={editTemporal.ends_at ?? ''} placeholder="End date"
                onChange={e => setEditTemporal(prev => ({ ...prev!, ends_at: e.target.value || null }))}
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
            </label>
          </div>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', display: 'block', marginBottom: 2 }}>RECURRENCE (RRULE)</span>
            <input type="text" value={editTemporal.recurrence ?? ''}
              onChange={e => setEditTemporal(prev => ({ ...prev!, recurrence: e.target.value || null }))}
              placeholder="e.g. FREQ=YEARLY"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
          </label>
          {tempError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '2px 0 0' }}>{tempError}</p>}
        </div>
      )}

      {/* Tables */}
      <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Tables ({ownTableTraits.length})</span>
      </div>
      {ownTableTraits.length === 0 ? (
        <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>No tables</span>
      ) : ownTableTraits.map((t: TableTrait) => (
        <div key={t.id} style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{t.namespace}</span>
            <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{t.columns.length} cols · {t.rows.length} rows</span>
            <button onClick={() => deleteTableTrait(t.id)} title="Delete table"
              style={{ background: 'none', border: '1px solid rgba(255,107,107,0.3)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer', color: '#ff6b6b', display: 'flex', alignItems: 'center' }}>
              <X size={11} />
            </button>
          </div>
          {t.columns.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-hint)', marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {t.columns.map(c => `${c.name}:${c.data_type}`).join(', ')}
            </div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <input value={newTableNs} onChange={e => setNewTableNs(e.target.value)} placeholder="namespace (e.g. roster)"
          style={{ width: 110, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }} />
        <input value={newTableCols} onChange={e => setNewTableCols(e.target.value)} placeholder="cols, comma-separated"
          style={{ flex: 1, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 4, padding: '4px 7px', color: 'var(--text-primary)', fontSize: 11, outline: 'none' }}
          onKeyDown={e => e.key === 'Enter' && addTable()} />
        <button onClick={addTable} disabled={!newTableNs.trim()}
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: !newTableNs.trim() ? 'not-allowed' : 'pointer', color: '#fff', fontSize: 11, opacity: !newTableNs.trim() ? 0.5 : 1 }}>+</button>
      </div>
      {tableError && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '4px 0 0' }}>{tableError}</p>}

      {showRelate && <RelateDialog sourceEntityId={selected.id} sourceLabel={selected.label} onClose={() => setShowRelate(false)} />}

      {/* Editor */}
      {blobTrait && blobSourcePath && (
      <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-hint)', letterSpacing: '0.07em' }}>Editor</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {blobTrait && blobSourcePath && (
            <button onClick={onOpenExternal}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>
              Open Externally
            </button>
          )}
        </div>
      </div>
      )}
    </div>
  );
});

// ── Top-level export: routes single vs multi-select ───────────────────────────
export const EntityInspectorPanel = memo(function EntityInspectorPanel() {
  const selectedIds = useOsStore(selectSelectedIds);
  return (
    <div className="panel viewport-panel" style={{ height: '100%', overflow: 'auto' }}>
      <div className="panel-body" style={{ padding: 12 }}>
        {selectedIds.length > 1 ? <SelectionPanel /> : <SingleInspector />}
      </div>
    </div>
  );
});
