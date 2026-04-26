import { useState } from 'react';
import { CheckCircle2, Circle, FileCode } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useOsStore } from '../store';
import type { InputJobStage } from '../models';
import { StoreStatePanel } from './StoreStatePanel';

function statusColor(stage: InputJobStage): string {
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

export function InputsSidePanel() {
  const inputDrafts = useOsStore(s => s.inputDrafts);
  const selectedInputDraftIds = useOsStore(s => s.selectedInputDraftIds);
  const toggleSelectedInputDraft = useOsStore(s => s.toggleSelectedInputDraft);
  const toggleInputDraftExpanded = useOsStore(s => s.toggleInputDraftExpanded);
  const setSelectedInputDraftIds = useOsStore(s => s.setSelectedInputDraftIds);
  const clearInputDrafts = useOsStore(s => s.clearInputDrafts);
  const submitInputDraft = useOsStore(s => s.submitInputDraft);

  const editableDrafts = inputDrafts.filter(draft => ['draft', 'error'].includes(draft.stage));

  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  async function importPrologSnapshot() {
    if (snapshotBusy) return;
    const picked = await invoke<string | null>('pick_prolog_snapshot_file');
    if (!picked) return;
    setSnapshotBusy(true);
    setSnapshotStatus('Importing snapshot…');
    try {
      const summary = await invoke<{ entities: number; edges: number; blobs: number }>(
        'import_prolog_snapshot',
        { plPath: picked },
      );
      setSnapshotStatus(
        `Imported ${summary.entities} entities, ${summary.edges} edges, ${summary.blobs} blobs.`,
      );
    } catch (err) {
      setSnapshotStatus(`Import failed: ${err}`);
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function handleSubmitSelected() {
    for (const draft of inputDrafts) {
      if (!selectedInputDraftIds.includes(draft.jobId)) continue;
      if (!['draft', 'error'].includes(draft.stage)) continue;
      await submitInputDraft(draft.jobId);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ borderBottom: '1px solid var(--border)' }}>
        <StoreStatePanel embedded />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Prolog Snapshot
          </div>
          <button
            onClick={() => void importPrologSnapshot()}
            disabled={snapshotBusy}
            style={{
              width: '100%',
              background: snapshotBusy ? 'var(--bg-secondary)' : 'none',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 11,
              cursor: snapshotBusy ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <FileCode size={13} />
            {snapshotBusy ? 'Importing…' : 'Import .pl Snapshot'}
          </button>
          {snapshotStatus && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>
              {snapshotStatus}
            </div>
          )}
        </div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Draft Queue
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>
            {editableDrafts.length} editable, {selectedInputDraftIds.length} selected
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <button
              onClick={() => setSelectedInputDraftIds(inputDrafts.map(draft => draft.jobId))}
              style={{
                background: 'none',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Select all
            </button>
            <button
              onClick={() => setSelectedInputDraftIds([])}
              style={{
                background: 'none',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              onClick={() => void handleSubmitSelected()}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Run selected
            </button>
            <button
              onClick={() => clearInputDrafts()}
              style={{
                background: 'none',
                color: '#ff6b6b',
                border: '1px solid rgba(255,107,107,0.24)',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Remove all
            </button>
          </div>
        </div>
        {inputDrafts.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-hint)' }}>
            No drafts yet.
          </div>
        ) : (
          inputDrafts.map(draft => {
            const selected = selectedInputDraftIds.includes(draft.jobId);
            return (
              <div
                key={draft.jobId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border)',
                  background: selected ? 'rgba(91,138,240,0.08)' : 'transparent',
                  cursor: 'pointer',
                }}
                onClick={() => toggleInputDraftExpanded(draft.jobId)}
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
                >
                  {selected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                </button>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: statusColor(draft.stage), flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {draft.kind === 'create' ? 'New entity' : (draft.fileName ?? draft.label)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'capitalize' }}>
                    {draft.stage.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
