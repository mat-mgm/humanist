import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowUpFromLine, FolderOpen, CheckCircle2, AlertCircle } from 'lucide-react';

interface ExportSummary {
  snapshot_path: string;
  entities: number;
  edges: number;
  blobs: number;
}

type Stage =
  | 'idle'
  | 'building_snapshot'
  | 'writing_pl'
  | 'ready'
  | 'error';

export function OutputsSidePanel() {
  const [outDir, setOutDir] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState<ExportSummary | null>(null);

  async function pickDirectory() {
    const picked = await invoke<string | null>('pick_native_import_directory');
    if (picked) setOutDir(picked);
  }

  async function runExport() {
    if (!outDir.trim()) {
      setStage('error');
      setMessage('Choose a destination directory first.');
      return;
    }
    setStage('building_snapshot');
    setMessage('Reading database state…');
    setSummary(null);

    const jobId = `export-${Date.now()}`;
    const unlistenProgress = await listen<{ job_id: string; stage: string; message: string }>(
      'input-job-progress',
      e => {
        if (e.payload.job_id !== jobId) return;
        setStage(e.payload.stage as Stage);
        setMessage(e.payload.message);
      },
    );
    const unlistenFinished = await listen<{ job_id: string; stage: string; message: string; error: string | null }>(
      'input-job-finished',
      e => {
        if (e.payload.job_id !== jobId) return;
        if (e.payload.error) {
          setStage('error');
          setMessage(e.payload.error);
        }
      },
    );

    try {
      const out = await invoke<ExportSummary>('export_prolog_snapshot', {
        outDir: outDir.trim(),
        jobId,
      });
      setSummary(out);
      setStage('ready');
      setMessage(`Wrote ${out.snapshot_path}`);
    } catch (err) {
      setStage('error');
      setMessage(String(err));
    } finally {
      unlistenProgress();
      unlistenFinished();
    }
  }

  const inFlight = stage !== 'idle' && stage !== 'ready' && stage !== 'error';

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          Export target
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 4 }}>
          Prolog Snapshot (.pl + blobs/)
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>
          Writes a deterministic, canonical Prolog fact dump alongside a blobs directory.
          Round-trips losslessly via the Inputs panel.
        </div>
      </div>

      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
          Destination directory
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={outDir}
            onChange={e => setOutDir(e.target.value)}
            placeholder="/path/to/snapshot-dir"
            style={{
              flex: 1,
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 8px',
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          />
          <button
            onClick={pickDirectory}
            title="Choose…"
            style={{
              background: 'none',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '6px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      <button
        onClick={runExport}
        disabled={inFlight}
        style={{
          background: inFlight ? 'var(--bg-secondary)' : 'var(--accent)',
          color: inFlight ? 'var(--text-hint)' : '#fff',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 12,
          fontWeight: 600,
          cursor: inFlight ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <ArrowUpFromLine size={14} />
        {inFlight ? 'Exporting…' : 'Export Prolog Snapshot'}
      </button>

      {stage !== 'idle' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            color: 'var(--text-primary)',
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
          }}
        >
          {stage === 'ready' && <CheckCircle2 size={14} style={{ color: '#5dc97e', flexShrink: 0, marginTop: 1 }} />}
          {stage === 'error' && <AlertCircle size={14} style={{ color: '#ff6b6b', flexShrink: 0, marginTop: 1 }} />}
          {(stage === 'building_snapshot' || stage === 'writing_pl') && (
            <div style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          )}
          <div style={{ wordBreak: 'break-word' }}>{message}</div>
        </div>
      )}

      {summary && stage === 'ready' && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            color: 'var(--text-primary)',
            background: 'var(--bg-secondary)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Export summary</div>
          <div>Entities: {summary.entities}</div>
          <div>Edges: {summary.edges}</div>
          <div>Blobs: {summary.blobs}</div>
        </div>
      )}
    </div>
  );
}
