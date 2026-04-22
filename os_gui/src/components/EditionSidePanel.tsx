import { useRef, useState } from 'react';
import { FileText, File, Plus, Check, X, Trash2, Pencil } from 'lucide-react';
import { useOsStore, resolvedLabel } from '../store';

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/yaml' ||
    mime === 'application/x-yaml' ||
    mime === 'application/x-prolog'
  );
}

// ── Document list ─────────────────────────────────────────────────────────────

function toSnakeCase(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function BlobRow({ blobId, label, isText, existingNames }: {
  blobId: string; label: string; isText: boolean; existingNames: Set<string>;
}) {
  const editionDocKey   = useOsStore(s => s.editionDocKey);
  const setEditionDoc   = useOsStore(s => s.setEditionDoc);
  const deleteBlobTrait = useOsStore(s => s.deleteBlobTrait);
  const renameBlobTrait = useOsStore(s => s.renameBlobTrait);

  const [renaming, setRenaming]     = useState(false);
  const [renameVal, setRenameVal]   = useState('');
  const [saving, setSaving]         = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const active = editionDocKey === blobId;

  function startRename(e: React.MouseEvent) {
    e.stopPropagation();
    setRenameVal(label);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 30);
  }

  async function commitRename() {
    const next = renameVal.trim();
    if (!next || next === label || existingNames.has(next)) { setRenaming(false); return; }
    setSaving(true);
    try { await renameBlobTrait(blobId, next); }
    finally { setSaving(false); setRenaming(false); }
  }

  if (renaming) {
    const conflict = renameVal.trim() !== '' && renameVal.trim() !== label && existingNames.has(renameVal.trim());
    return (
      <div className="edition-notes-form" style={{ marginTop: 2 }}>
        <input
          ref={renameInputRef}
          className={`edition-notes-input${conflict ? ' conflict' : ''}`}
          value={renameVal}
          onChange={e => setRenameVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void commitRename(); if (e.key === 'Escape') setRenaming(false); }}
        />
        <button className="edition-notes-confirm" onClick={commitRename}
          disabled={saving || conflict || !renameVal.trim()} title="Rename">
          <Check size={11} />
        </button>
        <button className="edition-notes-cancel" onClick={() => setRenaming(false)} title="Cancel">
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`edition-doc-row${active ? ' active' : ''}${!isText ? ' binary' : ''}`}
      onClick={() => setEditionDoc(blobId)}
      title={isText ? label : `${label} → Preview`}
    >
      {isText ? <FileText size={12} style={{ flexShrink: 0 }} /> : <File size={12} style={{ flexShrink: 0, opacity: 0.5 }} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {!isText && <span style={{ fontSize: 10, color: 'var(--text-hint)', flexShrink: 0 }}>Preview</span>}
      <button className="edition-doc-action" title={`Rename ${label}`} onClick={startRename}>
        <Pencil size={10} />
      </button>
      <button className="edition-doc-action" title={`Remove ${label}`}
        onClick={e => { e.stopPropagation(); void deleteBlobTrait(blobId); }}>
        <Trash2 size={10} />
      </button>
    </div>
  );
}

function DocumentList() {
  const selectedEntityId  = useOsStore(s => s.selectedEntityId);
  const editionEntityId   = useOsStore(s => s.editionEntityId);
  const editionDocKey     = useOsStore(s => s.editionDocKey);
  const blobTraits        = useOsStore(s => s.blobTraits);
  const allEntities       = useOsStore(s => s.allEntities);
  const setEditionDoc     = useOsStore(s => s.setEditionDoc);
  const createEntityNotes = useOsStore(s => s.createEntityNotes);

  const [formOpen, setFormOpen] = useState(false);
  const [filename, setFilename] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const effectiveEntityId = selectedEntityId ?? editionEntityId;
  const effectiveDocKey   = effectiveEntityId === editionEntityId ? editionDocKey : 'entity';

  if (!effectiveEntityId) return null;

  const entity     = allEntities.find(e => e.id === effectiveEntityId) ?? null;
  const ownBlobs   = blobTraits.filter(t => t.owner === effectiveEntityId);
  const noteBlobs  = ownBlobs.filter(t => t.mime === 'text/markdown');
  const otherBlobs = ownBlobs.filter(t => t.mime !== 'text/markdown');
  const existingNames = new Set(ownBlobs.map(t => t.filename));

  const defaultName  = entity ? `${toSnakeCase(entity.label)}.md` : 'notes.md';
  const defaultTaken = existingNames.has(defaultName);

  function openForm() {
    setFilename(defaultTaken ? '' : defaultName);
    setFormOpen(true);
    setTimeout(() => inputRef.current?.focus(), 40);
  }

  async function handleCreate() {
    const name = filename.trim();
    if (!effectiveEntityId || creating || !name || existingNames.has(name)) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createEntityNotes(effectiveEntityId, name);
      setFormOpen(false);
      setFilename('');
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  }

  const filenameConflict = filename.trim() !== '' && existingNames.has(filename.trim());
  const createDisabled   = creating || !filename.trim() || filenameConflict;

  // entity.yaml row (no rename/delete)
  const entityActive = effectiveDocKey === 'entity';

  return (
    <div className="edition-section">
      <div className="edition-section-label">
        Documents
        {!formOpen && (
          <button className="edition-section-add-btn" onClick={openForm} title="Add notes file">
            <Plus size={10} />
          </button>
        )}
      </div>

      <div
        className={`edition-doc-row${entityActive ? ' active' : ''}`}
        onClick={() => setEditionDoc('entity')}
      >
        <FileText size={12} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>entity</span>
      </div>

      {noteBlobs.map(b => (
        <BlobRow key={b.id} blobId={b.id} label={b.filename} isText={true} existingNames={existingNames} />
      ))}
      {otherBlobs.map(b => (
        <BlobRow key={b.id} blobId={b.id} label={b.filename} isText={isTextMime(b.mime)} existingNames={existingNames} />
      ))}

      {formOpen && (
        <>
          <div className="edition-notes-form">
            <input
              ref={inputRef}
              className={`edition-notes-input${filenameConflict ? ' conflict' : ''}`}
              value={filename}
              onChange={e => { setFilename(e.target.value); setCreateError(null); }}
              placeholder={defaultTaken ? 'filename.md' : defaultName}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleCreate();
                if (e.key === 'Escape') { setFormOpen(false); setCreateError(null); }
              }}
            />
            <button className="edition-notes-confirm" onClick={() => void handleCreate()}
              disabled={createDisabled}
              title={filenameConflict ? 'Filename already in use' : !filename.trim() ? 'Enter a filename' : 'Create'}>
              <Check size={11} />
            </button>
            <button className="edition-notes-cancel" onClick={() => { setFormOpen(false); setCreateError(null); }} title="Cancel">
              <X size={11} />
            </button>
          </div>
          {createError && (
            <div style={{ fontSize: 10, color: 'var(--error)', marginTop: 2, wordBreak: 'break-all' }}>
              {createError}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Mode + Format toggles ─────────────────────────────────────────────────────

function ModeFormatControls() {
  const editionDocKey    = useOsStore(s => s.editionDocKey);
  const editionMode      = useOsStore(s => s.editionMode);
  const editionFormat    = useOsStore(s => s.editionFormat);
  const setEditionMode   = useOsStore(s => s.setEditionMode);
  const setEditionFormat = useOsStore(s => s.setEditionFormat);

  if (!editionDocKey) return null;

  return (
    <>
      <div className="edition-section">
        <div className="edition-section-label">Mode</div>
        <div className="edition-radio-group">
          <button
            className={`edition-radio-btn${editionMode === 'web' ? ' active' : ''}`}
            onClick={() => setEditionMode('web')}
          >
            Native
          </button>
          <button
            className={`edition-radio-btn${editionMode === 'terminal' ? ' active' : ''}`}
            onClick={() => setEditionMode('terminal')}
          >
            Terminal
          </button>
        </div>
      </div>

      {editionDocKey === 'entity' && (
        <div className="edition-section">
          <div className="edition-section-label">Format</div>
          <div className="edition-radio-group">
            <button
              className={`edition-radio-btn${editionFormat === 'yaml' ? ' active' : ''}`}
              onClick={() => setEditionFormat('yaml')}
            >
              YAML
            </button>
            <button
              className={`edition-radio-btn${editionFormat === 'json' ? ' active' : ''}`}
              onClick={() => setEditionFormat('json')}
            >
              JSON
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Current entity label ──────────────────────────────────────────────────────

function EntityLabel() {
  const selectedEntityId = useOsStore(s => s.selectedEntityId);
  const allEntities      = useOsStore(s => s.allEntities);
  const allLabelTraits   = useOsStore(s => s.allLabelTraits);
  const activeLocale     = useOsStore(s => s.activeLocale);

  if (!selectedEntityId) {
    return (
      <div style={{ padding: '4px 0', color: 'var(--text-hint)', fontSize: 11 }}>
        No entity selected
      </div>
    );
  }

  const entity = allEntities.find(e => e.id === selectedEntityId) ?? null;
  const label  = entity ? resolvedLabel(entity, allLabelTraits, activeLocale) : selectedEntityId;

  return (
    <div style={{
      padding: '4px 6px',
      fontSize: 12,
      color: 'var(--text-primary)',
      background: 'var(--bg-panel)',
      borderRadius: 4,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {entity && <span className={`entity-category-dot cat-${entity.category}`} style={{ marginRight: 5 }} />}
      {label}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function EditionSidePanel() {
  return (
    <div className="edition-side-panel">
      <div className="edition-section">
        <div className="edition-section-label">Entity</div>
        <EntityLabel />
      </div>
      <DocumentList />
      <ModeFormatControls />
    </div>
  );
}
