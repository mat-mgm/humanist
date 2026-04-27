import { useState } from 'react';
import { FileCode } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { StoreStatePanel } from './StoreStatePanel';
import { NewEntitiesForm } from './InputsPanel';

export function InputsSidePanel() {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ padding: '10px 10px 12px', display: 'grid', gap: 10 }}>
          <NewEntitiesForm />
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
            <div style={{ fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>
              {snapshotStatus}
            </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <StoreStatePanel embedded />
        </div>
      </div>
    </div>
  );
}
