import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface IngestDialogProps {
  visible: boolean;
  onClose: () => void;
}

export function IngestDialog({ visible, onClose }: IngestDialogProps) {
  const [label, setLabel] = useState('');
  const [filePath, setFilePath] = useState('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [resultId, setResultId] = useState('');
  const [errMsg, setErrMsg] = useState('');

  async function handleIngest() {
    if (!filePath.trim() || !label.trim()) return;
    setStatus('uploading');
    try {
      const id = await invoke<string>('ingest_entity', {
        label,
        filePath: filePath.trim(),
      });
      setResultId(id);
      setStatus('done');
      setTimeout(() => {
        setStatus('idle');
        setLabel('');
        setFilePath('');
        onClose();
      }, 1800);
    } catch (e) {
      setErrMsg(String(e));
      setStatus('error');
    }
  }

  if (!visible) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()} id="ingest-dialog">
        <div className="dialog-header">
          <h3>📥 Ingest File</h3>
          <button className="terminal-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <label className="dialog-label">Label</label>
          <input
            id="label-input"
            className="dialog-input"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Engine CAD Assembly"
          />

          <label className="dialog-label">File path</label>
          <div className="dialog-row">
            <input
              id="fp-input"
              className="dialog-input"
              value={filePath}
              onChange={e => setFilePath(e.target.value)}
              placeholder="/absolute/path/to/file.glb"
            />
          </div>

          <p className="hint" style={{ marginTop: 4 }}>
            Paste the absolute path. Rust handles the upload — the file is never sent over IPC.
          </p>

          {status === 'error' && <p className="err-msg">{errMsg}</p>}
          {status === 'done' && <p className="ok-msg">✅ Ingested: {resultId.substring(0, 26)}…</p>}

          <button
            id="ingest-submit"
            className="dialog-submit"
            onClick={handleIngest}
            disabled={status === 'uploading' || !filePath || !label}
          >
            {status === 'uploading' ? 'Uploading…' : 'Ingest →'}
          </button>
        </div>
      </div>
    </div>
  );
}
