import { memo, useState, useEffect } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Eye, Package } from 'lucide-react';
import { useOsStore } from '../store';
import { ThreeViewer } from './ThreeViewer';
import { PdfViewer } from './PdfViewer';

export const AssetPreview = memo(function AssetPreview() {
  const selectedEntityId = useOsStore(s => s.selectedEntityId);
  const entities         = useOsStore(s => s.entities);
  const blobTraits       = useOsStore(s => s.blobTraits);
  const saveBlobContent  = useOsStore(s => s.saveBlobContent);

  const selected  = entities.find(e => e.id === selectedEntityId) ?? null;
  const blobTrait = selected ? blobTraits.find(b => b.owner === selected.id) : null;

  const isImage = blobTrait && blobTrait.mime.startsWith('image/');
  const isPdf   = blobTrait && blobTrait.mime === 'application/pdf';
  const isCad   = blobTrait && (blobTrait.mime === 'model/gltf-binary' || blobTrait.mime === 'model/gltf+json');
  const isText  = blobTrait && (blobTrait.mime.startsWith('text/') || blobTrait.mime === 'application/json');
  const imageSrc = blobTrait?.localUrl ? convertFileSrc(blobTrait.localUrl) : null;

  const [textContent, setTextContent]   = useState<string | null>(null);
  const [isEditing, setIsEditing]       = useState(false);
  const [editedContent, setEditedContent] = useState<string>('');
  const [isSpawning, setIsSpawning]     = useState(false);

  useEffect(() => {
    if (isText && imageSrc) {
      fetch(imageSrc)
        .then(res => res.text())
        .then(txt => { setTextContent(txt); setEditedContent(txt); })
        .catch(err => setTextContent(`Failed to load text: ${err}`));
    } else {
      setTextContent(null);
      setIsEditing(false);
    }
  }, [isText, imageSrc]);

  const onOpenExternal = async () => {
    if (!blobTrait?.localUrl) return;
    try { await invoke('open_external_path', { path: blobTrait.localUrl }); }
    catch (err) { alert('External editor failed: ' + err); }
  };

  const onEditInTerminal = async () => {
    if (!selected || isSpawning) return;
    setIsSpawning(true);
    const { setActivePtySession } = useOsStore.getState();
    try {
      setActivePtySession(`edit-${selected.id}`);
      await invoke('edit_entity_in_terminal', { entityId: selected.id, format: 'yaml' });
    } catch (err) {
      alert('Terminal editor failed to start: ' + err);
      useOsStore.getState().setActivePtySession('main');
    } finally { setIsSpawning(false); }
  };

  const onSave = async () => {
    if (!blobTrait) return;
    try { await saveBlobContent(blobTrait.storage_id, editedContent); setTextContent(editedContent); setIsEditing(false); }
    catch (e) { console.error('Failed to save blob:', e); }
  };

  if (!selected) {
    return (
      <div className="panel panel-placeholder" style={{ height: '100%' }}>
        <div className="placeholder-icon"><Eye size={32} /></div>
        <p>No preview available</p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)', flexShrink: 0 }}>
        {blobTrait && (
          <button onClick={onOpenExternal}
            style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
            Open Externally
          </button>
        )}
        <button onClick={onEditInTerminal} disabled={isSpawning}
          style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: isSpawning ? 'var(--text-hint)' : 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600, opacity: isSpawning ? 0.7 : 1 }}>
          {isSpawning ? 'Spawning...' : 'Edit in Term'}
        </button>
        {isText && !isEditing && (
          <button onClick={() => setIsEditing(true)}
            style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Edit Content
          </button>
        )}
        {isText && isEditing && (
          <div style={{ display: 'flex', gap: 6 }}>
            {editedContent !== textContent && (
              <span style={{ fontSize: 9, color: 'var(--accent)', alignSelf: 'center', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>Unsaved Edits</span>
            )}
            <button onClick={onSave}
              style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Save</button>
            <button onClick={() => { setIsEditing(false); setEditedContent(textContent || ''); }}
              style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-hint)', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: isImage || isPdf || isCad ? 0 : 12 }}>
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
            <textarea value={editedContent} onChange={e => setEditedContent(e.target.value)} spellCheck={false}
              style={{ width: '100%', height: '100%', padding: '12px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.5, resize: 'none', outline: 'none', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)' }} />
          ) : (
            <div style={{ padding: 12, minHeight: '100%', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
              <pre style={{ margin: 0, fontSize: 13, fontFamily: 'var(--font-mono)', lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{textContent}</pre>
            </div>
          )
        ) : (
          <div className="panel-placeholder">
            <div className="placeholder-icon"><Package size={32} /></div>
            <p>Unknown blob structure.</p>
            <pre style={{ textAlign: 'left', fontSize: 10, background: '#111', padding: 8, borderRadius: 4, width: '90%', overflow: 'auto', color: '#ffb86c' }}>
              {blobTrait ? JSON.stringify({ ...blobTrait, isImage, isPdf, isCad }, null, 2) : 'No BlobTrait attached to this Entity!'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
});
