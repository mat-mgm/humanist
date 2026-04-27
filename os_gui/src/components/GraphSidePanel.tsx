import { memo, useMemo, useState, useCallback } from 'react';
import { X, Grid, Circle, ArrowRight, ArrowLeft, ArrowLeftRight, Play, Pause } from 'lucide-react';
import { useOsStore, resolvedLabel } from '../store';
import { SearchableDropdown } from './SearchableDropdown';
import { findShortestPath, pathEdgeKeys } from '../utils/graphUtils';
import { KIND_COLORS, type EntityCategory, type GraphLayoutMode } from '../config';

const ENTITY_KINDS: EntityCategory[] = ['physical', 'digital', 'abstract', 'persona'];

export const GraphSidePanel = memo(function GraphSidePanel() {
  const entities        = useOsStore(s => s.entities);
  const edges           = useOsStore(s => s.edges);
  const filterKinds     = useOsStore(s => s.filterKinds);
  const filterEdgeLabels = useOsStore(s => s.filterEdgeLabels);
  const showRegions     = useOsStore(s => s.showRegions);
  const showDerivedEdges = useOsStore(s => s.showDerivedEdges);
  const toggleShowDerivedEdges = useOsStore(s => s.toggleShowDerivedEdges);
  const highlightedPath = useOsStore(s => s.highlightedPath);
  const graphMode       = useOsStore(s => s.graphMode);
  const hopCount        = useOsStore(s => s.hopCount);
  const backendReady    = useOsStore(s => s.backendReady);
  const allEntities     = useOsStore(s => s.allEntities);
  const allTagEdges     = useOsStore(s => s.allTagEdges);
  const allLabelTraits  = useOsStore(s => s.allLabelTraits);
  const activeLocale    = useOsStore(s => s.activeLocale);
  const selectedIds     = useOsStore(s => s.selectedIds);
  const backgroundStyle = useOsStore(s => s.backgroundStyle);
  const regionStyle     = useOsStore(s => s.regionStyle);

  const toggledImageNodes        = useOsStore(s => s.toggledImageNodes);
  const clearToggledImageNodes   = useOsStore(s => s.clearToggledImageNodes);
  const showDeleteConfirm        = useOsStore(s => s.showDeleteConfirm);
  const setShowDeleteConfirm     = useOsStore(s => s.setShowDeleteConfirm);
  const selectedEntityId         = useOsStore(s => s.selectedEntityId);
  const deleteEntities           = useOsStore(s => s.deleteEntities);

  const layoutMode               = useOsStore(s => s.graphLayoutMode);
  const setLayoutMode            = useOsStore(s => s.setGraphLayoutMode);
  const simulationPaused         = useOsStore(s => s.graphSimulationPaused);
  const setSimulationPaused      = useOsStore(s => s.setGraphSimulationPaused);
  const showNodeLabels           = useOsStore(s => s.graphShowNodeLabels);
  const setShowNodeLabels        = useOsStore(s => s.setGraphShowNodeLabels);
  const showEdgeLabels           = useOsStore(s => s.graphShowEdgeLabels);
  const setShowEdgeLabels        = useOsStore(s => s.setGraphShowEdgeLabels);
  const hiddenLabelCategories    = useOsStore(s => s.graphHiddenLabelCategories);
  const toggleHiddenLabelCategory = useOsStore(s => s.toggleGraphHiddenLabelCategory);

  const exploreQuery    = useOsStore(s => s.graphExploreQuery);
  const exploreStatus   = useOsStore(s => s.graphExploreStatus);
  const showGrid        = useOsStore(s => s.graphShowGrid);
  const pathFrom        = useOsStore(s => s.graphPathFrom);
  const pathTo          = useOsStore(s => s.graphPathTo);
  const pathError       = useOsStore(s => s.graphPathError);
  const resetViewFn     = useOsStore(s => s.graphResetViewFn);

  const setExploreQuery     = useOsStore(s => s.setGraphExploreQuery);
  const setExploreStatus    = useOsStore(s => s.setGraphExploreStatus);
  const setShowGrid         = useOsStore(s => s.setGraphShowGrid);
  const setPathFrom         = useOsStore(s => s.setGraphPathFrom);
  const setPathTo           = useOsStore(s => s.setGraphPathTo);
  const setPathError        = useOsStore(s => s.setGraphPathError);
  const setBackgroundStyle  = useOsStore(s => s.setBackgroundStyle);
  const setRegionStyle      = useOsStore(s => s.setRegionStyle);
  const tagEntities         = useOsStore(s => s.tagEntities);

  const { toggleRegions, toggleFilterKind, setFilterKinds, toggleFilterEdgeLabel,
          setHighlightedPath, clearHighlightedPath,
          clearGraph, loadFullGraph, setHopCount, expandContext, selectEntity, loadExactIds } = useOsStore();

  const addEdgeAction = useOsStore(s => s.addEdgeAction);

  const [exploreInputFocused, setExploreInputFocused] = useState(false);
  const [selTagInput, setSelTagInput] = useState('');
  const [showRelateForm, setShowRelateForm] = useState(false);
  const [relateSearch, setRelateSearch] = useState('');
  const [relateTargetId, setRelateTargetId] = useState('');
  const [relateEdgeLabel, setRelateEdgeLabel] = useState('');
  const [relateError, setRelateError] = useState('');
  const [relateLoading, setRelateLoading] = useState(false);
  const [connectDir, setConnectDir] = useState<'ab' | 'ba' | 'both'>('ab');
  const [connectLabel, setConnectLabel] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);

  // tag label → entity IDs (bare, no "entity:" prefix as stored in edges)
  // Backend strips "entity:" from edge.from/to, so re-add when resolving the tag entity label.
  const tagGroups = useMemo(() => {
    const map = new Map<string, { label: string; entityIds: string[] }>();
    for (const edge of allTagEdges) {
      const tagFullId = `entity:${edge.to}`;
      if (!map.has(edge.to)) {
        const tagEntity = allEntities.find((e: any) => e.id === tagFullId);
        map.set(edge.to, { label: tagEntity?.label ?? edge.to, entityIds: [] });
      }
      map.get(edge.to)!.entityIds.push(`entity:${edge.from}`);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allTagEdges, allEntities]);

  const isTagQuery = exploreQuery.trimStart().startsWith('#');
  const tagQ = isTagQuery ? exploreQuery.trim().slice(1).toLowerCase() : '';

  // Local dropdown: tag groups when "#" prefix, entity list otherwise
  const filteredDropdown = useMemo(() => {
    const q = exploreQuery.trim().toLowerCase();
    if (/^select\s/i.test(q)) return [];
    if (isTagQuery) return []; // handled by tagDropdown
    return allEntities.filter((e: any) => {
      if (q.length === 0) return true;
      if ((ENTITY_KINDS as readonly string[]).includes(q)) return e.category === q;
      if ((e.category as string).startsWith(q)) return true;
      const label = resolvedLabel(e, allLabelTraits, activeLocale).toLowerCase();
      if (label.includes(q)) return true;
      return allLabelTraits.some((t: any) => t.owner === e.id && t.text.toLowerCase().includes(q));
    }).slice(0, 60);
  }, [exploreQuery, isTagQuery, allEntities, allLabelTraits, activeLocale]);

  const tagDropdown = useMemo(() => {
    if (!isTagQuery) return [];
    return tagGroups.filter(g => tagQ === '' || g.label.toLowerCase().includes(tagQ));
  }, [isTagQuery, tagQ, tagGroups]);

  // Derived counts for badges
  const filteredNodes = useMemo(() => {
    if (filterKinds.length === 0) return entities;
    return entities.filter((e: any) => filterKinds.includes(e.category));
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

  const handleSelectionTag = useCallback(async () => {
    const t = selTagInput.trim();
    if (!t || selectedIds.length === 0) return;
    await tagEntities(selectedIds, t);
    setSelTagInput('');
  }, [selTagInput, selectedIds, tagEntities]);

  const relateCandidates = useMemo(() => {
    const q = relateSearch.trim().toLowerCase();
    if (!q) return [];
    return entities.filter((e: any) =>
      !selectedIds.includes(e.id) && resolvedLabel(e, allLabelTraits, activeLocale).toLowerCase().includes(q)
    ).slice(0, 10);
  }, [relateSearch, entities, selectedIds, allLabelTraits, activeLocale]);

  const connectPair = useMemo(() => {
    if (selectedIds.length !== 2) return null;
    const a = entities.find((e: any) => e.id === selectedIds[0]);
    const b = entities.find((e: any) => e.id === selectedIds[1]);
    if (!a || !b) return null;
    return {
      aId: selectedIds[0],
      bId: selectedIds[1],
      aLabel: resolvedLabel(a, allLabelTraits, activeLocale),
      bLabel: resolvedLabel(b, allLabelTraits, activeLocale),
    };
  }, [selectedIds, entities, allLabelTraits, activeLocale]);

  const handleConnect = useCallback(async () => {
    if (!connectPair) return;
    const lbl = connectLabel.trim();
    if (!lbl) { setConnectError('Edge label is required.'); return; }
    setConnectLoading(true);
    setConnectError('');
    try {
      if (connectDir === 'ab' || connectDir === 'both') await addEdgeAction(connectPair.aId, connectPair.bId, lbl);
      if (connectDir === 'ba' || connectDir === 'both') await addEdgeAction(connectPair.bId, connectPair.aId, lbl);
      setConnectLabel('');
    } catch (e: any) {
      setConnectError(String(e));
    } finally {
      setConnectLoading(false);
    }
  }, [connectPair, connectDir, connectLabel, addEdgeAction]);

  const handleRelateCreate = useCallback(async () => {
    if (!relateTargetId) { setRelateError('Select a target entity.'); return; }
    const lbl = relateEdgeLabel.trim();
    if (!lbl) { setRelateError('Edge label is required.'); return; }
    setRelateLoading(true);
    setRelateError('');
    try {
      for (const sourceId of selectedIds) {
        await addEdgeAction(sourceId, relateTargetId, lbl);
      }
      setShowRelateForm(false);
      setRelateSearch('');
      setRelateTargetId('');
      setRelateEdgeLabel('');
    } catch (e: any) {
      setRelateError(String(e));
    } finally {
      setRelateLoading(false);
    }
  }, [relateTargetId, relateEdgeLabel, selectedIds, addEdgeAction]);

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
            placeholder={/^select\s/i.test(exploreQuery) ? 'SurrealQL…' : 'Search entities or #tag…'}
            value={exploreQuery}
            onChange={e => setExploreQuery(e.target.value)}
            onFocus={() => setExploreInputFocused(true)}
            onBlur={() => setTimeout(() => setExploreInputFocused(false), 150)}
            style={{
              width: '100%', background: 'var(--bg-primary)',
              border: '1px solid var(--accent)', color: 'var(--text-primary)',
              padding: '5px 10px', borderRadius: 4, outline: 'none',
              fontSize: 11, height: 28,
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
                    <span style={{ color: KIND_COLORS[e.category] ?? 'var(--text-hint)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{e.category}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
                    {matchingTrait && matchingTrait.lang !== activeLocale && (
                      <span style={{ fontSize: 9, color: 'var(--text-hint)' }}>{matchingTrait.lang}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {exploreInputFocused && tagDropdown.length > 0 && (
            <div style={{
              position: 'absolute', top: 27, left: 0, right: 0,
              maxHeight: 220, overflowY: 'auto',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 4, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              {tagDropdown.map(group => (
                <div
                  key={group.label}
                  onMouseDown={() => {
                    loadExactIds(group.entityIds);
                    setExploreQuery('');
                    setExploreInputFocused(false);
                    setExploreStatus(`${group.entityIds.length} entit${group.entityIds.length === 1 ? 'y' : 'ies'} tagged "${group.label}"`);
                    setTimeout(() => setExploreStatus(null), 2500);
                  }}
                  style={{
                    padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                    color: 'var(--text-primary)', borderBottom: '1px solid var(--border)',
                    display: 'flex', gap: 6, alignItems: 'center',
                  }}
                  onMouseEnter={el => (el.currentTarget.style.background = 'var(--bg-primary)')}
                  onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: 'var(--accent)', fontSize: 9, fontWeight: 700 }}>#</span>
                  <span style={{ flex: 1 }}>{group.label}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-hint)' }}>{group.entityIds.length}</span>
                </div>
              ))}
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
            {backendReady ? 'Load' : 'Init…'}
          </button>
          <button onClick={() => clearGraph()} style={btnBase}>Clear</button>
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
          {/* Grid toggle + style switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', flex: 1 }}>
              <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
              Background
            </label>
            {showGrid && (
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  onClick={() => setBackgroundStyle('grid')}
                  title="Grid lines"
                  style={{ ...btnBase, width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: backgroundStyle === 'grid' ? 'var(--accent)' : 'var(--bg-secondary)',
                    border: `1px solid ${backgroundStyle === 'grid' ? 'var(--accent)' : 'var(--border)'}`,
                    color: backgroundStyle === 'grid' ? '#fff' : 'var(--text-secondary)',
                  }}>
                  <Grid size={11} />
                </button>
                <button
                  onClick={() => setBackgroundStyle('dots')}
                  title="Dot matrix"
                  style={{ ...btnBase, width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: backgroundStyle === 'dots' ? 'var(--accent)' : 'var(--bg-secondary)',
                    border: `1px solid ${backgroundStyle === 'dots' ? 'var(--accent)' : 'var(--border)'}`,
                    color: backgroundStyle === 'dots' ? '#fff' : 'var(--text-secondary)',
                  }}>
                  <Circle size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Derived edges toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showDerivedEdges}
              onChange={() => toggleShowDerivedEdges()}
            />
            Show Derived Edges
          </label>

          {/* Regions toggle + style switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', flex: 1 }}>
              <input type="checkbox" checked={showRegions} onChange={() => toggleRegions()} />
              Tag Regions
            </label>
            {showRegions && (
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  onClick={() => setRegionStyle('hatch')}
                  title="Hatch style"
                  style={{ ...btnBase, padding: '1px 5px', fontSize: 9, height: 20,
                    background: regionStyle === 'hatch' ? 'var(--accent)' : 'var(--bg-secondary)',
                    border: `1px solid ${regionStyle === 'hatch' ? 'var(--accent)' : 'var(--border)'}`,
                    color: regionStyle === 'hatch' ? '#fff' : 'var(--text-secondary)',
                  }}>
                  Hatch
                </button>
                <button
                  onClick={() => setRegionStyle('fill')}
                  title="Solid fill"
                  style={{ ...btnBase, padding: '1px 5px', fontSize: 9, height: 20,
                    background: regionStyle === 'fill' ? 'var(--accent)' : 'var(--bg-secondary)',
                    border: `1px solid ${regionStyle === 'fill' ? 'var(--accent)' : 'var(--border)'}`,
                    color: regionStyle === 'fill' ? '#fff' : 'var(--text-secondary)',
                  }}>
                  Fill
                </button>
              </div>
            )}
          </div>

          {/* Collapse all node previews */}
          <button
            onClick={() => clearToggledImageNodes()}
            disabled={toggledImageNodes.size === 0}
            title="Collapse every toggled image / PDF preview on graph nodes"
            style={{
              ...btnBase,
              alignSelf: 'flex-start',
              opacity: toggledImageNodes.size === 0 ? 0.5 : 1,
              cursor: toggledImageNodes.size === 0 ? 'default' : 'pointer',
            }}
          >
            Collapse previews{toggledImageNodes.size > 0 ? ` (${toggledImageNodes.size})` : ''}
          </button>

          {/* Reset view */}
          <button onClick={() => resetViewFn?.()} style={{ ...btnBase, alignSelf: 'flex-start' }} title="Reset zoom and fit graph">
            Reset View
          </button>
        </div>
      </div>

      {/* ── Simulation ────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Simulation</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setSimulationPaused(!simulationPaused)}
            title={simulationPaused ? 'Resume layout simulation' : 'Pause layout simulation'}
            style={{
              ...btnBase,
              display: 'flex', alignItems: 'center', gap: 4,
              background: simulationPaused ? 'var(--accent)' : 'var(--bg-secondary)',
              border: `1px solid ${simulationPaused ? 'var(--accent)' : 'var(--border)'}`,
              color: simulationPaused ? '#fff' : 'var(--text-primary)',
            }}
          >
            {simulationPaused ? <Play size={11} /> : <Pause size={11} />}
            {simulationPaused ? 'Resume' : 'Pause'}
          </button>
          <select
            value={layoutMode}
            onChange={e => setLayoutMode(e.target.value as GraphLayoutMode)}
            title="Force-graph layout preset"
            style={{
              flex: 1, height: 24, fontSize: 11,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text-primary)', borderRadius: 4, padding: '0 6px',
              outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="default">Default</option>
            <option value="clustered">Clustered (dense subgraphs)</option>
            <option value="hairball">Hairball (single hub)</option>
          </select>
        </div>
      </div>

      {/* ── Labels ────────────────────────────────────────────── */}
      <div style={section}>
        <span style={label}>Labels</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showNodeLabels} onChange={e => setShowNodeLabels(e.target.checked)} />
            Node labels
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showEdgeLabels} onChange={e => setShowEdgeLabels(e.target.checked)} />
            Edge labels
          </label>
          {showNodeLabels && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>By category</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {ENTITY_KINDS.map(kind => {
                  const hidden = hiddenLabelCategories.includes(kind);
                  return (
                    <button key={kind} onClick={() => toggleHiddenLabelCategory(kind)} title={hidden ? `Show ${kind} labels` : `Hide ${kind} labels`} style={{
                      background: hidden ? 'transparent' : KIND_COLORS[kind],
                      border: `1px solid ${hidden ? 'var(--border)' : KIND_COLORS[kind]}`,
                      color: hidden ? 'var(--text-hint)' : '#000',
                      fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                      textDecoration: hidden ? 'line-through' : 'none',
                    }}>
                      {kind}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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

      {/* ── Inline delete confirm (shows for single or multi selection) ── */}
      {showDeleteConfirm && (
        <div style={{ ...section, borderTop: '1px solid #ff6b6b' }}>
          <span style={{ ...label, color: '#ff6b6b' }}>Delete</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {(() => {
                const n = selectedIds.length > 0 ? selectedIds.length : (selectedEntityId ? 1 : 0);
                return `Delete ${n} selected entit${n === 1 ? 'y' : 'ies'}?`;
              })()}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  const ids = selectedIds.length > 0 ? selectedIds : (selectedEntityId ? [selectedEntityId] : []);
                  if (ids.length > 0) deleteEntities(ids);
                  setShowDeleteConfirm(false);
                }}
                style={{ ...btnBase, flex: 1, background: '#ff6b6b', border: 'none', color: '#fff', fontWeight: 700 }}
              >
                Yes, delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{ ...btnBase, flex: 1 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Selection actions ─────────────────────────────────── */}
      {selectedIds.length > 0 && (
        <div style={{ ...section, borderTop: '1px solid var(--accent)', marginTop: 'auto' }}>
          <span style={{ ...label, color: 'var(--accent)' }}>{selectedIds.length} Selected</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Direct connect: only shown when exactly 2 entities are selected */}
            {connectPair && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, color: 'var(--text-hint)', fontWeight: 600, textTransform: 'uppercase' }}>Connect</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-secondary)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'right', opacity: connectDir === 'ba' ? 0.45 : 1 }}>
                    {connectPair.aLabel}
                  </span>
                  <span style={{ color: 'var(--accent)', fontSize: 12, flexShrink: 0 }}>
                    {connectDir === 'ab' ? '→' : connectDir === 'ba' ? '←' : '↔'}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, opacity: connectDir === 'ab' ? 0.45 : 1 }}>
                    {connectPair.bLabel}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {(['ab', 'both', 'ba'] as const).map(dir => {
                    const icon = dir === 'ab' ? <ArrowRight size={11} /> : dir === 'ba' ? <ArrowLeft size={11} /> : <ArrowLeftRight size={11} />;
                    const title = dir === 'ab' ? 'A → B' : dir === 'ba' ? 'B → A' : 'A ↔ B';
                    return (
                      <button
                        key={dir}
                        onClick={() => setConnectDir(dir)}
                        title={title}
                        style={{
                          ...btnBase, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px 0',
                          background: connectDir === dir ? 'var(--accent)' : 'var(--bg-secondary)',
                          border: `1px solid ${connectDir === dir ? 'var(--accent)' : 'var(--border)'}`,
                          color: connectDir === dir ? '#fff' : 'var(--text-secondary)',
                        }}
                      >
                        {icon}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="text"
                    placeholder="Edge label…"
                    value={connectLabel}
                    onChange={e => { setConnectLabel(e.target.value); setConnectError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleConnect()}
                    style={{
                      flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)',
                      color: 'var(--text-primary)', padding: '3px 7px',
                      borderRadius: 4, outline: 'none', fontSize: 11, height: 24,
                    }}
                  />
                  <button
                    onClick={handleConnect}
                    disabled={connectLoading}
                    style={{ ...btnBase, background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600, opacity: connectLoading ? 0.7 : 1 }}
                  >
                    {connectLoading ? '…' : 'Link'}
                  </button>
                </div>
                {connectError && <span style={{ fontSize: 10, color: '#ff6b6b' }}>{connectError}</span>}
              </div>
            )}
            {/* Tag all */}
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                type="text"
                placeholder="Tag all with…"
                value={selTagInput}
                onChange={e => setSelTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSelectionTag()}
                style={{
                  flex: 1, background: 'var(--bg-primary)',
                  border: '1px solid var(--border)', color: 'var(--text-primary)',
                  padding: '3px 7px', borderRadius: 4, outline: 'none', fontSize: 11, height: 24,
                }}
              />
              <button onClick={handleSelectionTag} style={{ ...btnBase, background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600 }}>
                Tag
              </button>
            </div>
            {/* Inline relate form */}
            {!showRelateForm ? (
              <button
                onClick={() => setShowRelateForm(true)}
                style={{ ...btnBase, width: '100%', textAlign: 'center' }}
              >
                Relate selection…
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--text-hint)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Relate {selectedIds.length} → target
                </span>
                <input
                  autoFocus
                  type="text"
                  placeholder="Edge label…"
                  value={relateEdgeLabel}
                  onChange={e => setRelateEdgeLabel(e.target.value)}
                  style={{
                    background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', padding: '3px 7px',
                    borderRadius: 4, outline: 'none', fontSize: 11, height: 24,
                  }}
                />
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="Search target entity…"
                    value={relateSearch}
                    onChange={e => { setRelateSearch(e.target.value); setRelateTargetId(''); }}
                    style={{
                      width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)',
                      color: 'var(--text-primary)', padding: '3px 7px',
                      borderRadius: 4, outline: 'none', fontSize: 11, height: 24, boxSizing: 'border-box',
                    }}
                  />
                  {relateSearch.length > 0 && !relateTargetId && relateCandidates.length > 0 && (
                    <div style={{
                      position: 'absolute', top: 27, left: 0, right: 0,
                      maxHeight: 140, overflowY: 'auto',
                      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                      borderRadius: 4, zIndex: 300, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                    }}>
                      {relateCandidates.map((e: any) => (
                        <div
                          key={e.id}
                          onMouseDown={() => {
                            setRelateTargetId(e.id);
                            setRelateSearch(resolvedLabel(e, allLabelTraits, activeLocale));
                          }}
                          style={{
                            padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                            color: 'var(--text-primary)', borderBottom: '1px solid var(--border)',
                          }}
                          onMouseEnter={el => (el.currentTarget.style.background = 'var(--bg-primary)')}
                          onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                        >
                          {resolvedLabel(e, allLabelTraits, activeLocale)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {relateError && <span style={{ fontSize: 10, color: '#ff6b6b' }}>{relateError}</span>}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={handleRelateCreate}
                    disabled={relateLoading}
                    style={{ ...btnBase, flex: 1, background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600, opacity: relateLoading ? 0.7 : 1 }}
                  >
                    {relateLoading ? 'Linking…' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setShowRelateForm(false); setRelateSearch(''); setRelateTargetId(''); setRelateEdgeLabel(''); setRelateError(''); }}
                    style={{ ...btnBase, width: 52 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {/* Delete trigger — opens the inline confirm above this section */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{ ...btnBase, width: '100%', textAlign: 'center', color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.4)' }}
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

    </div>
  );
});
