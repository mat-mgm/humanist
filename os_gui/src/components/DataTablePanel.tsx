import { memo, useCallback, useMemo } from 'react';
import { useOsStore } from '../store';
import { Entity } from '../models';

// Atomic selectors — each panel only re-renders for its own slice
const selectEntities       = (s: ReturnType<typeof useOsStore.getState>) => s.entities;
const selectIsLoading      = (s: ReturnType<typeof useOsStore.getState>) => s.isLoading;
const selectLastEvent      = (s: ReturnType<typeof useOsStore.getState>) => s.lastEvent;
const selectSelectedId     = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityId;
const selectSelectEntity   = (s: ReturnType<typeof useOsStore.getState>) => s.selectEntity;

// Memoised row — only re-renders when its own selection/context state changes
const EntityRow = memo(function EntityRow({
  entity, isSelected, isContext, onSelect,
}: {
  entity: Entity;
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
      <td>{isSelected ? '◉' : isContext ? '◎' : ''}</td>
    </tr>
  );
});

export const DataTablePanel = memo(function DataTablePanel() {
  const entities       = useOsStore(selectEntities);
  const isLoading      = useOsStore(selectIsLoading);
  const lastEvent      = useOsStore(selectLastEvent);
  const selectedId     = useOsStore(selectSelectedId);
  const contextEntities = useOsStore(s => s.contextEntities);
  const contextIds     = useMemo(() => contextEntities.map(e => e.id), [contextEntities]);
  const selectEntity   = useOsStore(selectSelectEntity);

  const handleSelect = useCallback((id: string | null) => selectEntity(id), [selectEntity]);

  return (
    <div className="panel data-table-panel">
      {(isLoading || lastEvent) && (
        <div className="panel-stats">
          {isLoading && <span className="loading-badge">Syncing…</span>}
          {lastEvent && <span className="event-badge" title={lastEvent.topic}>⚡ {lastEvent.topic}</span>}
        </div>
      )}
      <div className="panel-body" style={{ padding: 0 }}>
        {entities.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>
            <p>No entities yet.</p>
            <p className="hint">Use Ctrl+I to ingest a file or run the CLI.</p>
          </div>
        ) : (
          <table className="entity-table">
            <thead>
              <tr>
                <th>Label</th><th>Kind</th><th>Context</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e: Entity) => (
                <EntityRow
                  key={e.id}
                  entity={e}
                  isSelected={e.id === selectedId}
                  isContext={contextIds.includes(e.id)}
                  onSelect={handleSelect}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
