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

  const selected  = entities.find(e => e.id === selectedEntityId) ?? null;
  const blobTrait = selected ? blobTraits.find(b => b.owner === selected.id) : null;

  const isImage = blobTrait && blobTrait.mime.startsWith('image/');
  const isPdf   = blobTrait && blobTrait.mime === 'application/pdf';
  const isCad   = blobTrait && (blobTrait.mime === 'model/gltf-binary' || blobTrait.mime === 'model/gltf+json');
  const isText  = blobTrait && (
    blobTrait.mime.startsWith('text/')
    || blobTrait.mime === 'application/json'
    || blobTrait.mime === 'application/yaml'
    || blobTrait.mime === 'application/x-prolog'
  );
  const imageSrc = blobTrait?.localUrl ? convertFileSrc(blobTrait.localUrl) : null;

  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    if (isText && imageSrc) {
      fetch(imageSrc)
        .then(res => res.text())
        .then(txt => setTextContent(txt))
        .catch(err => setTextContent(`Failed to load text: ${err}`));
    } else {
      setTextContent(null);
    }
  }, [isText, imageSrc]);

  const onOpenExternal = async () => {
    if (!blobTrait?.localUrl) return;
    try { await invoke('open_external_path', { path: blobTrait.localUrl }); }
    catch (err) { alert('External editor failed: ' + err); }
  };

  const onOpenInEditor = () => {
    if (!selectedEntityId) return;
    const { setActiveActivity, setEditionEntity } = useOsStore.getState();
    setEditionEntity(selectedEntityId);
    setActiveActivity('edition');
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
          <>
            <button onClick={onOpenInEditor}
              style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              Edit
            </button>
            <button onClick={onOpenExternal}
              style={{ fontSize: 10, padding: '4px 8px', borderRadius: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
              Open Externally
            </button>
          </>
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
          <div style={{ padding: 12, minHeight: '100%', background: 'var(--bg-primary)', borderRadius: 4, border: '1px solid var(--border)' }}>
            <pre style={{ margin: 0, fontSize: 13, fontFamily: 'var(--font-mono)', lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{textContent}</pre>
          </div>
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
