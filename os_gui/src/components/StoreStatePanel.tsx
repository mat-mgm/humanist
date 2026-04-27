import { Database, HardDrive, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import { useOsStore } from '../store';

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export function StoreStatePanel({ embedded = false }: { embedded?: boolean }) {
  const storageHealth = useOsStore(s => s.storageHealth);
  const storageHealthLoading = useOsStore(s => s.storageHealthLoading);
  const fetchStorageHealth = useOsStore(s => s.fetchStorageHealth);

  useEffect(() => {
    fetchStorageHealth();
  }, [fetchStorageHealth]);

  const section: CSSProperties = {
    borderBottom: '1px solid var(--border)',
    padding: '8px 10px',
  };
  const label: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--text-hint)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 6,
    display: 'block',
  };
  const statRow: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    minHeight: 22,
  };
  const statKey: CSSProperties = {
    fontSize: 11,
    color: 'var(--text-hint)',
    minWidth: 88,
    flexShrink: 0,
    paddingTop: 2,
  };
  const statValue: CSSProperties = {
    fontSize: 12,
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: embedded ? 'auto' : '100%', overflowY: embedded ? 'visible' : 'auto', overflowX: 'hidden' }}>
      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={label}>Store State</span>
          <button
            onClick={() => fetchStorageHealth()}
            title="Refresh storage state"
            style={{ background: 'none', border: 'none', color: 'var(--text-hint)', cursor: 'pointer', padding: 0 }}
          >
            {storageHealthLoading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Database size={12} color="var(--text-hint)" />
          <span style={label}>Database</span>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={statRow}><span style={statKey}>Live</span><span style={statValue}>{storageHealth?.live_entity_count ?? '...'}</span></div>
          <div style={statRow}><span style={statKey}>Soft-deleted</span><span style={statValue}>{storageHealth?.soft_deleted_entity_count ?? '...'}</span></div>
          <div style={statRow}><span style={statKey}>Edges</span><span style={statValue}>{storageHealth?.edge_count ?? '...'}</span></div>
        </div>
      </div>

      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <HardDrive size={12} color="var(--text-hint)" />
          <span style={label}>Blob Store</span>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={statRow}><span style={statKey}>Blob traits</span><span style={statValue}>{storageHealth?.blob_trait_count ?? '...'}</span></div>
          <div style={statRow}><span style={statKey}>Unique blobs</span><span style={statValue}>{storageHealth?.unique_blob_count ?? '...'}</span></div>
          <div style={statRow}><span style={statKey}>Referenced</span><span style={statValue}>{formatBytes(storageHealth?.referenced_blob_bytes)}</span></div>
          <div style={statRow}><span style={statKey}>On disk</span><span style={statValue}>{formatBytes(storageHealth?.blob_store_bytes)}</span></div>
        </div>
      </div>

    </div>
  );
}
