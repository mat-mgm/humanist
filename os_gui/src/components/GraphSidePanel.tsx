import { memo, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useOsStore, resolvedLabel } from '../store';
import { SearchableDropdown } from './SearchableDropdown';
import { findShortestPath, pathEdgeKeys } from '../utils/graphUtils';

const KIND_COLORS: Record<string, string> = {
  physical: '#6de096',
  digital:  '#7eb0ff',
  abstract: '#f5d060',
  agent:    '#d680ff',
  blob:     '#ff9f43',
  temporal: '#ff7eb3',
};

const ENTITY_KINDS = ['physical', 'digital', 'abstract', 'agent', 'blob', 'temporal'];

export const GraphSidePanel = memo(function GraphSidePanel() {
  const entities        = useOsStore(s => s.entities);
  const edges           = useOsStore(s => s.edges);
  const filterKinds     = useOsStore(s => s.filterKinds);
  const filterEdgeLabels = useOsStore(s => s.filterEdgeLabels);
  const showRegions     = useOsStore(s => s.showRegions);
  const highlightedPath = useOsStore(s => s.highlightedPath);
  const graphMode       = useOsStore(s => s.graphMode);
  const hopCount        = useOsStore(s => s.hopCount);
  const backendReady    = useOsStore(s => s.backendReady);
  const allEntities     = useOsStore(s => s.allEntities);
  const allLabelTraits  = useOsStore(s => s.allLabelTraits);
  const activeLocale    = useOsStore(s => s.activeLocale);

  const exploreQuery    = useOsStore(s => s.graphExploreQuery);
  const exploreStatus   = useOsStore(s => s.graphExploreStatus);
  const showGrid        = useOsStore(s => s.graphShowGrid);
  const pathFrom        = useOsStore(s => s.graphPathFrom);
  const pathTo          = useOsStore(s => s.graphPathTo);
  const pathError       = useOsStore(s => s.graphPathError);
  const resetViewFn     = useOsStore(s => s.graphResetViewFn);

  const setExploreQuery  = useOsStore(s => s.setGraphExploreQuery);
  const setShowGrid      = useOsStore(s => s.setGraphShowGrid);
  const setPathFrom      = useOsStore(s => s.setGraphPathFrom);
  const setPathTo        = useOsStore(s => s.setGraphPathTo);
  const setPathError     = useOsStore(s => s.setGraphPathError);

  const { toggleRegions, toggleFilterKind, setFilterKinds, toggleFilterEdgeLabel,
          setHighlightedPath, clearHighlightedPath,
          clearGraph, loadFullGraph, setHopCount, expandContext, selectEntity } = useOsStore();

  const [exploreInputFocused, setExploreInputFocused] = useState(false);

  // Local dropdown: filters allEntities without a backend round-trip
  const filteredDropdown = useMemo(() => {
    const q = exploreQuery.trim().toLowerCase();
    if (/^select\s/i.test(q)) return [];
    return allEntities.filter((e: any) => {
      if (q.length === 0) return true;
      if (ENTITY_KINDS.includes(q)) return e.kind === q;
      if ((e.kind as string).startsWith(q)) return true;
      const label = resolvedLabel(e, allLabelTraits, activeLocale).toLowerCase();
      if (label.includes(q)) return true;
      return allLabelTraits.some((t: any) => t.owner === e.id && t.text.toLowerCase().includes(q));
    }).slice(0, 60);
  }, [exploreQuery, allEntities, allLabelTraits, activeLocale]);

  // Derived counts for badges
  const filteredNodes = useMemo(() => {
    if (filterKinds.length === 0) return entities;
    return entities.filter((e: any) => filterKinds.includes(e.kind));
  }, [entities, filterKinds]);

  const filteredEdges = useMemo(() => {
    const nodeIds = new Set(filteredNodes.map((e: any) => e.id.replace('entity:', '')));
    return edges.filter((e: any) => {
      const src = e.from.replace('entity:', '');
      const tgt = e.to.replace('entity:', '');
      if (!nodeIds.has(src) || !nodeIds.has(tgt)) return false;
      if (filterEdgeLabels.length > 0 && filterEdgeLabels.includes(e.label)) return false;
      return true;
    });
  }, [filteredNodes, edges, filterEdgeLabels]);

  const allEdgeLabels = useMemo(() => {
    const labels = new Set<string>();
    edges.forEach((e: any) => e.label && labels.add(e.label));
    return Array.from(labels).sort();
  }, [edges]);

  function handleFind() {
    setPathError(null);
    const fromEntity = entities.find((e: any) =>
      e.label === pathFrom || e.id === pathFrom || e.id === `entity:${pathFrom}`);
    const toEntity = entities.find((e: any) =>
      e.label === pathTo || e.id === pathTo || e.id === `entity:${pathTo}`);
    if (!fromEntity || !toEntity) { setPathError('Entity not found'); return; }
    const fromShort = fromEntity.id.replace('entity:', '');
    const toShort   = toEntity.id.replace('entity:', '');
    const shortEdges = edges.map((e: any) => ({
      from: e.from.replace('entity:', ''),
      to:   e.to.replace('entity:', ''),
      label: e.label,
    }));
    const pathShort = findShortestPath(fromShort, toShort, shortEdges);
    if (!pathShort) { setPathError('No path found'); return; }
    setHighlightedPath(pathShort.map(id => `entity:${id}`), pathEdgeKeys(pathShort));
  }

  const section: React.CSSProperties = {
    borderBottom: '1px solid var(--border)',
    padding: '8px 10px',
  };
  const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'var(--text-hint)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    marginBottom: 6, display: 'block',
  };
  const btnBase: React.CSSProperties = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', padding: '3px 8px', borderRadius: 4,
    cursor: 'pointer', fontSize: 11, height: 24,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>

      {/* ── Explore ───────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Explore</span>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder={/^select\s/i.test(exploreQuery) ? 'SurrealQL…' : 'Search entities…'}
            value={exploreQuery}
            onChange={e => setExploreQuery(e.target.value)}
            onFocus={() => setExploreInputFocused(true)}
            onBlur={() => setTimeout(() => setExploreInputFocused(false), 150)}
            style={{
              width: '100%', background: 'var(--bg-primary)',
              border: '1px solid var(--accent)', color: 'var(--text-primary)',
              padding: '3px 8px', borderRadius: 4, outline: 'none',
              fontSize: 11, height: 24,
            }}
          />
          {exploreInputFocused && filteredDropdown.length > 0 && (
            <div style={{
              position: 'absolute', top: 27, left: 0, right: 0,
              maxHeight: 220, overflowY: 'auto',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 4, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {filteredDropdown.map((e: any) => {
                const q = exploreQuery.trim().toLowerCase();
                const ownTraits = allLabelTraits.filter((t: any) => t.owner === e.id);
                const matchingTrait = q.length > 0
                  ? ownTraits.find((t: any) => t.text.toLowerCase().includes(q))
                  : undefined;
                const displayLabel = matchingTrait
                  ? matchingTrait.text
                  : resolvedLabel(e, allLabelTraits, activeLocale);
                return (
                  <div
                    key={e.id}
                    onMouseDown={() => {
                      expandContext(e.id);
                      selectEntity(e.id);
                      setExploreQuery('');
                      setExploreInputFocused(false);
                    }}
                    style={{
                      padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                      color: 'var(--text-primary)', borderBottom: '1px solid var(--border)',
                      display: 'flex', gap: 6, alignItems: 'center',
                    }}
                    onMouseEnter={el => (el.currentTarget.style.background = 'var(--bg-primary)')}
                    onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ color: KIND_COLORS[e.kind] ?? 'var(--text-hint)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{e.kind}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
                    {matchingTrait && matchingTrait.lang !== activeLocale && (
                      <span style={{ fontSize: 9, color: 'var(--text-hint)' }}>{matchingTrait.lang}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {exploreStatus && (
          <span style={{ fontSize: 10, color: 'var(--text-hint)', fontStyle: 'italic', marginTop: 4, display: 'block' }}>
            {exploreStatus}
          </span>
        )}
      </div>

      {/* ── Graph controls ────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Graph</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={() => clearGraph()} style={btnBase}>Clear</button>
          <button
            onClick={() => backendReady && loadFullGraph()}
            disabled={!backendReady}
            style={{
              ...btnBase,
              background: graphMode === 'full' ? 'var(--accent)' : 'var(--bg-secondary)',
              border: `1px solid ${graphMode === 'full' ? 'var(--accent)' : 'var(--border)'}`,
              color: graphMode === 'full' ? '#fff' : backendReady ? 'var(--text-primary)' : 'var(--text-hint)',
              cursor: backendReady ? 'pointer' : 'not-allowed',
              opacity: backendReady ? 1 : 0.5,
            }}
          >
            {backendReady ? 'Load Full' : 'Init…'}
          </button>
          <button onClick={() => resetViewFn?.()} style={btnBase} title="Reset zoom">Reset</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-hint)', fontWeight: 600 }}>Hops:</span>
          <button onClick={() => setHopCount(hopCount - 1)} disabled={hopCount <= 0}
            style={{ ...btnBase, width: 20, height: 20, padding: 0, lineHeight: 1 }}>−</button>
          <span style={{ fontSize: 11, color: 'var(--text-primary)', minWidth: 10, textAlign: 'center' }}>{hopCount}</span>
          <button onClick={() => setHopCount(hopCount + 1)} disabled={hopCount >= 5}
            style={{ ...btnBase, width: 20, height: 20, padding: 0, lineHeight: 1 }}>+</button>
        </div>
      </div>

      {/* ── Node filter ───────────────────────────────────────── */}
      <div style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={label}>Nodes ({filterKinds.length > 0 ? `${filteredNodes.length}/` : ''}{entities.length})</span>
          {filterKinds.length > 0 && (
            <button onClick={() => setFilterKinds([])}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', padding: 0 }}>
              Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {ENTITY_KINDS.map(kind => {
            const active = filterKinds.includes(kind);
            return (
              <button key={kind} onClick={() => toggleFilterKind(kind)} style={{
                background: active ? KIND_COLORS[kind] : 'transparent',
                border: `1px solid ${active ? KIND_COLORS[kind] : 'var(--border)'}`,
                color: active ? '#000' : 'var(--text-secondary)',
                fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                opacity: active ? 1 : 0.7, transition: 'all 0.15s ease',
              }}>
                {kind}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Edge filter ───────────────────────────────────────── */}
      {allEdgeLabels.length > 0 && (
        <div style={section}>
          <span style={label}>Edges ({filterKinds.length > 0 || filterEdgeLabels.length > 0 ? `${filteredEdges.length}/` : ''}{edges.length})</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {allEdgeLabels.map(lbl => {
              const hidden = filterEdgeLabels.includes(lbl);
              return (
                <button key={lbl} onClick={() => toggleFilterEdgeLabel(lbl)} style={{
                  background: hidden ? 'var(--bg-primary)' : 'transparent',
                  border: `1px solid ${hidden ? 'var(--accent)' : 'var(--border)'}`,
                  color: hidden ? 'var(--accent)' : 'var(--text-hint)',
                  fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                  textDecoration: hidden ? 'line-through' : 'none',
                  transition: 'all 0.15s ease',
                }}>
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Toggles ───────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Display</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
            Grid
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showRegions} onChange={() => toggleRegions()} />
            Tag Regions
          </label>
        </div>
      </div>

      {/* ── Path finder ───────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Find Path</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SearchableDropdown
            placeholder="From entity…"
            value={pathFrom}
            onChange={setPathFrom}
            options={entities.map((e: any) => ({ id: e.id, label: e.label }))}
            style={{ width: '100%' }}
          />
          <SearchableDropdown
            placeholder="To entity…"
            value={pathTo}
            onChange={setPathTo}
            options={entities.map((e: any) => ({ id: e.id, label: e.label }))}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={handleFind}
              style={{ ...btnBase, background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600, flex: 1 }}>
              Find
            </button>
            {highlightedPath.length > 0 && (
              <button onClick={() => { clearHighlightedPath(); setPathError(null); }}
                style={{ ...btnBase, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, padding: 0 }}>
                <X size={12} />
              </button>
            )}
          </div>
          {pathError && <span style={{ fontSize: 11, color: 'var(--error)' }}>{pathError}</span>}
        </div>
      </div>

    </div>
  );
});
