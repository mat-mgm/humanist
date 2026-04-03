import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
// @ts-ignore
import ForceGraph2D from 'force-graph';
import { useOsStore } from '../store';
import { RelateDialog } from './RelateDialog';

interface GNode { id: string; label: string; kind: string; }


const KIND_COLORS: Record<string, string> = {
  physical: '#6de096',
  digital: '#7eb0ff',
  abstract: '#f5d060',
  agent: '#d680ff',
  blob: '#ff9f43',
};

const selectEntities = (s: ReturnType<typeof useOsStore.getState>) => s.entities;
const selectEdges = (s: ReturnType<typeof useOsStore.getState>) => s.edges;
const selectSelectedId = (s: ReturnType<typeof useOsStore.getState>) => s.selectedEntityId;
const selectSelectEntity = (s: ReturnType<typeof useOsStore.getState>) => s.selectEntity;
const selectBlobTraits = (s: ReturnType<typeof useOsStore.getState>) => s.blobTraits;

export const GraphPanel = memo(function GraphPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const readyRef = useRef(false);

  const entities = useOsStore(selectEntities);
  const edges = useOsStore(selectEdges);
  const selectedId = useOsStore(selectSelectedId);
  const selectEntity = useOsStore(selectSelectEntity);

  const [searchQuery, setSearchQuery] = useState('');
  const [showGrid, setShowGrid] = useState(true);

  const nodePositions = useOsStore(s => s.nodePositions);
  const updateNodePosition = useOsStore(s => s.updateNodePosition);
  const blobTraits = useOsStore(selectBlobTraits);
  const { deleteEntity, tagEntity } = useOsStore();

  const [toggledImageNodes, setToggledImageNodes] = useState<Set<string>>(new Set());

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string; nodeLabel: string } | null>(null);
  const [showRelate, setShowRelate] = useState(false);
  const [quickTagNode, setQuickTagNode] = useState<{ id: string; label: string } | null>(null);
  const [quickTagInput, setQuickTagInput] = useState('');

  const searchQueryRef = useRef('');
  const selectedIdRef = useRef<string | null>(null);
  const showGridRef = useRef(true);
  const blobTraitsRef = useRef(blobTraits);
  const toggledImageNodesRef = useRef(toggledImageNodes);
  const prevCounts = useRef({ entities: 0, edges: 0 });

  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => { blobTraitsRef.current = blobTraits; }, [blobTraits]);
  useEffect(() => {
    toggledImageNodesRef.current = toggledImageNodes;
    if (readyRef.current && graphRef.current) {
      graphRef.current.nodeColor(graphRef.current.nodeColor());
    }
  }, [toggledImageNodes]);

  const onNodeClick = useCallback((node: any) => {
    // Keep full "entity:" prefix so ViewportPanel can find it in the store
    const nodeId: string = (node as GNode).id;
    const fullId = nodeId.startsWith('entity:') ? nodeId : `entity:${nodeId}`;
    if (selectedIdRef.current === fullId) {
      setToggledImageNodes(prev => {
        const next = new Set(prev);
        if (next.has(fullId)) next.delete(fullId);
        else next.add(fullId);
        return next;
      });
    } else {
      selectEntity(fullId);
    }
    setCtxMenu(null);
  }, [selectEntity]);

  const onNodeRightClick = useCallback((node: any, event: MouseEvent) => {
    event.preventDefault();
    const nodeId: string = (node as GNode).id;
    const fullId = nodeId.startsWith('entity:') ? nodeId : `entity:${nodeId}`;
    selectEntity(fullId);
    setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: fullId, nodeLabel: node.label ?? nodeId });
  }, [selectEntity]);

  // Bootstrap once
  useEffect(() => {
    if (!containerRef.current || readyRef.current) return;
    readyRef.current = true;

    // Resolving theme strings safely ahead of mapping
    const g = (ForceGraph2D as any)()(containerRef.current)
      .graphData({ nodes: [], links: [] })
      .backgroundColor('rgba(0,0,0,0)')
      .linkColor((link: any) => {
        const sq = searchQueryRef.current.toLowerCase();
        const sm = !sq || (link.source?.label && link.source.label.toLowerCase().includes(sq));
        const tm = !sq || (link.target?.label && link.target.label.toLowerCase().includes(sq));
        const baseColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#a0a0a0';
        return (sq && !sm && !tm) ? 'rgba(100, 100, 100, 0.15)' : baseColor;
      })
      .linkWidth(1.5)
      .linkDirectionalArrowLength(5)
      .linkDirectionalArrowRelPos(1)
      .onNodeClick(onNodeClick)
      .onNodeRightClick(onNodeRightClick)
      .nodeCanvasObject((n: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        if (n.x == null || n.y == null || Number.isNaN(n.x) || Number.isNaN(n.y)) return;

        const sq = searchQueryRef.current.toLowerCase();
        const isMatch = sq ? n.label?.toLowerCase().includes(sq) : true;
        // selectedIdRef stores full id like "entity:XYZ", node.id is stripped "XYZ"
        const isSelected = `entity:${n.id}` === selectedIdRef.current;

        ctx.globalAlpha = (!sq || isMatch) ? 1 : 0.2;

        const radius = 6;
        let isImageReady = false;

        const bTraits = blobTraitsRef.current;
        const fullId = `entity:${n.id}`;
        const blobTrait = bTraits.find(b => b.owner === fullId || b.owner === n.id);
        const sourcePath = blobTrait?.localUrl;
        const isImage = blobTrait && blobTrait.mime.startsWith('image/');
        const isToggled = toggledImageNodesRef.current.has(fullId);

        if (isImage && sourcePath && isToggled) {
          if (!n.img) {
            n.img = new Image();
            n.img.src = convertFileSrc(sourcePath);
            n.img.onload = () => {
              if (readyRef.current && graphRef.current) {
                // Touch accessor to force canvas re-render
                graphRef.current.nodeColor(graphRef.current.nodeColor());
              }
            };
          }

          if (n.img.complete && n.img.naturalWidth > 0) {
            isImageReady = true;
            const maxDim = 80;
            const aspect = n.img.naturalWidth / n.img.naturalHeight;
            let w = maxDim;
            let h = maxDim;
            if (aspect > 1) {
              h = maxDim / aspect;
            } else {
              w = maxDim * aspect;
            }
            n.__imgW = w;
            n.__imgH = h;

            ctx.save();
            ctx.drawImage(n.img, n.x - w / 2, n.y - h / 2, w, h);
            ctx.restore();

            // outline for image node
            ctx.beginPath();
            ctx.rect(n.x - w / 2, n.y - h / 2, w, h);
            ctx.lineWidth = 1.5 / globalScale;
            ctx.strokeStyle = KIND_COLORS[n.kind] ?? '#8b91a8';
            ctx.stroke();
          }
        }

        if (!isImageReady) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = KIND_COLORS[n.kind] ?? '#8b91a8';
          ctx.fill();
        }

        // Selection Ring (Theme Dependant)
        if (isSelected) {
          ctx.beginPath();
          if (isImageReady && n.__imgW) {
            ctx.rect(n.x - n.__imgW / 2 - 2, n.y - n.__imgH / 2 - 2, n.__imgW + 4, n.__imgH + 4);
          } else {
            ctx.arc(n.x, n.y, radius + 1.5, 0, 2 * Math.PI, false);
          }
          ctx.lineWidth = 2.5 / globalScale; // Thick outline
          const accentObj = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b8af0';
          ctx.strokeStyle = accentObj; // Accent color
          ctx.stroke();
        }

        if (globalScale > 0.8) {
          const fontSize = 4; // Scaled relative to the 6px node
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const txtCol = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e4e6f0';
          ctx.fillStyle = txtCol;
          ctx.font = `${fontSize}px "JetBrains Mono", sans-serif`;
          ctx.fillText(n.label, n.x, n.y + (isImageReady ? (n.__imgH / 2 + 5) : radius + 3.5));
        }
        ctx.globalAlpha = 1;
      })
      .linkCanvasObjectMode(() => 'after')
      .linkCanvasObject((link: any, ctx: CanvasRenderingContext2D) => {
        const sq = searchQueryRef.current.toLowerCase();
        const sm = !sq || (link.source?.label && link.source.label.toLowerCase().includes(sq));
        const tm = !sq || (link.target?.label && link.target.label.toLowerCase().includes(sq));
        if (sq && !sm && !tm) return; // faded

        if (!link.source || !link.target || typeof link.source !== 'object' || typeof link.target !== 'object') return;
        if (link.source.x == null || link.source.y == null || Number.isNaN(link.source.x) || Number.isNaN(link.source.y)) return;
        if (link.target.x == null || link.target.y == null || Number.isNaN(link.target.x) || Number.isNaN(link.target.y)) return;
        if (link.source.id === link.target.id) return; // Hide text over self-loop clumps

        const label = link.label;
        if (!label) return;

        const fontSize = 3; // Even smaller for edges
        ctx.font = `${fontSize}px "JetBrains Mono", sans-serif`;
        const textWidth = ctx.measureText(label).width;
        const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);

        const x = link.source.x + (link.target.x - link.source.x) / 2;
        const y = link.source.y + (link.target.y - link.source.y) / 2;

        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim() || '#1a1b26';
        ctx.fillStyle = bgColor;
        ctx.fillRect(x - bckgDimensions[0] / 2, y - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const txtSec = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#8b91a8';
        ctx.fillStyle = txtSec; // theme dependent visible edge text
        ctx.fillText(label, x, y);
      })
      .onRenderFramePre((ctx: CanvasRenderingContext2D, _globalScale: number) => {
        if (!showGridRef.current) return;

        const canvas = ctx.canvas;
        const width = canvas.width;
        const height = canvas.height;

        // d3-zoom stores its state on the element as __zoom (an internal property)
        const t = (canvas as any).__zoom ?? { x: 0, y: 0, k: 1 };
        const tx = t.x;
        const ty = t.y;
        const k = t.k;

        const spacing = 50 * k;
        if (spacing < 4) return; // perf guard

        ctx.save();
        ctx.resetTransform();
        const borderCol =
          getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#444';

        // Major grid lines (every 5 cells)
        const majorSpacing = spacing * 5;
        ctx.beginPath();
        ctx.strokeStyle = borderCol;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.5;
        for (let x = ((tx % majorSpacing) + majorSpacing) % majorSpacing; x < width; x += majorSpacing) {
          ctx.moveTo(x, 0); ctx.lineTo(x, height);
        }
        for (let y = ((ty % majorSpacing) + majorSpacing) % majorSpacing; y < height; y += majorSpacing) {
          ctx.moveTo(0, y); ctx.lineTo(width, y);
        }
        ctx.stroke();

        // Minor grid lines
        ctx.beginPath();
        ctx.globalAlpha = 0.18;
        ctx.lineWidth = 0.75;
        for (let x = ((tx % spacing) + spacing) % spacing; x < width; x += spacing) {
          ctx.moveTo(x, 0); ctx.lineTo(x, height);
        }
        for (let y = ((ty % spacing) + spacing) % spacing; y < height; y += spacing) {
          ctx.moveTo(0, y); ctx.lineTo(width, y);
        }
        ctx.stroke();

        ctx.restore();
      })
      .cooldownTicks(300)
      .d3AlphaDecay(0.02)
      .d3VelocityDecay(0.3);

    // Softer repulsion so isolated nodes don't fly off violently
    g.d3Force('charge').strength(-50).distanceMin(8).distanceMax(300);
    g.d3Force('link').distance(40);

    // Position persistence sync only if user is dragging or sim has high energy
    g.onNodeDragEnd((node: any) => {
      if (node.id) updateNodePosition(node.id, node.x, node.y);
    });

    graphRef.current = g;
  }, []);

  // Update nodes + edges — always read live nodes first to preserve positions/fx/fy
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;

    // Get the *live* node objects that force-graph is currently managing.
    // These carry simulation state: x, y, vx, vy, fx, fy.
    const { nodes: liveNodes, links: liveLinks } = g.graphData() as { nodes: any[]; links: any[] };

    if (entities.length === prevCounts.current.entities && edges.length === prevCounts.current.edges) {
      // Just update labels/kinds in place without resetting graphData!
      for (const e of entities) {
        const live = liveNodes.find((n: any) => n.id === e.id);
        if (live) {
          live.label = e.label;
          live.kind = e.kind;
          live.metadata = e.metadata;
        }
      }
      for (const edge of edges) {
        const live = liveLinks.find((l: any) => {
          const sId = typeof l.source === 'object' ? l.source.id : l.source;
          const tId = typeof l.target === 'object' ? l.target.id : l.target;
          return sId === edge.from && tId === edge.to;
        });
        if (live) {
          live.label = edge.label;
        }
      }

      // Force visual update without simulation reset
      g.nodeLabel(g.nodeLabel()).linkLabel(g.linkLabel());
      return;
    }
    prevCounts.current = { entities: entities.length, edges: edges.length };

    const liveById = new Map<string, any>(liveNodes.map((n: any) => [n.id, n]));

    // Also map live links by source-target to preserve object identity
    const liveLinksMap = new Map<string, any>(
      liveLinks.map((l: any) => {
        const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
        const targetId = typeof l.target === 'object' ? l.target.id : l.target;
        return [`${sourceId}-${targetId}`, l];
      })
    );

    // Strict exact ID mapping to absolutely forbid cross-matching or undefined lookups
    const nextNodes: any[] = [];
    for (const entity of entities) {
      const strippedId = entity.id.replace('entity:', '');
      const live = liveById.get(strippedId);
      const saved = nodePositions[strippedId];

      if (live) {
        live.label = entity.label;
        live.kind = entity.kind;
        live.metadata = entity.metadata;
        nextNodes.push(live);
      } else {
        // Init with saved position to prevent "scattering" on remount
        nextNodes.push({
          id: strippedId,
          label: entity.label,
          kind: entity.kind,
          metadata: entity.metadata,
          x: saved?.x,
          y: saved?.y
        });
      }
    }

    const nextNodesMap = new Map<string, any>(nextNodes.map(n => [n.id, n]));
    const nextLinks: any[] = [];
    for (const e of edges) {
      const sourceNodeId = e.from.replace('entity:', '');
      const targetNodeId = e.to.replace('entity:', '');

      if (!nextNodesMap.has(sourceNodeId) || !nextNodesMap.has(targetNodeId)) continue;
      if (sourceNodeId === targetNodeId) continue; // Forbid self loops

      const key = `${sourceNodeId}-${targetNodeId}`;
      if (liveLinksMap.has(key)) {
        const liveLink = liveLinksMap.get(key)!;
        liveLink.label = e.label;
        nextLinks.push(liveLink);
      } else {
        nextLinks.push({ source: sourceNodeId, target: targetNodeId, label: e.label });
      }
    }

    g.graphData({ nodes: nextNodes, links: nextLinks });
  }, [entities, edges, nodePositions]);

  // Trigger repaint completely when selection or search changes
  useEffect(() => {
    // Trick to force canvas re-render: Touch nodeColor getter
    graphRef.current?.nodeColor(graphRef.current?.nodeColor());
    graphRef.current?.linkColor(graphRef.current?.linkColor());
  }, [selectedId, searchQuery, showGrid, blobTraits]);

  // Responsive resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      graphRef.current?.width(el.clientWidth).height(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="panel graph-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-stats" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="event-badge">{entities.length} nodes · {edges.length} edges</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
            Grid
          </label>
          <button
            onClick={() => {
              if (graphRef.current) {
                // To avoid sending camera to infinity on zoomToFit (if padding algorithm glitches with sparse nodes), 
                // just command a flat zoom reduction centered exactly physically inside the bounds.
                graphRef.current.zoom(1, 400);
                setTimeout(() => graphRef.current?.zoomToFit(400, 30), 450);
              }
            }}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '2px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Reset View
          </button>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '2px 8px',
              borderRadius: 4,
              outline: 'none',
              fontSize: 12,
              width: 150
            }}
          />
        </div>
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, width: '100%', minHeight: 0, overflow: 'hidden' }}
        onClick={() => setCtxMenu(null)}
      />

      {/* Graph node right-click context menu */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed', zIndex: 500,
            left: ctxMenu.x, top: ctxMenu.y,
            background: 'var(--bg-panel)', border: '1px solid var(--border)',
            borderRadius: 7, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            minWidth: 140, padding: '4px 0',
          }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          {[
            { label: 'Inspect', action: () => { selectEntity(ctxMenu.nodeId); setCtxMenu(null); } },
            { label: 'Relate…', action: () => { setShowRelate(true); setCtxMenu(null); } },
            { label: 'Tag…', action: () => { setQuickTagNode({ id: ctxMenu.nodeId, label: ctxMenu.nodeLabel }); setCtxMenu(null); } },
            { label: 'Delete', action: () => { deleteEntity(ctxMenu.nodeId); setCtxMenu(null); }, danger: true },
          ].map(item => (
            <div
              key={item.label}
              onClick={item.action}
              style={{
                padding: '7px 14px', fontSize: 12, cursor: 'pointer',
                color: (item as any).danger ? '#ff6b6b' : 'var(--text-primary)',
              }}
              onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
              onMouseLeave={ev => (ev.currentTarget.style.background = '')}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}

      {/* Quick tag from graph */}
      {quickTagNode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setQuickTagNode(null); }}
        >
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 9, padding: '20px 24px', minWidth: 300, boxShadow: '0 6px 32px rgba(0,0,0,0.5)' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>Add tag to <strong>{quickTagNode.label}</strong></p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input autoFocus type="text" value={quickTagInput}
                onChange={e => setQuickTagInput(e.target.value)}
                onKeyDown={async ev => {
                  if (ev.key === 'Enter') { await tagEntity(quickTagNode!.id, quickTagInput.trim()); setQuickTagNode(null); setQuickTagInput(''); }
                  if (ev.key === 'Escape') setQuickTagNode(null);
                }}
                placeholder="Tag name…"
                style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }}
              />
              <button onClick={async () => { await tagEntity(quickTagNode!.id, quickTagInput.trim()); setQuickTagNode(null); setQuickTagInput(''); }}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Tag</button>
            </div>
          </div>
        </div>
      )}

      {showRelate && ctxMenu && (
        <RelateDialog
          sourceEntityId={ctxMenu.nodeId}
          sourceLabel={ctxMenu.nodeLabel}
          onClose={() => setShowRelate(false)}
        />
      )}
    </div>
  );
});
