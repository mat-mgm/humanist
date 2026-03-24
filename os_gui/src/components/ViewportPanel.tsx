import { memo, useMemo, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useOsStore } from '../store';
import { ThreeViewer } from './ThreeViewer';

// Atomic selectors
const selectSelectedId = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityId;
const selectEntities   = (s: ReturnType<typeof useOsStore.getState>) => s.entities;
const selectSelectEntity = (s: ReturnType<typeof useOsStore.getState>) => s.selectEntity;
const selectContextEntities = (s: ReturnType<typeof useOsStore.getState>) => s.contextEntities;
const selectBlobTraits = (s: ReturnType<typeof useOsStore.getState>) => s.blobTraits;

const EntityRow = memo(function EntityRow({
  entity, isSelected, isContext, onSelect,
}: {
  entity: any;
  isSelected: boolean;
  isContext: boolean;
  onSelect: (id: string | null) => void;
}) {
  return (
    <tr
      onClick={() => onSelect(isSelected ? null : entity.id)}
      style={{ cursor: 'pointer' }}
      className={isSelected ? 'row-selected' : isContext ? 'row-context' : ''}
    >
      <td title={entity.id}>{entity.label}</td>
      <td><span className={`kind-badge kind-${entity.kind}`}>{entity.kind}</span></td>
      <td>{entity.tags.join(', ')}</td>
      <td>{isSelected ? '◉' : isContext ? '◎' : ''}</td>
    </tr>
  );
});

export const ViewportPanel = memo(function ViewportPanel() {
  const [activeTab, setActiveTab] = useState<'properties' | 'preview' | 'registry'>('properties');
  const selectedEntityId = useOsStore(selectSelectedId);
  const entities         = useOsStore(selectEntities);
  const contextEntities  = useOsStore(selectContextEntities);
  const selectEntity     = useOsStore(selectSelectEntity);
  const blobTraits       = useOsStore(selectBlobTraits);

  const contextIds       = useMemo(() => contextEntities.map(e => e.id), [contextEntities]);
  const handleSelect     = useCallback((id: string | null) => selectEntity(id), [selectEntity]);

  // Derive selected entity — useMemo so it's not re-computed on every unrelated store update
  const selected = useMemo(
    () => entities.find(e => e.id === selectedEntityId) ?? null,
    [entities, selectedEntityId],
  );

  const blobTrait = selected ? blobTraits.find(b => b.owner === selected.id) : null;
  // Debug: log whenever selection changes
  if (selected) {
    console.log('[BlobTrait Debug] selected.id:', selected.id, '| blobTraits:', blobTraits.map(b => ({ owner: b.owner, mime: b.mime })));
    console.log('[BlobTrait Debug] matched:', blobTrait);
  }
  const isImage = blobTrait && blobTrait.mime.startsWith('image/');
  const isPdf   = blobTrait && blobTrait.mime === 'application/pdf';
  const isCad   = blobTrait && (blobTrait.mime === 'model/gltf-binary' || blobTrait.mime === 'model/gltf+json');

  const imageSrc = blobTrait?.localUrl ? convertFileSrc(blobTrait.localUrl) : null;

  return (
    <div className="panel viewport-panel">
      <div className="panel-header" style={{ display: 'flex', gap: 16, padding: '0 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel-header)' }}>
        <button 
          onClick={() => setActiveTab('properties')} 
          style={{ background: 'none', border: 'none', padding: '10px 4px', borderBottom: activeTab === 'properties' ? '2px solid var(--accent)' : '2px solid transparent', color: activeTab === 'properties' ? 'var(--text-primary)' : 'var(--text-hint)', cursor: 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}
        >
          Properties
        </button>
        <button 
          onClick={() => setActiveTab('preview')} 
          style={{ background: 'none', border: 'none', padding: '10px 4px', borderBottom: activeTab === 'preview' ? '2px solid var(--accent)' : '2px solid transparent', color: activeTab === 'preview' ? 'var(--text-primary)' : 'var(--text-hint)', cursor: 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}
        >
          Preview
        </button>
        <button 
          onClick={() => setActiveTab('registry')} 
          style={{ background: 'none', border: 'none', padding: '10px 4px', borderBottom: activeTab === 'registry' ? '2px solid var(--accent)' : '2px solid transparent', color: activeTab === 'registry' ? 'var(--text-primary)' : 'var(--text-hint)', cursor: 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}
        >
          Registry
        </button>
      </div>

      <div className="panel-body" style={{ padding: activeTab === 'registry' ? 0 : 12, overflow: 'auto' }}>
        {activeTab === 'properties' && (
          !selected ? (
            <div className="panel-placeholder">
              <div className="placeholder-icon">📐</div>
              <p>Click an entity to inspect it</p>
            </div>
          ) : (
            <div className="properties-view">
              <div className="prop-row">
                <span className="prop-key">ID</span>
                <span className="prop-val mono">{selected.id}</span>
              </div>
              <div className="prop-row">
                <span className="prop-key">Kind</span>
                <span className={`kind-badge kind-${selected.kind}`}>{selected.kind}</span>
              </div>
              <div className="prop-row">
                <span className="prop-key">Label</span>
                <span className="prop-val">{selected.label}</span>
              </div>
              <div className="prop-row">
                <span className="prop-key">Tags</span>
                <span className="prop-val">{selected.tags.join(', ') || '—'}</span>
              </div>
              {blobTrait?.localUrl && (
                <div className="prop-row">
                  <span className="prop-key">Source</span>
                  <span className="prop-val mono" style={{ wordBreak: 'break-all', fontSize: 10 }}>
                    {blobTrait.localUrl}
                  </span>
                </div>
              )}
              <div className="prop-section">Metadata</div>
              {Object.entries(selected.metadata ?? {}).map(([k, v]) => (
                <div className="prop-row" key={k}>
                  <span className="prop-key">{k}</span>
                  <span className="prop-val mono">{JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          )
        )}
        
        {activeTab === 'preview' && (
          !selected ? (
            <div className="panel-placeholder">
              <div className="placeholder-icon">👁️</div>
              <p>No preview available</p>
            </div>
          ) : isImage && imageSrc ? (
            <div style={{ padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <img 
                src={imageSrc} 
                alt={selected.label} 
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} 
              />
            </div>
          ) : isPdf && imageSrc ? (
            <object 
              data={imageSrc} 
              type="application/pdf" 
              width="100%" 
              height="100%"
              style={{ borderRadius: 4, background: '#fff' }}
            >
              <div className="panel-placeholder">
                <p>PDF viewer not natively supported in this environment.</p>
              </div>
            </object>
          ) : isCad && imageSrc ? (
            <ThreeViewer url={imageSrc} />
          ) : (
            <div className="panel-placeholder">
              <div className="placeholder-icon">📦</div>
              <p>Unknown blob structure. Cannot load into typical visualizers.</p>
              <pre style={{ textAlign: 'left', fontSize: 10, background: '#111', padding: 8, borderRadius: 4, width: '90%', overflow: 'auto', color: '#ffb86c' }}>
                {blobTrait ? JSON.stringify({ ...blobTrait, isImage, isPdf, isCad }, null, 2) : "No BlobTrait attached to this Entity! Please try clicking 'Ingest' or hit Ctrl+I to upload fresh blobs."}
              </pre>
            </div>
          )
        )}
        
        {activeTab === 'registry' && (
          entities.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>
              <p>No entities yet.</p>
              <p className="hint">Use Ctrl+I to ingest a file or run the CLI.</p>
            </div>
          ) : (
            <table className="entity-table">
              <thead>
                <tr>
                  <th>Label</th><th>Kind</th><th>Tags</th><th>Context</th>
                </tr>
              </thead>
              <tbody>
                {entities.map(e => (
                  <EntityRow
                    key={e.id}
                    entity={e}
                    isSelected={e.id === selectedEntityId}
                    isContext={contextIds.includes(e.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
});
