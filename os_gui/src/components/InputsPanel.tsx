import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  File,
  Folder,
  FolderTree,
  Trash2,
  Upload,
} from 'lucide-react';
import { useOsStore } from '../store';
import type { DraftSpatialTrait, DraftTemporalTrait, ImportSourceDraft, InputDraft, InputJobStage, PathCompletion } from '../models';

const IMPORT_STAGES: Array<{ id: InputJobStage; label: string }> = [
  { id: 'queued', label: 'Queued' },
  { id: 'inspecting', label: 'Inspecting' },
  { id: 'storing_blob', label: 'Storing blob' },
  { id: 'creating_entity', label: 'Creating entity' },
  { id: 'attaching_blob_trait', label: 'Attaching blob trait' },
  { id: 'ready', label: 'Ready' },
];

const CREATE_STAGES: Array<{ id: InputJobStage; label: string }> = [
  { id: 'creating_entity', label: 'Creating entity' },
  { id: 'ready', label: 'Ready' },
];

const CATEGORY_OPTIONS = [
  { id: 'physical', label: 'Physical' },
  { id: 'digital', label: 'Digital' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'persona', label: 'Persona' },
];

const EMPTY_SPATIAL_TRAIT: DraftSpatialTrait = {
  lat: 0,
  lng: 0,
  alt: 0,
  heading: 0,
  bbox: null,
  projection: 'EPSG:4326',
};

const EMPTY_TEMPORAL_TRAIT: DraftTemporalTrait = {
  event_at: null,
  starts_at: null,
  ends_at: null,
  recurrence: null,
};

function stageItems(draft: InputDraft) {
  const hasBlobSource = Boolean(draft.blobAttachment || draft.sourcePath || draft.fileName || draft.bytes);
  return draft.kind === 'create' && !hasBlobSource ? CREATE_STAGES : IMPORT_STAGES;
}

function statusDotColor(stage: InputJobStage): string {
  switch (stage) {
    case 'draft':
      return '#f5d060';
    case 'queued':
    case 'inspecting':
    case 'storing_blob':
    case 'creating_entity':
    case 'attaching_blob_trait':
      return 'var(--accent)';
    case 'ready':
      return '#5dc97e';
    case 'error':
      return '#ff6b6b';
  }
}

function statusBadgeStyle(stage: InputJobStage): { background: string; color: string; border: string } {
  switch (stage) {
    case 'draft':
      return {
        background: 'rgba(245, 208, 96, 0.18)',
        color: '#f5d060',
        border: '1px solid rgba(245, 208, 96, 0.34)',
      };
    case 'queued':
    case 'inspecting':
    case 'storing_blob':
    case 'creating_entity':
    case 'attaching_blob_trait':
      return {
        background: 'rgba(91,138,240,0.14)',
        color: 'var(--accent)',
        border: '1px solid rgba(91,138,240,0.28)',
      };
    case 'ready':
      return {
        background: 'rgba(93, 201, 126, 0.14)',
        color: '#5dc97e',
        border: '1px solid rgba(93, 201, 126, 0.28)',
      };
    case 'error':
      return {
        background: 'rgba(255,107,107,0.12)',
        color: '#ff6b6b',
        border: '1px solid rgba(255,107,107,0.24)',
      };
  }
}

function stageState(current: InputJobStage, target: InputJobStage): 'waiting' | 'active' | 'done' | 'error' {
  if (current === 'error') return target === 'ready' ? 'waiting' : 'error';
  const stages = ['draft', 'queued', 'inspecting', 'storing_blob', 'creating_entity', 'attaching_blob_trait', 'ready'];
  const currentIdx = stages.indexOf(current);
  const targetIdx = stages.indexOf(target);
  if (current === target) return 'active';
  if (currentIdx > targetIdx) return 'done';
  return 'waiting';
}

function TraitToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(91,138,240,0.14)' : 'none',
        color: active ? 'var(--accent)' : 'var(--text-hint)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 999,
        padding: '6px 10px',
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {active ? `Remove ${label}` : `Add ${label}`}
    </button>
  );
}

function TraitSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--bg)',
      padding: 10,
      display: 'grid',
      gap: 8,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function CategoryAutocomplete({
  value,
  onChange,
}: {
  value: InputDraft['category'];
  onChange: (category: InputDraft['category']) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(CATEGORY_OPTIONS.find(option => option.id === value)?.label ?? value);

  useEffect(() => {
    setQuery(CATEGORY_OPTIONS.find(option => option.id === value)?.label ?? value);
  }, [value]);

  const filtered = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    if (!lowered) return CATEGORY_OPTIONS;
    return CATEGORY_OPTIONS.filter(option =>
      option.label.toLowerCase().includes(lowered) || option.id.includes(lowered),
    );
  }, [query]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        placeholder="Category"
        onChange={e => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
        style={{
          width: '100%',
          minHeight: 36,
          background: 'var(--bg-primary)',
          border: '1px solid var(--accent)',
          color: 'var(--text-primary)',
          padding: '8px 10px',
          borderRadius: 6,
          outline: 'none',
          fontSize: 13,
        }}
      />
      {isOpen && filtered.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 40,
          left: 0,
          right: 0,
          maxHeight: 220,
          overflowY: 'auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          zIndex: 300,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {filtered.map(option => (
            <div
              key={option.id}
              onMouseDown={() => {
                onChange(option.id as InputDraft['category']);
                setQuery(option.label);
                setIsOpen(false);
              }}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
                color: 'var(--text-primary)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}
              onMouseEnter={event => (event.currentTarget.style.background = 'var(--bg-primary)')}
              onMouseLeave={event => (event.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>{option.id}</span>
              <span>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftEditor({ draft }: { draft: InputDraft }) {
  const updateInputDraft = useOsStore(s => s.updateInputDraft);
  const submitInputDraft = useOsStore(s => s.submitInputDraft);
  const setActiveActivity = useOsStore(s => s.setActiveActivity);
  const setSidePanelOpen = useOsStore(s => s.setSidePanelOpen);
  const selectEntity = useOsStore(s => s.selectEntity);
  const [copied, setCopied] = useState(false);

  const stages = stageItems(draft);
  const busy = !['draft', 'ready', 'error'].includes(draft.stage);
  const hasBlobSource = Boolean(draft.blobAttachment || draft.sourcePath || draft.fileName || draft.bytes);

  async function handlePickBlobTrait() {
    const paths = await invoke<string[]>('pick_native_import_files');
    const path = paths[0];
    if (!path) return;
    const sources = await invoke<ImportSourceDraft[]>('expand_import_sources', { paths: [path] });
    const source = sources[0];
    if (!source) return;
    updateInputDraft(draft.jobId, {
      sourcePath: source.sourcePath,
      fileName: source.fileName,
      mime: undefined,
      size: undefined,
      blobAttachment: {
        fileName: source.fileName,
        bytes: [],
        size: 0,
        sourcePath: source.sourcePath,
      },
      label: draft.label.trim() ? draft.label : source.label,
    });
  }

  return (
    <div style={{ padding: '10px 12px 12px', display: 'grid', gap: 10, borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
      <label style={{ display: 'grid', gap: 5 }}>
        <span style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Label</span>
        <input
          value={draft.label}
          onChange={e => updateInputDraft(draft.jobId, { label: e.target.value })}
          placeholder={draft.kind === 'create' ? 'Entity label…' : 'Imported asset label…'}
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
            color: 'var(--text-primary)',
            fontSize: 13,
            outline: 'none',
          }}
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</span>
          <CategoryAutocomplete
            value={draft.category}
            onChange={category => updateInputDraft(draft.jobId, { category })}
          />
        </label>

        <div style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source</span>
          <div style={{
            minHeight: 36,
            display: 'flex',
            alignItems: 'center',
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg)',
            fontSize: 12,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {draft.kind === 'create'
              ? (draft.fileName ?? draft.sourcePath ?? draft.blobAttachment?.fileName ?? 'Empty entity')
              : draft.sourcePath ?? draft.fileName ?? 'Imported file'}
          </div>
        </div>
      </div>

      {(draft.kind === 'import' || hasBlobSource) && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-hint)' }}>
          <span>MIME: {draft.kind === 'import' ? (draft.mime || 'detected on import') : (draft.mime || draft.blobAttachment?.mime || 'picked file')}</span>
          <span>Size: {(draft.kind === 'import' ? draft.size : (draft.size ?? draft.blobAttachment?.size)) == null ? 'unknown' : `${(draft.kind === 'import' ? draft.size : (draft.size ?? draft.blobAttachment?.size))!.toLocaleString()} B`}</span>
        </div>
      )}

      {draft.tagLabels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {draft.tagLabels.map(tag => (
            <span key={tag} style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'rgba(245, 208, 96, 0.12)',
              color: '#f5d060',
              border: '1px solid rgba(245, 208, 96, 0.24)',
            }}>
              tag:{tag}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {draft.kind === 'create' && (
          <TraitToggle
            active={hasBlobSource}
            label="blob trait"
            onClick={() => {
              if (hasBlobSource) {
                updateInputDraft(draft.jobId, {
                  blobAttachment: null,
                  sourcePath: undefined,
                  fileName: undefined,
                  mime: undefined,
                  size: undefined,
                  bytes: undefined,
                });
              } else {
                void handlePickBlobTrait();
              }
            }}
          />
        )}
        <TraitToggle
          active={draft.spatialTrait !== null}
          label="spatial trait"
          onClick={() => updateInputDraft(draft.jobId, {
            spatialTrait: draft.spatialTrait ? null : { ...EMPTY_SPATIAL_TRAIT },
          })}
        />
        <TraitToggle
          active={draft.temporalTrait !== null}
          label="temporal trait"
          onClick={() => updateInputDraft(draft.jobId, {
            temporalTrait: draft.temporalTrait ? null : { ...EMPTY_TEMPORAL_TRAIT },
          })}
        />
      </div>

      {draft.spatialTrait && (
        <TraitSection title="Spatial trait">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            {(['lat', 'lng', 'alt', 'heading'] as const).map(field => (
              <label key={field} style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>{field}</span>
                <input
                  type="number"
                  step="any"
                  value={draft.spatialTrait?.[field] ?? 0}
                  onChange={e => updateInputDraft(draft.jobId, {
                    spatialTrait: {
                      ...(draft.spatialTrait ?? EMPTY_SPATIAL_TRAIT),
                      [field]: Number.parseFloat(e.target.value) || 0,
                    },
                  })}
                  style={{
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '7px 9px',
                    color: 'var(--text-primary)',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              </label>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>Bounding box</span>
              <input
                type="text"
                value={draft.spatialTrait?.bbox ? draft.spatialTrait.bbox.join(', ') : ''}
                placeholder="-122.5, 37.7, -122.4, 37.8"
                onChange={e => {
                  const value = e.target.value.trim();
                  if (!value) {
                    updateInputDraft(draft.jobId, {
                      spatialTrait: { ...(draft.spatialTrait ?? EMPTY_SPATIAL_TRAIT), bbox: null },
                    });
                    return;
                  }
                  const parts = value.split(',').map(part => Number.parseFloat(part.trim()));
                  if (parts.length === 4 && parts.every(part => !Number.isNaN(part))) {
                    updateInputDraft(draft.jobId, {
                      spatialTrait: { ...(draft.spatialTrait ?? EMPTY_SPATIAL_TRAIT), bbox: parts },
                    });
                  }
                }}
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '7px 9px',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>Projection</span>
              <input
                type="text"
                value={draft.spatialTrait.projection}
                onChange={e => updateInputDraft(draft.jobId, {
                  spatialTrait: { ...(draft.spatialTrait ?? EMPTY_SPATIAL_TRAIT), projection: e.target.value },
                })}
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '7px 9px',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
            </label>
          </div>
        </TraitSection>
      )}

      {draft.temporalTrait && (
        <TraitSection title="Temporal trait">
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>Event at</span>
            <input
              type="text"
              value={draft.temporalTrait.event_at ?? ''}
              placeholder="1789-07-14"
              onChange={e => updateInputDraft(draft.jobId, {
                temporalTrait: { ...(draft.temporalTrait ?? EMPTY_TEMPORAL_TRAIT), event_at: e.target.value || null },
              })}
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '7px 9px',
                color: 'var(--text-primary)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>Starts at</span>
              <input
                type="text"
                value={draft.temporalTrait.starts_at ?? ''}
                onChange={e => updateInputDraft(draft.jobId, {
                  temporalTrait: { ...(draft.temporalTrait ?? EMPTY_TEMPORAL_TRAIT), starts_at: e.target.value || null },
                })}
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '7px 9px',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>Ends at</span>
              <input
                type="text"
                value={draft.temporalTrait.ends_at ?? ''}
                onChange={e => updateInputDraft(draft.jobId, {
                  temporalTrait: { ...(draft.temporalTrait ?? EMPTY_TEMPORAL_TRAIT), ends_at: e.target.value || null },
                })}
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '7px 9px',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase' }}>Recurrence</span>
            <input
              type="text"
              value={draft.temporalTrait.recurrence ?? ''}
              placeholder="FREQ=YEARLY"
              onChange={e => updateInputDraft(draft.jobId, {
                temporalTrait: { ...(draft.temporalTrait ?? EMPTY_TEMPORAL_TRAIT), recurrence: e.target.value || null },
              })}
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '7px 9px',
                color: 'var(--text-primary)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          </label>
        </TraitSection>
      )}

      <div style={{ fontSize: 12, color: draft.stage === 'error' ? '#ff6b6b' : 'var(--text-hint)' }}>
        {draft.error ?? draft.progressMessage}
      </div>

      <div style={{ display: 'grid', gap: 8, padding: '4px 0' }}>
        {stages.map(stage => {
          const state = stageState(draft.stage, stage.id);
          const color = state === 'done'
            ? 'var(--accent)'
            : state === 'active'
              ? 'var(--text-primary)'
              : state === 'error'
                ? '#ff6b6b'
                : 'var(--text-hint)';
          return (
            <div key={stage.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                background: state === 'waiting' ? 'transparent' : color,
                border: `1px solid ${color}`,
              }} />
              <div style={{ fontSize: 12, color }}>{stage.label}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          onClick={() => submitInputDraft(draft.jobId)}
          disabled={busy}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Working…' : draft.kind === 'create' ? 'Create' : 'Import'}
        </button>

        {draft.entityId && (
          <>
            <button
              onClick={() => {
                setActiveActivity('graph');
                setSidePanelOpen(true);
                selectEntity(draft.entityId!);
              }}
              style={{
                background: 'none',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Reveal in Graph
            </button>
            <button
              onClick={() => {
                const { setEditionEntity, setActiveActivity } = useOsStore.getState();
                setEditionEntity(draft.entityId!);
                setActiveActivity('edition');
              }}
              style={{
                background: 'none',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Open in Editor
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(draft.entityId!);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              }}
              style={{
                background: 'none',
                color: copied ? 'var(--accent)' : 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {copied ? 'Copied' : 'Copy ULID'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DraftRow({ draft }: { draft: InputDraft }) {
  const toggleInputDraftExpanded = useOsStore(s => s.toggleInputDraftExpanded);
  const removeInputDraft = useOsStore(s => s.removeInputDraft);
  const toggleSelectedInputDraft = useOsStore(s => s.toggleSelectedInputDraft);
  const selected = useOsStore(s => s.selectedInputDraftIds.includes(draft.jobId));

  const badge = statusBadgeStyle(draft.stage);
  const dot = statusDotColor(draft.stage);
  const title = draft.kind === 'create'
    ? (draft.label.trim() || 'New entity')
    : (draft.fileName ?? (draft.label || 'Imported file'));

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 6,
      background: draft.expanded ? 'var(--bg-panel)' : 'transparent',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => toggleInputDraftExpanded(draft.jobId)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          cursor: 'pointer',
          background: selected ? 'rgba(91,138,240,0.08)' : 'transparent',
        }}
      >
        <button
          onClick={event => {
            event.stopPropagation();
            toggleSelectedInputDraft(draft.jobId);
          }}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: selected ? 'var(--accent)' : 'var(--text-hint)',
            display: 'flex',
            alignItems: 'center',
          }}
          title={selected ? 'Deselect' : 'Select'}
        >
          {selected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
        </button>
        {draft.expanded ? <ChevronDown size={13} color="var(--text-hint)" /> : <ChevronRight size={13} color="var(--text-hint)" />}
        <div style={{ width: 8, height: 8, borderRadius: 999, background: dot, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        <span style={{
          fontSize: 10,
          padding: '2px 7px',
          borderRadius: 999,
          background: badge.background,
          color: badge.color,
          border: badge.border,
          textTransform: 'capitalize',
          flexShrink: 0,
        }}>
          {draft.stage.replace(/_/g, ' ')}
        </span>
        <button
          onClick={event => {
            event.stopPropagation();
            removeInputDraft(draft.jobId);
          }}
          title="Remove draft"
          style={{ background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {draft.expanded && <DraftEditor draft={draft} />}
    </div>
  );
}

export function NewEntitiesForm() {
  const inputDrafts = useOsStore(s => s.inputDrafts);
  const inputPickerRequestToken = useOsStore(s => s.inputPickerRequestToken);
  const addCreateInputDraft = useOsStore(s => s.addCreateInputDraft);
  const addImportDraftsFromSources = useOsStore(s => s.addImportDraftsFromSources);
  const [dropHint, setDropHint] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [pathCompletions, setPathCompletions] = useState<PathCompletion[]>([]);
  const [pathFocused, setPathFocused] = useState(false);
  const [activePathCompletionIdx, setActivePathCompletionIdx] = useState(0);

  useEffect(() => {
    if (inputPickerRequestToken > 0) {
      void handleNativeFilePick();
    }
  }, [inputPickerRequestToken]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    appWindow.onDragDropEvent((event) => {
      if (event.payload.type === 'enter') {
        setDropHint(true);
      } else if (event.payload.type === 'leave') {
        setDropHint(false);
      } else if (event.payload.type === 'drop') {
        setDropHint(false);
        void addExpandedSources(event.payload.paths);
      }
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    const trimmed = pathInput.trim();
    if (!trimmed || !pathFocused) {
      setPathCompletions([]);
      setActivePathCompletionIdx(0);
      return;
    }
    const handle = window.setTimeout(() => {
      void invoke<PathCompletion[]>('complete_input_path', { prefix: trimmed })
        .then(completions => {
          setPathCompletions(completions);
          setActivePathCompletionIdx(0);
        })
        .catch(() => {
          setPathCompletions([]);
          setActivePathCompletionIdx(0);
        });
    }, 120);
    return () => window.clearTimeout(handle);
  }, [pathInput, pathFocused]);

  async function addExpandedSources(paths: string[]) {
    if (paths.length === 0) return;
    const sources = await invoke<ImportSourceDraft[]>('expand_import_sources', { paths });
    if (sources.length > 0) addImportDraftsFromSources(sources);
  }

  async function handleNativeFilePick() {
    const paths = await invoke<string[]>('pick_native_import_files');
    await addExpandedSources(paths);
  }

  async function handleNativeDirectoryPick() {
    const path = await invoke<string | null>('pick_native_import_directory');
    if (path) await addExpandedSources([path]);
  }

  async function handlePathAdd(nextPath?: string) {
    const trimmed = (nextPath ?? pathInput).trim();
    if (!trimmed) return;
    await addExpandedSources([trimmed]);
    setPathInput('');
    setPathCompletions([]);
    setActivePathCompletionIdx(0);
  }

  function applyCompletion(index: number) {
    const completion = pathCompletions[index];
    if (!completion) return;
    setPathInput(completion.path);
    setActivePathCompletionIdx(index);
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <ArrowDownToLine size={12} />
          New Entities
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>
          {inputDrafts.length} drafts
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            onClick={() => addCreateInputDraft()}
            style={{
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            New entity
          </button>
          <button
            onClick={() => void handleNativeFilePick()}
            style={{
              background: 'none',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Upload size={13} />
            Files
          </button>
          <button
            onClick={() => void handleNativeDirectoryPick()}
            style={{
              background: 'none',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <FolderTree size={13} />
            Directory
          </button>
          <div style={{
            fontSize: 12,
            color: dropHint ? 'var(--accent)' : 'var(--text-hint)',
            display: 'flex',
            alignItems: 'center',
          }}>
            {dropHint ? 'Drop files or directories to add drafts' : 'Or drag files and directories into the window'}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Path
          </span>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={pathInput}
              placeholder="./assets/report.pdf or /data/archive"
              onChange={e => setPathInput(e.target.value)}
              onFocus={() => setPathFocused(true)}
              onBlur={() => window.setTimeout(() => setPathFocused(false), 150)}
              onKeyDown={e => {
                if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && pathCompletions.length > 0) {
                  e.preventDefault();
                  setActivePathCompletionIdx(current => {
                    const delta = e.key === 'ArrowDown' ? 1 : -1;
                    const next = (current + delta + pathCompletions.length) % pathCompletions.length;
                    return next;
                  });
                  return;
                }
                if (e.key === 'Tab' && pathCompletions.length > 0) {
                  e.preventDefault();
                  applyCompletion(activePathCompletionIdx);
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  let selectedPath: string | undefined = pathCompletions[activePathCompletionIdx]?.path;
                  if (pathCompletions.length > 0) {
                    applyCompletion(activePathCompletionIdx);
                  } else {
                    selectedPath = undefined;
                  }
                  void handlePathAdd(selectedPath);
                }
              }}
              style={{
                width: '100%',
                background: 'var(--bg-primary)',
                border: '1px solid var(--accent)',
                color: 'var(--text-primary)',
                padding: '8px 10px',
                borderRadius: 6,
                outline: 'none',
                fontSize: 13,
              }}
            />
            {pathFocused && pathCompletions.length > 0 && (
              <div style={{
                position: 'absolute',
                top: 40,
                left: 0,
                right: 0,
                maxHeight: 220,
                overflowY: 'auto',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                zIndex: 300,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}>
                {pathCompletions.map((completion, index) => (
                  <div
                    key={completion.path}
                    onMouseDown={() => {
                      applyCompletion(index);
                      setPathFocused(false);
                    }}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                      color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: index === activePathCompletionIdx ? 'var(--bg-primary)' : 'transparent',
                    }}
                    onMouseEnter={() => setActivePathCompletionIdx(index)}
                  >
                      {completion.is_dir ? <Folder size={12} color="var(--text-hint)" /> : <File size={12} color="var(--text-hint)" />}
                      <span>{completion.display}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>
              Type an absolute or relative path. Directories expand recursively and tag all resulting entities with the directory name.
            </div>
            <button
              onClick={() => void handlePathAdd()}
              style={{
                background: 'none',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InputsPanel() {
  const inputDrafts = useOsStore(s => s.inputDrafts);
  const selectedInputDraftIds = useOsStore(s => s.selectedInputDraftIds);
  const setSelectedInputDraftIds = useOsStore(s => s.setSelectedInputDraftIds);
  const submitInputDraft = useOsStore(s => s.submitInputDraft);
  const clearInputDrafts = useOsStore(s => s.clearInputDrafts);
  const setAllInputDraftsExpanded = useOsStore(s => s.setAllInputDraftsExpanded);

  const allExpanded = inputDrafts.length > 0 && inputDrafts.every(d => d.expanded);

  const editableCount = useMemo(
    () => inputDrafts.filter(d => ['draft', 'error'].includes(d.stage)).length,
    [inputDrafts],
  );

  async function handleRunSelected() {
    for (const draft of inputDrafts) {
      if (!selectedInputDraftIds.includes(draft.jobId)) continue;
      if (!['draft', 'error'].includes(draft.stage)) continue;
      await submitInputDraft(draft.jobId);
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      overflow: 'auto',
      minHeight: 0,
      padding: 12,
      background: 'var(--bg-secondary)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '0 2px',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>
          {inputDrafts.length} drafts · {editableCount} editable · {selectedInputDraftIds.length} selected
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setAllInputDraftsExpanded(!allExpanded)}
            disabled={inputDrafts.length === 0}
            title={allExpanded ? 'Collapse all' : 'Expand all'}
            style={{
              background: 'none',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 11,
              cursor: inputDrafts.length === 0 ? 'default' : 'pointer',
              opacity: inputDrafts.length === 0 ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <button
            onClick={() => setSelectedInputDraftIds(inputDrafts.map(d => d.jobId))}
            disabled={inputDrafts.length === 0}
            style={{
              background: 'none',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              cursor: inputDrafts.length === 0 ? 'default' : 'pointer',
              opacity: inputDrafts.length === 0 ? 0.5 : 1,
            }}
          >
            Select all
          </button>
          <button
            onClick={() => setSelectedInputDraftIds([])}
            disabled={selectedInputDraftIds.length === 0}
            style={{
              background: 'none',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              cursor: selectedInputDraftIds.length === 0 ? 'default' : 'pointer',
              opacity: selectedInputDraftIds.length === 0 ? 0.5 : 1,
            }}
          >
            Clear
          </button>
          <button
            onClick={() => void handleRunSelected()}
            disabled={selectedInputDraftIds.length === 0}
            style={{
              background: selectedInputDraftIds.length === 0 ? 'var(--bg-secondary)' : 'var(--accent)',
              color: selectedInputDraftIds.length === 0 ? 'var(--text-hint)' : '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 700,
              cursor: selectedInputDraftIds.length === 0 ? 'default' : 'pointer',
            }}
          >
            Run selected
          </button>
          <button
            onClick={() => clearInputDrafts()}
            disabled={inputDrafts.length === 0}
            style={{
              background: 'none',
              color: '#ff6b6b',
              border: '1px solid rgba(255,107,107,0.24)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              cursor: inputDrafts.length === 0 ? 'default' : 'pointer',
              opacity: inputDrafts.length === 0 ? 0.5 : 1,
            }}
          >
            Remove all
          </button>
        </div>
      </div>

      {inputDrafts.length === 0 ? (
        <div style={{
          border: '1px dashed var(--border)',
          borderRadius: 10,
          padding: 16,
          color: 'var(--text-hint)',
          fontSize: 12,
          background: 'var(--bg-panel)',
        }}>
          Use the side panel to add a new entity or pick files. Drafts will appear here as a compact list.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 4 }}>
          {inputDrafts.map(draft => (
            <DraftRow key={draft.jobId} draft={draft} />
          ))}
        </div>
      )}
    </div>
  );
}
