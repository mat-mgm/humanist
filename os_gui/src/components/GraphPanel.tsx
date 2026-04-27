import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
// @ts-ignore
import ForceGraph2D from 'force-graph';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

import { useOsStore, entityValues, resolvedLabel } from '../store';
import { logFrontend } from '../lib/log';
import { RelateDialog } from './RelateDialog';
import { getConvexHull, drawRoundedHullPath, getStableColor } from '../utils/graphUtils';
import {
  KEYBINDS,
  KIND_COLORS,
  REGION_STYLE,
  GRAPH_PRESETS,
  GRAPH_PERF,
  type GraphLayoutMode,
} from '../config';

interface GNode {
  id: string;
  label: string;
  category: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
  img?: HTMLImageElement | HTMLCanvasElement;
  isPdfLoading?: boolean;
  __imgW?: number;
  __imgH?: number;
  metadata?: any;
}

const selectEntities = (s: any) => s.entities;
const selectEdges = (s: any) => s.edges;
const selectSelectedId = (s: any) => s.selectedEntityId;
const selectSelectEntity = (s: any) => s.selectEntity;
const selectBlobTraits = (s: any) => s.blobTraits;
const selectKeyValueTraits = (s: any) => s.keyValueTraits;
const selectDeleteEntity = (s: any) => s.deleteEntity;
const selectDeleteEntities = (s: any) => s.deleteEntities;
const selectTagEntity = (s: any) => s.tagEntity;
const selectTagEntities = (s: any) => s.tagEntities;
const selectShowRegions = (s: any) => s.showRegions;
const selectUpdateNodePosition = (s: any) => s.updateNodePosition;
const selectNodePositions = (s: any) => s.nodePositions;
const selectFilterKinds = (s: any) => s.filterKinds;
const selectFilterEdgeLabels = (s: any) => s.filterEdgeLabels;
const selectShowDerivedEdges = (s: any) => s.showDerivedEdges;
const selectOverlayEdges = (s: any) => s.overlayEdges;
const selectHighlightedPath = (s: any) => s.highlightedPath;
const selectHighlightedEdgeKeys = (s: any) => s.highlightedEdgeKeys;
const selectLoadExactIds = (s: any) => s.loadExactIds;
const selectGraphMode = (s: any) => s.graphMode;
const selectSetGraphResetViewFn = (s: any) => s.setGraphResetViewFn;
const selectAllLabelTraits = (s: any) => s.allLabelTraits;
const selectActiveLocale = (s: any) => s.activeLocale;
const selectGraphExploreQuery = (s: any) => s.graphExploreQuery;
const selectGraphShowGrid = (s: any) => s.graphShowGrid;
const selectSetGraphExploreQuery = (s: any) => s.setGraphExploreQuery;
const selectSetGraphExploreStatus = (s: any) => s.setGraphExploreStatus;
const selectRelationshipTypes = (s: any) => s.relationshipTypes;
const selectGraphLoading = (s: any) => s.graphLoading;
const selectBackgroundStyle = (s: any) => s.backgroundStyle;
const selectRegionStyle = (s: any) => s.regionStyle;
const selectGraphLayoutMode = (s: any) => s.graphLayoutMode;
const selectGraphSimulationPaused = (s: any) => s.graphSimulationPaused;
const selectGraphShowNodeLabels = (s: any) => s.graphShowNodeLabels;
const selectGraphShowEdgeLabels = (s: any) => s.graphShowEdgeLabels;
const selectGraphHiddenRelationshipLabels = (s: any) => s.graphHiddenRelationshipLabels;
const selectGraphHiddenLabelCategories = (s: any) => s.graphHiddenLabelCategories;

export const GraphPanel = memo(function GraphPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const readyRef = useRef(false);

  const entities = useOsStore(selectEntities);
  const edges = useOsStore(selectEdges);
  const selectedId = useOsStore(selectSelectedId);
  const selectedIds = useOsStore((s: any) => s.selectedIds);
  const selectEntity = useOsStore(selectSelectEntity);
  const setSelectedIds = useOsStore((s: any) => s.setSelectedIds);
  const toggleSelection = useOsStore((s: any) => s.toggleSelection);
  const blobTraits = useOsStore(selectBlobTraits);
  const keyValueTraits = useOsStore(selectKeyValueTraits);
  const deleteEntity = useOsStore(selectDeleteEntity);
  const deleteEntities = useOsStore(selectDeleteEntities);
  const tagEntity = useOsStore(selectTagEntity);
  const tagEntities = useOsStore(selectTagEntities);
  const showRegions = useOsStore(selectShowRegions);
  const updateNodePosition = useOsStore(selectUpdateNodePosition);
  const nodePositions = useOsStore(selectNodePositions);
  const filterKinds = useOsStore(selectFilterKinds);
  const filterEdgeLabels = useOsStore(selectFilterEdgeLabels);
  const showDerivedEdges = useOsStore(selectShowDerivedEdges);
  const overlayEdges = useOsStore(selectOverlayEdges);
  const highlightedPath = useOsStore(selectHighlightedPath);
  const highlightedEdgeKeys = useOsStore(selectHighlightedEdgeKeys);
  const loadExactIds = useOsStore(selectLoadExactIds);
  const graphMode = useOsStore(selectGraphMode);
  const setGraphResetViewFn = useOsStore(selectSetGraphResetViewFn);
  const allLabelTraits = useOsStore(selectAllLabelTraits);
  const activeLocale = useOsStore(selectActiveLocale);

  const relationshipTypes  = useOsStore(selectRelationshipTypes);
  const graphLoading       = useOsStore(selectGraphLoading);
  const backgroundStyle    = useOsStore(selectBackgroundStyle);
  const regionStyle        = useOsStore(selectRegionStyle);
  const graphLayoutMode    = useOsStore(selectGraphLayoutMode);
  const simulationPaused   = useOsStore(selectGraphSimulationPaused);
  const showNodeLabels     = useOsStore(selectGraphShowNodeLabels);
  const showEdgeLabels     = useOsStore(selectGraphShowEdgeLabels);
  const hiddenRelationshipLabels = useOsStore(selectGraphHiddenRelationshipLabels);
  const hiddenLabelCategories = useOsStore(selectGraphHiddenLabelCategories);
  const clearSelection     = useOsStore((s: any) => s.clearSelection);

  // Toolbar state — now lives in the store so GraphSidePanel can share it
  const exploreQuery     = useOsStore(selectGraphExploreQuery);
  const showGrid         = useOsStore(selectGraphShowGrid);
  const setExploreQuery  = useOsStore(selectSetGraphExploreQuery);
  const setExploreStatus = useOsStore(selectSetGraphExploreStatus);

  const exploreDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // searchQuery mirrors exploreQuery for canvas highlight
  const [searchQuery, setSearchQuery] = useState('');
  const toggledImageNodes = useOsStore((s: any) => s.toggledImageNodes);
  const toggleImageNode = useOsStore((s: any) => s.toggleImageNode);
  // Keyboard focus cursor — moves with arrow keys, independent of selection
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const focusedNodeIdRef = useRef<string | null>(null);

  // Used to recreate the ForceGraph2D instance on full-load completion, avoiding
  // the WKWebView "The object can not be found here" DOMException.
  const [graphMountKey, setGraphMountKey] = useState(0);
  const prevLoadingRef = useRef(graphLoading);
  const skipNextFeedRef = useRef(false);

  // Selected link state (for edge selection + reification)
  const selectedLinkRef = useRef<{ source: string; target: string; label: string } | null>(null);
  const [selectedLinkMenu, setSelectedLinkMenu] = useState<{
    x: number; y: number; source: string; target: string; label: string;
  } | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string; nodeLabel: string } | null>(null);
  const [showRelate, setShowRelate] = useState(false);
  const [quickTagNode, setQuickTagNode] = useState<{ id: string; label: string } | null>(null);
  const [quickTagInput, setQuickTagInput] = useState('');
  const setShowDeleteConfirm = useOsStore((s: any) => s.setShowDeleteConfirm);

  // Marquee selection state
  const selectionBoxRef = useRef<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  // Screen-space start point for the overlay (in container-relative pixels)
  const selectionStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  // Screen-space rect for the overlay div (in px, relative to container)
  const [selectionBoxScreen, setSelectionBoxScreen] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const isDraggingSelection = useRef(false);

  const searchQueryRef = useRef('');
  const selectedIdRef = useRef<string | null>(null);
  const showGridRef = useRef(true);
  const showRegionsRef = useRef(true);
  const blobTraitsRef = useRef(blobTraits);
  const toggledImageNodesRef = useRef(toggledImageNodes);
  const selectedIdsRef = useRef(selectedIds);
  const highlightedPathRef = useRef<string[]>([]);
  const highlightedEdgeKeysRef = useRef<Set<string>>(new Set());
  const backgroundStyleRef = useRef<'grid' | 'dots'>(backgroundStyle);
  const regionStyleRef = useRef<'hatch' | 'fill'>(regionStyle);
  const relationshipTypesRef = useRef(relationshipTypes);
  // Set of edge labels that should be hidden visually (but kept in force sim)
  const invisibleLabelsRef = useRef<Set<string>>(new Set());
  // label → RelationshipType for O(1) lookup during rendering
  const relTypeMapRef = useRef<Map<string, any>>(new Map());
  const hiddenRelationshipLabelsRef = useRef<Set<string>>(new Set(hiddenRelationshipLabels));
  // Live label-visibility refs (read by canvas object callbacks each frame)
  const showNodeLabelsRef = useRef<boolean>(showNodeLabels);
  const showEdgeLabelsRef = useRef<boolean>(showEdgeLabels);
  const hiddenLabelCategoriesRef = useRef<Set<string>>(new Set(hiddenLabelCategories));
  // Captures the rect-collide resolver so the render-post hook (set up at
  // graph bootstrap) can re-run it each frame without rebuilding the closure.
  const resolveRectCollisionsRef = useRef<(() => void) | null>(null);
  // Live-tunable gravity strength. The d3Force callback (registered once at
  // bootstrap) reads from this ref so layout-mode changes apply without
  // tearing down the simulation.
  const gravityStrengthRef = useRef<number>(GRAPH_PRESETS.default.gravityStrength);
  // Cached theme color lookups, refreshed on theme transitions. Avoids
  // calling `getComputedStyle(document.documentElement)` on every drawn node
  // and edge — that's the single biggest hot-path cost in dense graphs.
  const themeColorsRef = useRef({
    accent: '#5b8af0',
    textPrimary: '#e4e6f0',
    textSecondary: '#a0a0a0',
    border: '#444',
    bgPanel: '#1a1b26',
    graphPath: '#f5a623',
  });
  useEffect(() => {
    const refreshColors = () => {
      const cs = getComputedStyle(document.documentElement);
      themeColorsRef.current = {
        accent:        cs.getPropertyValue('--accent').trim()         || '#5b8af0',
        textPrimary:   cs.getPropertyValue('--text-primary').trim()   || '#e4e6f0',
        textSecondary: cs.getPropertyValue('--text-secondary').trim() || '#a0a0a0',
        border:        cs.getPropertyValue('--border').trim()         || '#444',
        bgPanel:       cs.getPropertyValue('--bg-panel').trim()       || '#1a1b26',
        graphPath:     cs.getPropertyValue('--graph-path').trim()     || '#f5a623',
      };
      if (readyRef.current && graphRef.current) {
        graphRef.current.nodeColor(graphRef.current.nodeColor());
      }
    };
    refreshColors();
    const observer = new MutationObserver(refreshColors);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);

  // Phase 44: SQL passthrough — debounced only for SELECT queries; dropdown uses local filter
  useEffect(() => {
    setSearchQuery(exploreQuery); // keep canvas highlight in sync
    const q = exploreQuery.trim();
    if (!/^select\s/i.test(q)) return; // non-SQL handled by filteredDropdown
    if (exploreDebounceRef.current) clearTimeout(exploreDebounceRef.current);
    exploreDebounceRef.current = setTimeout(async () => {
      try {
        const ids = await invoke<string[]>('query_entity_ids', { query: q });
        if (ids.length > 0) {
          await loadExactIds(ids);
          setExploreQuery('');
          setExploreStatus(`${ids.length} entit${ids.length === 1 ? 'y' : 'ies'} loaded`);
          setTimeout(() => setExploreStatus(null), 2500);
          setTimeout(() => graphRef.current?.zoomToFit(400, 30), 150);
        } else {
          setExploreStatus('No entities found');
          setTimeout(() => setExploreStatus(null), 2000);
        }
      } catch (e) {
        console.error('explore sql error:', e);
        setExploreStatus('Query error');
        setTimeout(() => setExploreStatus(null), 2000);
      }
    }, 250);
  }, [exploreQuery]);

  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => { showRegionsRef.current = showRegions; }, [showRegions]);
  useEffect(() => { blobTraitsRef.current = blobTraits; }, [blobTraits]);
  useEffect(() => { focusedNodeIdRef.current = focusedNodeId; }, [focusedNodeId]);
  useEffect(() => { backgroundStyleRef.current = backgroundStyle; }, [backgroundStyle]);
  useEffect(() => { regionStyleRef.current = regionStyle; }, [regionStyle]);
  useEffect(() => {
    showNodeLabelsRef.current = showNodeLabels;
    if (readyRef.current && graphRef.current) graphRef.current.nodeColor(graphRef.current.nodeColor());
  }, [showNodeLabels]);
  useEffect(() => {
    showEdgeLabelsRef.current = showEdgeLabels;
    if (readyRef.current && graphRef.current) graphRef.current.linkColor(graphRef.current.linkColor());
  }, [showEdgeLabels]);
  useEffect(() => {
    hiddenRelationshipLabelsRef.current = new Set(hiddenRelationshipLabels);
    if (readyRef.current && graphRef.current) graphRef.current.linkColor(graphRef.current.linkColor());
  }, [hiddenRelationshipLabels]);
  useEffect(() => {
    hiddenLabelCategoriesRef.current = new Set(hiddenLabelCategories);
    if (readyRef.current && graphRef.current) graphRef.current.nodeColor(graphRef.current.nodeColor());
  }, [hiddenLabelCategories]);

  // Apply layout-mode preset to the live simulation whenever it changes.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !readyRef.current) return;
    const p = GRAPH_PRESETS[graphLayoutMode as GraphLayoutMode] ?? GRAPH_PRESETS.default;
    g.cooldownTicks(p.cooldownTicks).d3AlphaDecay(p.alphaDecay).d3VelocityDecay(p.velocityDecay);
    const charge = g.d3Force('charge');
    if (charge) charge.strength(p.chargeStrength).distanceMin(p.chargeDistanceMin).distanceMax(p.chargeDistanceMax);
    const link = g.d3Force('link');
    if (link) link.distance(p.linkDistance);
    gravityStrengthRef.current = p.gravityStrength;
    g.d3ReheatSimulation();
  }, [graphLayoutMode]);

  // Pause / resume the d3 simulation when the user toggles the play/pause button.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !readyRef.current) return;
    if (simulationPaused) {
      g.pauseAnimation();
    } else {
      g.resumeAnimation();
      g.d3ReheatSimulation();
    }
  }, [simulationPaused]);
  const overlayEdgesRef = useRef<typeof overlayEdges>([]);
  useEffect(() => { overlayEdgesRef.current = overlayEdges; }, [overlayEdges]);
  useEffect(() => {
    relationshipTypesRef.current = relationshipTypes;
    invisibleLabelsRef.current = new Set(
      relationshipTypes.filter((rt: any) => rt.visible === false).map((rt: any) => rt.label)
    );
    relTypeMapRef.current = new Map(
      relationshipTypes.map((rt: any) => [rt.label, rt])
    );
    // Refresh link visuals when visibility / style flags change
    if (readyRef.current && graphRef.current) {
      graphRef.current.linkColor(graphRef.current.linkColor());
      graphRef.current.linkWidth(graphRef.current.linkWidth());
    }
  }, [relationshipTypes]);
  useEffect(() => {
    highlightedPathRef.current = highlightedPath;
    highlightedEdgeKeysRef.current = highlightedEdgeKeys;
    if (readyRef.current && graphRef.current) {
      graphRef.current.nodeColor(graphRef.current.nodeColor());
      graphRef.current.linkColor(graphRef.current.linkColor());
    }
  }, [highlightedPath, highlightedEdgeKeys]);
  useEffect(() => {
    toggledImageNodesRef.current = toggledImageNodes;
    if (readyRef.current && graphRef.current) {
      graphRef.current.nodeColor(graphRef.current.nodeColor());
      // Reheat so the rectCollide force can resolve any new overlaps the
      // freshly opened (or freshly closed) preview rectangle introduces.
      graphRef.current.d3ReheatSimulation();
    }
  }, [toggledImageNodes]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const lastClickRef = useRef<{ id: string; time: number } | null>(null);

  const onNodeClick = useCallback((node: any, event: MouseEvent) => {
    const nodeId: string = (node as GNode).id;
    const fullId = nodeId.startsWith('entity:') ? nodeId : `entity:${nodeId}`;

    if (KEYBINDS.multiSelectModifier(event)) {
      toggleSelection(fullId);
      return;
    }

    // Double-click detection: two clicks on the same node within 400 ms toggles media preview
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.id === fullId && now - last.time < 400) {
      lastClickRef.current = null;
      toggleImageNode(fullId);
      return;
    }
    lastClickRef.current = { id: fullId, time: now };

    selectEntity(fullId);
    setCtxMenu(null);
    setSelectedLinkMenu(null);
  }, [selectEntity, toggleSelection, toggleImageNode]);

  const onNodeRightClick = useCallback((node: any, event: MouseEvent) => {
    event.preventDefault();
    const nodeId: string = (node as GNode).id;
    const fullId = nodeId.startsWith('entity:') ? nodeId : `entity:${nodeId}`;
    selectEntity(fullId);
    setSelectedLinkMenu(null);
    setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: fullId, nodeLabel: node.label ?? nodeId });
  }, [selectEntity]);

  // Bootstrap — re-runs when graphMountKey changes (i.e. after each full-load transition)
  useEffect(() => {
    logFrontend('info', `[graph/bootstrap] effect fired — graphMountKey=${graphMountKey} readyRef=${readyRef.current} hasContainer=${!!containerRef.current}`);
    if (!containerRef.current || readyRef.current) {
      logFrontend('warn', `[graph/bootstrap] skipped (containerRef=${!!containerRef.current} readyRef=${readyRef.current})`);
      return;
    }
    readyRef.current = true;
    logFrontend('info', '[graph/bootstrap] creating new ForceGraph2D instance');

    const g = (ForceGraph2D as any)()(containerRef.current)
      .graphData({ nodes: [], links: [] })
      .backgroundColor('rgba(0,0,0,0)')
      .linkColor((link: any) => {
        if (invisibleLabelsRef.current.has(link.label)) return 'rgba(0,0,0,0)';
        const rt0 = relTypeMapRef.current.get(link.label);
        // Non-straight edges are drawn entirely in linkCanvasObject — suppress default line
        if (rt0?.routing && rt0.routing !== 'straight') return 'rgba(0,0,0,0)';
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const edgeKey = `${sourceId}|${targetId}`;
        if (highlightedEdgeKeysRef.current.size > 0 && highlightedEdgeKeysRef.current.has(edgeKey)) {
          return getComputedStyle(document.documentElement).getPropertyValue('--graph-path').trim() || '#f5a623';
        }
        const sq = searchQueryRef.current.toLowerCase();
        const sm = !sq || (link.source?.label && link.source.label.toLowerCase().includes(sq));
        const tm = !sq || (link.target?.label && link.target.label.toLowerCase().includes(sq));
        if (sq && !sm && !tm) return 'rgba(100, 100, 100, 0.15)';
        const rt = relTypeMapRef.current.get(link.label);
        if (rt?.color) return rt.color;
        return getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#a0a0a0';
      })
      .linkWidth((link: any) => {
        if (invisibleLabelsRef.current.has(link.label)) return 0;
        const rt0 = relTypeMapRef.current.get(link.label);
        if (rt0?.routing && rt0.routing !== 'straight') return 0;
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const edgeKey = `${sourceId}|${targetId}`;
        return highlightedEdgeKeysRef.current.has(edgeKey) ? 4 : 2;
      })
      .linkDirectionalArrowLength(0)
      // Precise click hit-area. ForceGraph2D's default uses node.val (a
      // squared radius), which for an open preview produces a circle far
      // bigger than the displayed image — clicks on neighbouring nodes that
      // happen to fall inside that circle get hijacked. Painting a rect
      // matching __imgW × __imgH for previewed nodes (and a small disc for
      // everything else) keeps each node's hitbox exactly its visible area.
      .nodePointerAreaPaint((node: any, color: string, ctx: CanvasRenderingContext2D) => {
        if (node.x == null || node.y == null) return;
        ctx.fillStyle = color;
        if (node.__imgW && node.__imgH) {
          ctx.fillRect(node.x - node.__imgW / 2, node.y - node.__imgH / 2, node.__imgW, node.__imgH);
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI, false);
          ctx.fill();
        }
      })
      .onNodeClick(onNodeClick)
      .onNodeRightClick(onNodeRightClick)
      .onLinkClick((link: any, event: MouseEvent) => {
        if (!link.source || !link.target || typeof link.source !== 'object') return;
        const sel = {
          source: link.source.id,
          target: link.target.id,
          label: link.label,
        };
        selectedLinkRef.current = sel;
        setSelectedLinkMenu({ x: event.clientX, y: event.clientY, ...sel });
        setCtxMenu(null);
      })
      .onBackgroundClick(() => {
        selectedLinkRef.current = null;
        setSelectedLinkMenu(null);
        if (selectedIdsRef.current.length > 0) {
          setSelectedIds([]);
        }
      })
      .nodeCanvasObject((n: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        if (n.x == null || n.y == null || Number.isNaN(n.x) || Number.isNaN(n.y)) return;

        const sq = searchQueryRef.current.toLowerCase();
        const isMatch = sq ? n.label?.toLowerCase().includes(sq) : true;
        const isSelectionMaster = `entity:${n.id}` === selectedIdRef.current;
        const isSelected = selectedIdsRef.current.includes(`entity:${n.id}`);

        const isOnPath = highlightedPathRef.current.length > 0 && highlightedPathRef.current.includes(`entity:${n.id}`);

        ctx.globalAlpha = (!sq || isMatch) ? 1 : 0.2;
        const radius = 6;
        let isImageReady = false;
        // Clear footprint each frame; image / icon branches will set it again
        // if active. Without this, untoggling a preview leaves __imgW/__imgH
        // populated and the rect-collide keeps reserving a preview-sized
        // rectangle around a now-tiny node.
        n.__imgW = undefined;
        n.__imgH = undefined;
        n.val = 1;

        const bTraits = blobTraitsRef.current;
        const fullId = `entity:${n.id}`;
        const blobTrait = bTraits.find((b: any) => b.owner === fullId || b.owner === n.id);
        const sourcePath = blobTrait?.localUrl;
        const isImage = blobTrait && blobTrait.mime.startsWith('image/');
        const isPdf = blobTrait && blobTrait.mime === 'application/pdf';
        const isToggled = toggledImageNodesRef.current.has(fullId);

        if (isImage && sourcePath && isToggled) {
          if (!n.img) {
            n.img = new Image();
            n.img.src = convertFileSrc(sourcePath);
            n.img.onload = () => {
              if (readyRef.current && graphRef.current) {
                graphRef.current.nodeColor(graphRef.current.nodeColor());
              }
            };
          }
        } else if (isPdf && sourcePath && isToggled) {
          if (!n.img && !n.isPdfLoading) {
            n.isPdfLoading = true;
            pdfjsLib.getDocument(convertFileSrc(sourcePath)).promise.then(pdf => {
              return pdf.getPage(1);
            }).then(page => {
              const viewport = page.getViewport({ scale: 0.5 });
              const offCanvas = document.createElement('canvas');
              offCanvas.width = viewport.width;
              offCanvas.height = viewport.height;
              const offCtx = offCanvas.getContext('2d');
              if (!offCtx) return;
              offCtx.fillStyle = '#ffffff';
              offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
              return page.render({ canvasContext: offCtx, viewport: viewport } as any).promise.then(() => {
                n.img = offCanvas;
                if (readyRef.current && graphRef.current) {
                  graphRef.current.nodeColor(graphRef.current.nodeColor());
                }
              });
            }).catch(err => {
              console.error("PDF thumbnail err", err);
            });
          }
        }

        if ((isImage || isPdf) && isToggled) {
          const imgWidth = n.img?.width || n.img?.naturalWidth;
          const imgHeight = n.img?.height || n.img?.naturalHeight;

          if (n.img && imgWidth > 0) {
            isImageReady = true;
            const maxDim = isPdf ? 100 : 80;
            const aspect = imgWidth / imgHeight;
            let w = maxDim;
            let h = maxDim;
            if (aspect > 1) h = maxDim / aspect;
            else w = maxDim * aspect;
            n.__imgW = w;
            n.__imgH = h;
            // Scale nodeVal so click surface + repulsion matches the image footprint
            n.val = Math.max(1, ((Math.max(w, h) / 2) / 4) ** 2);

            ctx.save();
            // Image LOD: at low zoom, drawing a full-resolution bitmap is wasted
            // pixels. Draw a placeholder kind-color rect of the same footprint
            // so layout/click surface is unchanged but the GPU/CPU cost is small.
            if (globalScale < GRAPH_PERF.imageLodZoomThreshold) {
              ctx.fillStyle = KIND_COLORS[n.category] ?? '#8b91a8';
              ctx.fillRect(n.x - w / 2, n.y - h / 2, w, h);
            } else {
              ctx.drawImage(n.img, n.x - w / 2, n.y - h / 2, w, h);
            }
            ctx.restore();

            ctx.beginPath();
            ctx.rect(n.x - w / 2, n.y - h / 2, w, h);
            ctx.lineWidth = 1.5 / globalScale;
            ctx.strokeStyle = KIND_COLORS[n.category] ?? '#8b91a8';
            ctx.stroke();
          }
        }

        // Icon override: render entity icon from ui.icon (always shown, not toggled)
        const iconPath = n.metadata?.['ui.icon'] as string | undefined;
        if (iconPath && !isImageReady) {
          if (!n._iconImg) {
            const img = new Image();
            img.src = convertFileSrc(iconPath);
            img.onload = () => {
              if (readyRef.current && graphRef.current) {
                graphRef.current.nodeColor(graphRef.current.nodeColor());
              }
            };
            n._iconImg = img;
          }
          if (n._iconImg.complete && (n._iconImg as HTMLImageElement).naturalWidth > 0) {
            const iconR = 16;
            n.__imgW = iconR * 2;
            n.__imgH = iconR * 2;
            n.val = ((iconR / 4) ** 2);
            isImageReady = true;
            ctx.save();
            ctx.beginPath();
            ctx.arc(n.x, n.y, iconR, 0, 2 * Math.PI);
            ctx.clip();
            ctx.drawImage(n._iconImg, n.x - iconR, n.y - iconR, iconR * 2, iconR * 2);
            ctx.restore();
          }
        }

        if (!isImageReady) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = KIND_COLORS[n.category] ?? '#8b91a8';
          ctx.fill();

          // Path glow ring
          if (isOnPath) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius + 4, 0, 2 * Math.PI, false);
            ctx.lineWidth = 2 / globalScale;
            ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--graph-path').trim() || '#f5a623';
            ctx.globalAlpha = 0.85;
            ctx.stroke();
            ctx.globalAlpha = (!sq || isMatch) ? 1 : 0.2;
          }
        }

        if (isSelected) {
          ctx.beginPath();
          if (isImageReady && n.__imgW) {
            ctx.rect(n.x - n.__imgW / 2 - 2, n.y - n.__imgH / 2 - 2, n.__imgW + 4, n.__imgH + 4);
          } else {
            ctx.arc(n.x, n.y, radius + 2, 0, 2 * Math.PI, false);
          }
          ctx.lineWidth = 2.5 / globalScale;
          const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b8af0';
          const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e4e6f0';
          ctx.strokeStyle = isSelectionMaster ? accentColor : primaryColor;
          ctx.stroke();
        }

        // Keyboard focus cursor: same weight as selection ring, warm accent color
        if (`entity:${n.id}` === focusedNodeIdRef.current) {
          ctx.beginPath();
          if (isImageReady && n.__imgW) {
            ctx.rect(n.x - n.__imgW / 2 - 5, n.y - n.__imgH / 2 - 5, n.__imgW + 10, n.__imgH + 10);
          } else {
            ctx.arc(n.x, n.y, radius + 5, 0, 2 * Math.PI, false);
          }
          ctx.lineWidth = 2.5 / globalScale;
          ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--graph-path').trim() || '#f5a623';
          ctx.globalAlpha = 0.9;
          ctx.stroke();
          ctx.globalAlpha = (!sq || isMatch) ? 1 : 0.2;
        }

        if (
          globalScale > 0.8
          && showNodeLabelsRef.current
          && !hiddenLabelCategoriesRef.current.has(n.category)
        ) {
          const fontSize = 4;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = themeColorsRef.current.textPrimary;
          ctx.font = `${fontSize}px "JetBrains Mono", sans-serif`;
          ctx.fillText(n.label, n.x, n.y + (isImageReady ? (n.__imgH! / 2 + 5) : radius + 3.5));
        }
        ctx.globalAlpha = 1;
      })
      .linkCanvasObjectMode(() => 'after')
      .linkCanvasObject((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        // Suppress invisible-type edges entirely
        if (invisibleLabelsRef.current.has(link.label)) return;

        const sq = searchQueryRef.current.toLowerCase();
        const sm = !sq || (link.source?.label && link.source.label.toLowerCase().includes(sq));
        const tm = !sq || (link.target?.label && link.target.label.toLowerCase().includes(sq));
        if (sq && !sm && !tm) return;

        if (!link.source || !link.target || typeof link.source !== 'object' || typeof link.target !== 'object') return;
        if (link.source.x == null || link.source.y == null || Number.isNaN(link.source.x) || Number.isNaN(link.source.y)) return;
        if (link.target.x == null || link.target.y == null || Number.isNaN(link.target.x) || Number.isNaN(link.target.y)) return;
        if (link.source.id === link.target.id) return;

        // Off-screen culling: skip edges where both endpoints are outside the
        // visible viewport (with a small margin so partially visible curves
        // still render their visible portion via the routing branch).
        {
          const canvas = ctx.canvas;
          const t = (canvas as any).__zoom ?? { x: 0, y: 0, k: globalScale };
          const k = t.k || globalScale || 1;
          const vx0 = (-t.x) / k;
          const vy0 = (-t.y) / k;
          const vw = canvas.width  / k;
          const vh = canvas.height / k;
          const margin = 80;
          const sX = link.source.x, sY = link.source.y;
          const tX = link.target.x, tY = link.target.y;
          const sOut = sX < vx0 - margin || sX > vx0 + vw + margin || sY < vy0 - margin || sY > vy0 + vh + margin;
          const tOut = tX < vx0 - margin || tX > vx0 + vw + margin || tY < vy0 - margin || tY > vy0 + vh + margin;
          if (sOut && tOut) return;
        }

        const sourceId = link.source.id;
        const targetId = link.target.id;
        const edgeKey = `${sourceId}|${targetId}`;
        const isPath = highlightedEdgeKeysRef.current.size > 0 && highlightedEdgeKeysRef.current.has(edgeKey);
        const selLink = selectedLinkRef.current;
        const isSelectedLink = selLink &&
          selLink.source === sourceId && selLink.target === targetId && selLink.label === link.label;
        const rt = relTypeMapRef.current.get(link.label);
        const routing: string = rt?.routing ?? 'straight';
        const pathAlpha = (sq && !sm && !tm) ? 0.15 : 1;

        const baseColor = themeColorsRef.current.textSecondary;
        const edgeColor = isSelectedLink
          ? themeColorsRef.current.accent
          : isPath
            ? themeColorsRef.current.graphPath
            : (rt?.color ?? baseColor);

        const sx = link.source.x, sy = link.source.y;
        const tx2 = link.target.x, ty2 = link.target.y;
        const dx = tx2 - sx, dy = ty2 - sy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.1) return;

        const ux = dx / len, uy = dy / len;
        const nodeR = 7;

        // ── Edge path ───────────────────────────────────────────
        ctx.save();
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = isSelectedLink ? 2.0 : isPath ? 1.5 : 1.0;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = pathAlpha;

        if (routing === 'step') {
          // Orthogonal L-path.
          // To make the LAST segment align with the flow direction:
          //   right/left flow → go vertical first, then horizontal (last seg = H)
          //   down/up flow   → go horizontal first, then vertical (last seg = V)
          //   no flow        → horizontal first, then vertical (default)
          const stepFlow: string = rt?.flow ?? 'none';
          const vFirst = stepFlow === 'right' || stepFlow === 'left';
          const midX = vFirst ? sx : tx2;
          const midY = vFirst ? ty2 : sy;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(midX, midY);
          ctx.lineTo(tx2, ty2);
          ctx.stroke();
        } else if (routing === 'arc') {
          // Quadratic bezier with control point offset perpendicular to midpoint
          const mx = (sx + tx2) / 2;
          const my = (sy + ty2) / 2;
          const curvature = 0.25;
          const cpx = mx - uy * len * curvature;
          const cpy = my + ux * len * curvature;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(cpx, cpy, tx2, ty2);
          ctx.stroke();
        }
        // 'straight' edges are drawn by ForceGraph2D's default renderer (linkColor/linkWidth)

        ctx.restore();

        // ── Solid concave arrowhead ──────────────────────────────
        // The arrowhead direction must match the ACTUAL direction the path segment
        // arrives at the target node — otherwise the head detaches from the line.
        let arrowUx: number, arrowUy: number;
        if (routing === 'step') {
          // Last segment direction follows the segment order computed above:
          //   vFirst (right/left flow): last segment is horizontal
          //   else:                     last segment is vertical
          const stepFlow2: string = rt?.flow ?? 'none';
          const vFirst2 = stepFlow2 === 'right' || stepFlow2 === 'left';
          if (vFirst2) {
            arrowUx = dx >= 0 ? 1 : -1; arrowUy = 0;
          } else {
            arrowUx = 0; arrowUy = dy >= 0 ? 1 : -1;
          }
        } else if (routing === 'arc') {
          // Bezier tangent at t=1: direction from control point to target.
          // Use the actual tangent (no cardinal snap) so the arrowhead stays
          // perfectly flush with the curve's final approach direction.
          const mx2 = (sx + tx2) / 2, my2 = (sy + ty2) / 2;
          const cpx2 = mx2 - uy * len * 0.25, cpy2 = my2 + ux * len * 0.25;
          const tdx2 = tx2 - cpx2, tdy2 = ty2 - cpy2;
          const tlen2 = Math.sqrt(tdx2 * tdx2 + tdy2 * tdy2) || 1;
          arrowUx = tdx2 / tlen2; arrowUy = tdy2 / tlen2;
        } else {
          // Straight: ForceGraph2D draws the line in (ux,uy); arrowhead must match exactly
          arrowUx = ux; arrowUy = uy;
        }
        const tipX = tx2 - arrowUx * nodeR;
        const tipY = ty2 - arrowUy * nodeR;

        const px = -arrowUy, py = arrowUx;
        const headH = 5, headW = 1.6;
        const lx = tipX - arrowUx * headH + px * headW;
        const ly = tipY - arrowUy * headH + py * headW;
        const rx2 = tipX - arrowUx * headH - px * headW;
        const ry2 = tipY - arrowUy * headH - py * headW;
        const ix = tipX - arrowUx * (headH * 0.9);
        const iy = tipY - arrowUy * (headH * 0.9);

        const radius = 0.3;
        ctx.beginPath();
        ctx.arcTo(tipX, tipY, lx, ly, radius);
        ctx.arcTo(lx, ly, ix, iy, radius);
        ctx.arcTo(ix, iy, rx2, ry2, radius);
        ctx.arcTo(rx2, ry2, tipX, tipY, radius);
        ctx.closePath();
        ctx.fillStyle = edgeColor;
        ctx.globalAlpha = pathAlpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        // ── Edge label ──────────────────────────────────────────
        if (!showEdgeLabelsRef.current || hiddenRelationshipLabelsRef.current.has(link.label)) return;
        const label = link.label;
        if (!label) return;

        const fontSize = 3;
        ctx.font = `${fontSize}px "JetBrains Mono", sans-serif`;
        const textWidth = ctx.measureText(label).width;
        const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);

        // Place label at midpoint of the drawn path
        let lbx: number, lby: number;
        if (routing === 'arc') {
          const mx = (sx + tx2) / 2;
          const my = (sy + ty2) / 2;
          const curvature = 0.25;
          const cpx = mx - uy * len * curvature;
          const cpy = my + ux * len * curvature;
          lbx = (sx + 2 * cpx + tx2) / 4; // midpoint on bezier (t=0.5)
          lby = (sy + 2 * cpy + ty2) / 4;
        } else if (routing === 'step') {
          const flow4: string = rt?.flow ?? 'none';
          const midX = (flow4 === 'down' || flow4 === 'up') ? sx : tx2;
          const midY = (flow4 === 'down' || flow4 === 'up') ? ty2 : sy;
          lbx = (sx + midX + tx2) / 3;
          lby = (sy + midY + ty2) / 3;
        } else {
          lbx = (sx + tx2) / 2;
          lby = (sy + ty2) / 2;
        }

        ctx.fillStyle = themeColorsRef.current.bgPanel;
        ctx.fillRect(lbx - bckgDimensions[0] / 2, lby - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = rt?.color ?? themeColorsRef.current.textSecondary;
        ctx.fillText(label, lbx, lby);
      })
      .onRenderFramePre((ctx: CanvasRenderingContext2D, _globalScale: number) => {
        // 1. Draw background: grid lines or dot matrix
        if (showGridRef.current) {
          const canvas = ctx.canvas;
          const width = canvas.width;
          const height = canvas.height;
          const t = (canvas as any).__zoom ?? { x: 0, y: 0, k: 1 };
          const tx = t.x;
          const ty = t.y;
          const k = t.k;

          // Adaptive grid: keep screen-space cell size in ~[30, 150] px
          // by stepping the world-space interval up/down in multiples of 5.
          let worldStep = 50;
          let spacing = worldStep * k;
          while (spacing < 30)  { worldStep *= 5; spacing = worldStep * k; }
          while (spacing > 150) { worldStep /= 5; spacing = worldStep * k; }
          const majorSpacing = spacing * 5;

          ctx.save();
          ctx.resetTransform();
          const borderCol = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#444';

          if (backgroundStyleRef.current === 'dots') {
            // Dot matrix — size scales slightly with zoom for tactile feel
            const dotR = Math.min(1.8, Math.max(0.8, k * 0.9));
            ctx.fillStyle = borderCol;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            for (let x = ((tx % spacing) + spacing) % spacing; x < width; x += spacing) {
              for (let y = ((ty % spacing) + spacing) % spacing; y < height; y += spacing) {
                ctx.moveTo(x + dotR, y);
                ctx.arc(x, y, dotR, 0, 2 * Math.PI);
              }
            }
            ctx.fill();
          } else {
            // Major grid lines
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
          }
          ctx.restore();
        }

        // 2. Draw Tag Regions — collect hulls first, then render + resolve label collisions
        if (showRegionsRef.current && graphRef.current) {
          const { nodes: liveNodes, links: liveLinks } = graphRef.current.graphData();
          const groups: Record<string, { label: string, points: { x: number, y: number }[] }> = {};

          liveLinks.forEach((link: any) => {
            if (link.label === 'tagged_as') {
              const fromId = typeof link.source === 'object' ? link.source.id : link.source;
              const toId = typeof link.target === 'object' ? link.target.id : link.target;

              const fromNode = liveNodes.find((n: any) => n.id === fromId);
              const toNode = liveNodes.find((n: any) => n.id === toId);

              if (fromNode) {
                if (!groups[toId]) {
                  groups[toId] = { label: toNode?.label || toId, points: [] };
                  if (toNode) groups[toId].points.push({ x: toNode.x, y: toNode.y });
                }
                groups[toId].points.push({ x: fromNode.x, y: fromNode.y });
              }
            }
          });

          // Pass 1: build hull + label anchor data for all groups
          type RegionData = {
            hull: { x: number; y: number }[];
            color: string;
            labelText: string;
            labelX: number;
            labelY: number;
            labelW: number;
          };
          const regions: RegionData[] = [];

          Object.entries(groups).forEach(([tagId, group]) => {
            if (group.points.length < 1) return;

            const pointsWithGap: { x: number; y: number }[] = [];
            group.points.forEach(p => {
              for (let a = 0; a < 2 * Math.PI; a += Math.PI / 4) {
                pointsWithGap.push({
                  x: p.x + Math.cos(a) * REGION_STYLE.dilationRadius,
                  y: p.y + Math.sin(a) * REGION_STYLE.dilationRadius
                });
              }
            });

            const hull = getConvexHull(pointsWithGap);
            if (hull.length < 3) return;

            const color = getStableColor(tagId);
            const text = group.label.toUpperCase();
            ctx.font = REGION_STYLE.labelFont;
            const labelW = ctx.measureText(text).width;
            const minYHull = Math.min(...hull.map(p => p.y));
            const avgX = hull.reduce((a, b) => a + b.x, 0) / hull.length;

            regions.push({
              hull,
              color,
              labelText: text,
              labelX: avgX,
              labelY: minYHull - REGION_STYLE.labelVOffset,
              labelW,
            });
          });

          // Pass 2: render hull fills + borders
          const isFill = regionStyleRef.current === 'fill';
          regions.forEach(({ hull, color }) => {
            ctx.save();
            ctx.beginPath();
            drawRoundedHullPath(ctx, hull, REGION_STYLE.roundness);

            if (isFill) {
              // Soft-fill: solid transparent background + 2px border
              ctx.globalAlpha = 0.15;
              ctx.fillStyle = color;
              ctx.fill();
              ctx.beginPath();
              drawRoundedHullPath(ctx, hull, REGION_STYLE.roundness);
              ctx.globalAlpha = REGION_STYLE.borderAlpha;
              ctx.strokeStyle = color;
              ctx.lineWidth = REGION_STYLE.borderWidth;
              ctx.lineJoin = 'round';
              ctx.lineCap = 'round';
              ctx.stroke();
            } else {
              // Hatch style
              ctx.globalAlpha = 0.05;
              ctx.fillStyle = color;
              ctx.fill();

              ctx.save();
              ctx.clip();
              ctx.beginPath();
              ctx.strokeStyle = color;
              ctx.lineWidth = REGION_STYLE.hatchLineWidth;
              ctx.globalAlpha = REGION_STYLE.hatchAlpha;
              const kValues = hull.map(p => p.x - p.y);
              const kMin = Math.min(...kValues);
              const kMax = Math.max(...kValues);
              const sp = REGION_STYLE.hatchSpacing;
              for (let kk = kMin - sp; kk < kMax + sp; kk += sp) {
                const minY = Math.min(...hull.map(p => p.y)) - sp;
                const maxY = Math.max(...hull.map(p => p.y)) + sp;
                ctx.moveTo(kk + minY, minY);
                ctx.lineTo(kk + maxY, maxY);
              }
              ctx.stroke();
              ctx.restore();

              ctx.beginPath();
              drawRoundedHullPath(ctx, hull, REGION_STYLE.roundness);
              ctx.globalAlpha = REGION_STYLE.borderAlpha;
              ctx.strokeStyle = color;
              ctx.lineWidth = REGION_STYLE.borderWidth;
              ctx.lineJoin = 'round';
              ctx.lineCap = 'round';
              ctx.stroke();
            }
            ctx.restore();
          });

          // Pass 3: render labels with greedy 1-D collision avoidance
          if (_globalScale > 0.4) {
            // Sort by labelY (top to bottom) so higher labels get priority
            const sorted = [...regions].sort((a, b) => a.labelY - b.labelY);
            const placed: { x: number; y: number; w: number }[] = [];
            const labelH = 8; // approximate pixel height of a label

            sorted.forEach(({ color, labelText, labelX, labelY, labelW }) => {
              let y = labelY;
              // Greedy push-down until no overlap with already-placed labels
              for (let iter = 0; iter < 20; iter++) {
                const overlapping = placed.find(p => {
                  const dx = Math.abs(p.x - labelX);
                  const dy = Math.abs(p.y - y);
                  return dx < (p.w + labelW) / 2 + 4 && dy < labelH;
                });
                if (!overlapping) break;
                y = overlapping.y - labelH - 2;
              }
              placed.push({ x: labelX, y, w: labelW });

              ctx.save();
              ctx.font = REGION_STYLE.labelFont;
              ctx.fillStyle = color;
              ctx.textAlign = 'center';
              ctx.globalAlpha = REGION_STYLE.labelAlpha;
              ctx.fillText(labelText, labelX, y);
              ctx.restore();
            });
          }
        }

        // 3. (Marquee rect is now a React div overlay — no canvas drawing needed)
      })
      .onRenderFramePost((ctx: CanvasRenderingContext2D) => {
        // Hold the rect-collide invariant continuously: even when the d3
        // simulation has cooled (alpha=0, no ticks), every render frame
        // re-resolves overlapping AABBs so a preview rect can never be
        // invaded by a stray node.
        resolveRectCollisionsRef.current?.();

        // Phase 58 — overlay edges from inference dialog. Drawn after the
        // standard graph render so they sit on top of ground edges and
        // stand out via dashed strokes in the accent colour.
        const overlay = overlayEdgesRef.current;
        if (!overlay || overlay.length === 0) return;
        const { nodes } = graphRef.current?.graphData() ?? { nodes: [] };
        const nodeMap = new Map<string, any>();
        for (const n of nodes) nodeMap.set(n.id, n);
        const accent = getComputedStyle(document.documentElement)
          .getPropertyValue('--accent').trim() || '#7aa2f7';
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.85;
        for (const ov of overlay) {
          const fromKey = ov.from.replace('entity:', '');
          const toKey = ov.to.replace('entity:', '');
          const fn = nodeMap.get(fromKey);
          const tn = nodeMap.get(toKey);
          if (!fn || !tn) continue;
          if (fn.x == null || fn.y == null || tn.x == null || tn.y == null) continue;
          ctx.beginPath();
          ctx.moveTo(fn.x, fn.y);
          ctx.lineTo(tn.x, tn.y);
          ctx.stroke();
        }
        ctx.restore();
      })
      .cooldownTicks(GRAPH_PRESETS[(graphLayoutMode as GraphLayoutMode) ?? 'default'].cooldownTicks)
      .d3AlphaDecay(GRAPH_PRESETS[(graphLayoutMode as GraphLayoutMode) ?? 'default'].alphaDecay)
      .d3VelocityDecay(GRAPH_PRESETS[(graphLayoutMode as GraphLayoutMode) ?? 'default'].velocityDecay);

    {
      const p = GRAPH_PRESETS[(graphLayoutMode as GraphLayoutMode) ?? 'default'];
      g.d3Force('charge').strength(p.chargeStrength).distanceMin(p.chargeDistanceMin).distanceMax(p.chargeDistanceMax);
      g.d3Force('link').distance(p.linkDistance);
      // Mild positional gravity toward (0, 0). With hard collide preventing
      // overlap, this pulls disconnected sub-components close together
      // without merging them — they pack against the central region until
      // their bounding rectangles touch. Applied as a custom velocity-bias
      // force (alpha-scaled, decays naturally).
      gravityStrengthRef.current = p.gravityStrength;
      g.d3Force('gravity', (alpha: number) => {
        const { nodes } = g.graphData();
        const k = gravityStrengthRef.current * alpha;
        if (k <= 0) return;
        for (const n of nodes as any[]) {
          if (n.x == null || n.y == null) continue;
          if (n.fx != null || n.fy != null) continue;
          n.vx -= n.x * k;
          n.vy -= n.y * k;
        }
      });
    }

    // Flow force: soft directional bias for relationship types with a flow direction.
    // d3-force passes `alpha` (1→0) to the function each tick — velocity changes must
    // be proportional to alpha so they naturally decay to zero as the sim cools.
    g.d3Force('flow', (alpha: number) => {
      const { links } = g.graphData();
      const bias = (GRAPH_PRESETS[(graphLayoutMode as GraphLayoutMode) ?? 'default'].flowBias) * alpha;
      for (const link of links) {
        const rt = relTypeMapRef.current.get((link as any).label);
        if (!rt?.flow || rt.flow === 'none') continue;
        const src = (link as any).source;
        const tgt = (link as any).target;
        if (!src || !tgt || src.x == null || tgt.x == null) continue;
        switch (rt.flow) {
          case 'down':  tgt.vy += bias; src.vy -= bias; break;
          case 'up':    tgt.vy -= bias; src.vy += bias; break;
          case 'right': tgt.vx += bias; src.vx -= bias; break;
          case 'left':  tgt.vx -= bias; src.vx += bias; break;
        }
      }
    });

    // Hard collision for every pair of nodes. Position correction, ignores
    // alpha, runs both in-tick and on every render frame so the no-overlap
    // invariant is held continuously — even after the simulation cools, even
    // for pinned/dragged nodes. Two shapes:
    //   • Pair of normal nodes: circular collide at NORMAL_NODE_RADIUS so
    //     separation aligns with the line between centres (cooperates with
    //     the link force instead of fighting it on a single axis).
    //   • Either side has an open preview: AABB rect exclusion using the
    //     image footprint so the preview rectangle stays fully clear.
    const COLLIDE_PADDING = 2;
    const NORMAL_NODE_RADIUS = 8;
    const resolveAllCollisions = () => {
      const { nodes } = g.graphData();
      for (let i = 0; i < nodes.length; i++) {
        const a: any = nodes[i];
        if (a.x == null || a.y == null) continue;
        const aPreview = !!(a.__imgW && a.__imgH);
        const aFixed = a.fx != null || a.fy != null;
        for (let j = i + 1; j < nodes.length; j++) {
          const b: any = nodes[j];
          if (b.x == null || b.y == null) continue;
          const bPreview = !!(b.__imgW && b.__imgH);
          const bFixed = b.fx != null || b.fy != null;
          const aShare = bFixed && !aFixed ? 1 : aFixed && !bFixed ? 0 : 0.5;
          const bShare = 1 - aShare;
          if (aPreview || bPreview) {
            // Rect AABB resolution
            const ahw = (a.__imgW ? a.__imgW / 2 : NORMAL_NODE_RADIUS) + COLLIDE_PADDING / 2;
            const ahh = (a.__imgH ? a.__imgH / 2 : NORMAL_NODE_RADIUS) + COLLIDE_PADDING / 2;
            const bhw = (b.__imgW ? b.__imgW / 2 : NORMAL_NODE_RADIUS) + COLLIDE_PADDING / 2;
            const bhh = (b.__imgH ? b.__imgH / 2 : NORMAL_NODE_RADIUS) + COLLIDE_PADDING / 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            const overlapX = (ahw + bhw) - Math.abs(dx);
            if (overlapX <= 0) continue;
            const overlapY = (ahh + bhh) - Math.abs(dy);
            if (overlapY <= 0) continue;
            if (overlapX < overlapY) {
              const dir = dx >= 0 ? 1 : -1;
              a.x -= dir * overlapX * aShare;
              b.x += dir * overlapX * bShare;
            } else {
              const dir = dy >= 0 ? 1 : -1;
              a.y -= dir * overlapY * aShare;
              b.y += dir * overlapY * bShare;
            }
          } else {
            // Circular collide along center line, plays nice with link force
            const dx = b.x - a.x, dy = b.y - a.y;
            const minDist = NORMAL_NODE_RADIUS * 2 + COLLIDE_PADDING;
            const dist2 = dx * dx + dy * dy;
            if (dist2 >= minDist * minDist || dist2 === 0) continue;
            const dist = Math.sqrt(dist2);
            const overlap = minDist - dist;
            const ux = dx / dist, uy = dy / dist;
            a.x -= ux * overlap * aShare;
            a.y -= uy * overlap * aShare;
            b.x += ux * overlap * bShare;
            b.y += uy * overlap * bShare;
          }
        }
      }
    };

    g.d3Force('nodeCollide', () => resolveAllCollisions());
    // Render-post hook re-runs the resolver each frame so the invariant
    // holds even after the d3 simulation has cooled.
    resolveRectCollisionsRef.current = resolveAllCollisions;

    g.onNodeDragEnd((node: any) => {
      if (node.id) updateNodePosition(node.id, node.x, node.y);
    });

    graphRef.current = g;

    // ForceGraph2D reads offsetWidth at init time, which may be 0 if the flex
    // container hasn't painted yet. Force the correct size immediately.
    if (containerRef.current) {
      g.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
    }

    // Register zoom-reset function so GraphSidePanel can call it
    setGraphResetViewFn(() => {
      if (graphRef.current) {
        graphRef.current.zoom(1, 400);
        setTimeout(() => graphRef.current?.zoomToFit(400, 30), 450);
      }
    });
    logFrontend('info', `[graph/bootstrap] instance ready — graphMountKey=${graphMountKey}`);

    return () => {
      logFrontend('info', `[graph/bootstrap] cleanup — destroying instance graphMountKey=${graphMountKey}`);
      setGraphResetViewFn(null);
      readyRef.current = false;
      const old = graphRef.current;
      graphRef.current = null;
      // _destructor() removes the canvas from the container div. This is safe here
      // because the container div has no React children — all overlays live in a
      // sibling wrapper. React never calls removeChild on anything inside the container,
      // so there is no WKWebView NotFoundError risk.
      try { (old as any)?._destructor?.(); } catch {}
    };
  }, [graphMountKey]);

  // Marquee: intercept at window capture phase to beat d3-zoom
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!KEYBINDS.marqueeModifier(e)) return;
      if (!containerRef.current || !graphRef.current) return;

      // Only trigger if the event is inside our graph container
      if (!containerRef.current.contains(e.target as Node)) return;

      // Beat d3-zoom by stopping all propagation at earliest possible stage
      e.stopImmediatePropagation();
      e.preventDefault();

      const containerRect = containerRef.current!.getBoundingClientRect();
      const relX = e.clientX - containerRect.left;
      const relY = e.clientY - containerRect.top;

      isDraggingSelection.current = true;
      const { x, y } = graphRef.current.screen2GraphCoords(relX, relY);
      const box = { start: { x, y }, end: { x, y } };
      selectionBoxRef.current = box;
      selectionStartScreenRef.current = { x: relX, y: relY };

      // Store screen coords for the overlay div
      setSelectionBoxScreen({ left: relX, top: relY, width: 0, height: 0 });
    };

    // capture: true fires before any bubble-phase listener, including d3-zoom inside the canvas
    window.addEventListener('mousedown', handleMouseDown, { capture: true });
    return () => window.removeEventListener('mousedown', handleMouseDown, { capture: true });
  }, []);

  // Marquee mouse listeners (using refs to avoid stale closures)
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!isDraggingSelection.current || !graphRef.current || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const relX = e.clientX - containerRect.left;
      const relY = e.clientY - containerRect.top;

      const { x, y } = graphRef.current.screen2GraphCoords(relX, relY);
      if (selectionBoxRef.current) {
        selectionBoxRef.current = { ...selectionBoxRef.current, end: { x, y } };
      }

      // Update the screen-space overlay div
      const start = selectionStartScreenRef.current;
      if (start) {
        setSelectionBoxScreen({
          left: Math.min(start.x, relX),
          top: Math.min(start.y, relY),
          width: Math.abs(start.x - relX),
          height: Math.abs(start.y - relY),
        });
      }
    };

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (!isDraggingSelection.current || !graphRef.current || !containerRef.current) {
        isDraggingSelection.current = false;
        return;
      }

      // Use screen pixels for threshold (5px min width/height)
      const containerRect = containerRef.current.getBoundingClientRect();
      const screenStart = selectionStartScreenRef.current;
      const x2s = e.clientX - containerRect.left;
      const y2s = e.clientY - containerRect.top;
      const screenWidth = screenStart ? Math.abs(screenStart.x - x2s) : 0;
      const screenHeight = screenStart ? Math.abs(screenStart.y - y2s) : 0;

      isDraggingSelection.current = false;
      const box = selectionBoxRef.current;
      selectionBoxRef.current = null;
      selectionStartScreenRef.current = null;
      setSelectionBoxScreen(null);

      if (!box || (screenWidth < 5 && screenHeight < 5)) return;

      const { start, end } = box;
      const xMin = Math.min(start.x, end.x);
      const xMax = Math.max(start.x, end.x);
      const yMin = Math.min(start.y, end.y);
      const yMax = Math.max(start.y, end.y);

      // Find nodes in box
      const { nodes } = graphRef.current.graphData();
      const inBox = nodes.filter((n: any) =>
        n.x >= xMin && n.x <= xMax && n.y >= yMin && n.y <= yMax
      ).map((n: any) => `entity:${n.id}`);

      if (inBox.length > 0) {
        // Hold shift to add to existing selection; otherwise replace
        if (e.shiftKey) {
          const cur = selectedIdsRef.current;
          const next = Array.from(new Set([...cur, ...inBox]));
          setSelectedIds(next);
        } else {
          setSelectedIds(inBox);
        }
      } else if (!e.shiftKey) {
        // Empty box results in empty selection
        setSelectedIds([]);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [setSelectedIds]);

  // Synchronous filtering for UI stats and data preparation.
  // NOTE: invisible-type edges (e.g. tagged_as) are kept in filteredData so they
  // participate in the d3 force simulation (attracting tagged nodes) and in the
  // region-hull detection pass. They are suppressed only in the visual-render layer
  // (linkColor / linkWidth / linkCanvasObject checks against invisibleLabelsRef).
  const filteredData = useMemo(() => {
    const isFiltered = filterKinds.length > 0;
    const kindNodes = isFiltered
      ? entities.filter((e: any) => filterKinds.includes(e.category))
      : entities;

    const nodeIds = new Set(kindNodes.map((e: any) => e.id.replace('entity:', '')));
    const kindEdges = edges.filter((e: any) => {
      const sourceId = e.from.replace('entity:', '');
      const targetId = e.to.replace('entity:', '');
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return false;
      if (filterEdgeLabels.length > 0 && filterEdgeLabels.includes(e.label)) return false;
      // Phase 58 derived-edge filter: hide edges flagged metadata.derived === true
      if (!showDerivedEdges && e.metadata && (e.metadata as any).derived === true) return false;
      return true;
    });

    return { nodes: kindNodes, edges: kindEdges };
  }, [entities, edges, filterKinds, filterEdgeLabels, showDerivedEdges]);

  useEffect(() => {
    logFrontend('debug', `[graph/panel] graphLoading changed → ${graphLoading} (prev=${prevLoadingRef.current})`);
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = graphLoading;
    if (wasLoading && !graphLoading) {
      logFrontend('info', `[graph/panel] transition true→false detected; bumping graphMountKey (current=${graphMountKey}), setting skipNextFeed`);
      skipNextFeedRef.current = true;
      setGraphMountKey(k => k + 1);
    }
  }, [graphLoading]);

  // Sync data to force-graph instance
  useEffect(() => {
    logFrontend('debug', `[graph/sync] effect fired — graphLoading=${graphLoading} graphMountKey=${graphMountKey} skipNext=${skipNextFeedRef.current} hasGraph=${!!graphRef.current} nodes=${filteredData.nodes.length} edges=${filteredData.edges.length}`);
    if (graphLoading) return;
    if (skipNextFeedRef.current) {
      logFrontend('info', '[graph/sync] skipping feed on old instance (skipNextFeed was set)');
      skipNextFeedRef.current = false;
      return;
    }
    const g = graphRef.current;
    if (!g) {
      logFrontend('warn', '[graph/sync] graphRef.current is null — cannot feed data');
      return;
    }
    logFrontend('info', `[graph/sync] feeding graphMountKey=${graphMountKey} — nodes=${filteredData.nodes.length} edges=${filteredData.edges.length}`);

    const { nodes: liveNodes, links: liveLinks } = g.graphData();
    const liveById = new Map<string, any>(liveNodes.map((n: any) => [n.id, n]));
    const liveLinksMap = new Map<string, any>(liveLinks.map((l: any) => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return [`${sourceId}-${targetId}`, l];
    }));

    const nextNodes: any[] = [];
    for (const entity of filteredData.nodes) {
      const strippedId = entity.id.replace('entity:', '');
      const live = liveById.get(strippedId);
      const saved = nodePositions[strippedId];

      const displayLabel = resolvedLabel(entity, allLabelTraits, activeLocale);
      const values = entityValues(entity.id, keyValueTraits);
      if (live) {
        live.label = displayLabel;
        live.category = entity.category;
        live.metadata = values;
        nextNodes.push(live);
      } else {
        nextNodes.push({
          id: strippedId,
          label: displayLabel,
          category: entity.category,
          metadata: values,
          x: saved?.x,
          y: saved?.y
        });
      }
    }

    const nextNodesMap = new Map<string, any>(nextNodes.map(n => [n.id, n]));
    const nextLinks: any[] = [];
    for (const e of filteredData.edges) {
      const sourceNodeId = e.from.replace('entity:', '');
      const targetNodeId = e.to.replace('entity:', '');

      // Strict Inner Subgraph: only add edges if BOTH source and target nodes are in the current node list
      if (!nextNodesMap.has(sourceNodeId) || !nextNodesMap.has(targetNodeId)) continue;
      if (sourceNodeId === targetNodeId) continue;

      const key = `${sourceNodeId}-${targetNodeId}`;
      if (liveLinksMap.has(key)) {
        const liveLink = liveLinksMap.get(key)!;
        liveLink.label = e.label;
        nextLinks.push(liveLink);
      } else {
        nextLinks.push({ source: sourceNodeId, target: targetNodeId, label: e.label });
      }
    }

    try {
      g.graphData({ nodes: nextNodes, links: nextLinks });
      logFrontend('info', `[graph/sync] graphData() call succeeded — fed ${nextNodes.length} nodes, ${nextLinks.length} links`);
    } catch (err: any) {
      logFrontend('error', `[graph/sync] graphData() threw: ${String(err)} | stack: ${err?.stack ?? 'n/a'}`);
      throw err; // re-throw so ErrorBoundary catches it
    }
  }, [filteredData, nodePositions, showRegions, allLabelTraits, activeLocale, graphLoading, graphMountKey]);


  useEffect(() => {
    graphRef.current?.nodeColor(graphRef.current?.nodeColor());
    graphRef.current?.linkColor(graphRef.current?.linkColor());
  }, [selectedId, searchQuery, showGrid, showRegions, blobTraits]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Use containerRef.current rather than captured `el` so we always read the
      // live element even after graphMountKey replaces the container div.
      const c = containerRef.current;
      if (c && graphRef.current) {
        graphRef.current.width(c.clientWidth).height(c.clientHeight);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [graphMountKey]); // re-run when graphMountKey replaces the container element

  return (
    <div className="panel graph-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* Wrapper: flex column so container fills via flex:1; position:relative anchors the overlays */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      {/* ForceGraph2D exclusively owns this div — no React children inside */}
      <div
        key={graphMountKey}
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', outline: 'none' }}
        onClick={() => setCtxMenu(null)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            const idsToDelete = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
            if (idsToDelete.length > 0) setShowDeleteConfirm(true);
            return;
          }

          // Escape: clear focus cursor and selection
          if (e.key === 'Escape') {
            setFocusedNodeId(null);
            clearSelection();
            return;
          }

          // Space: toggle focused node in/out of actual selection
          if (e.key === ' ') {
            e.preventDefault();
            if (!focusedNodeId) return;
            toggleSelection(focusedNodeId);
            return;
          }

          // Arrow keys: move keyboard focus cursor (independent of selection)
          const arrowDir: Record<string, [number, number]> = {
            ArrowRight: [1, 0], ArrowLeft: [-1, 0],
            ArrowUp: [0, -1], ArrowDown: [0, 1],
          };
          if (e.key in arrowDir && graphRef.current) {
            e.preventDefault();
            const [dx, dy] = arrowDir[e.key];
            const { nodes } = graphRef.current.graphData();
            const cursorShortId = focusedNodeId
              ? focusedNodeId.replace('entity:', '')
              : selectedId
                ? selectedId.replace('entity:', '')
                : null;

            if (!cursorShortId) {
              // Pick the node closest to the graph centre as starting cursor
              const validNodes = nodes.filter((n: any) => n.x != null && n.y != null);
              if (validNodes.length > 0) {
                const cx = validNodes.reduce((s: number, n: any) => s + n.x, 0) / validNodes.length;
                const cy = validNodes.reduce((s: number, n: any) => s + n.y, 0) / validNodes.length;
                const closest = validNodes.reduce((best: any, n: any) => {
                  const d = (n.x - cx) ** 2 + (n.y - cy) ** 2;
                  return d < best.d ? { n, d } : best;
                }, { n: validNodes[0], d: Infinity }).n;
                setFocusedNodeId(`entity:${closest.id}`);
                graphRef.current.centerAt(closest.x, closest.y, 300);
              }
              return;
            }

            const cur = nodes.find((n: any) => n.id === cursorShortId);
            if (!cur || cur.x == null || cur.y == null) return;

            let bestNode: any = null;
            let bestScore = Infinity;
            for (const node of nodes) {
              if (node.id === cursorShortId || node.x == null || node.y == null) continue;
              const relX = node.x - cur.x;
              const relY = node.y - cur.y;
              const dist = Math.sqrt(relX * relX + relY * relY);
              if (dist < 0.1) continue;
              const dot = (relX / dist) * dx + (relY / dist) * dy;
              if (dot < 0.707) continue;
              const score = dist / dot;
              if (score < bestScore) { bestScore = score; bestNode = node; }
            }
            if (bestNode) {
              setFocusedNodeId(`entity:${bestNode.id}`);
              graphRef.current.centerAt(bestNode.x, bestNode.y, 300);
            }
          }
        }}
      />

        {/* Marquee selection overlay — sibling of container, not inside it */}
        {selectionBoxScreen && (
          <div style={{
            position: 'absolute',
            left: selectionBoxScreen.left,
            top: selectionBoxScreen.top,
            width: selectionBoxScreen.width,
            height: selectionBoxScreen.height,
            background: 'rgba(100, 150, 255, 0.15)',
            border: '1.5px solid rgba(100, 150, 255, 0.85)',
            pointerEvents: 'none',
            zIndex: 10,
          }} />
        )}

        {/* Empty-state overlay — sibling of container, not inside it */}
        {entities.length === 0 && graphMode === 'context' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            gap: 8,
          }}>
            <span style={{ fontSize: 28, opacity: 0.18 }}>◎</span>
            <span style={{ fontSize: 12, color: 'var(--text-hint)', opacity: 0.55, fontStyle: 'italic' }}>
              Search or select an entity to explore
            </span>
          </div>
        )}
      </div>

      {ctxMenu && (
        <div
          style={{ position: 'fixed', zIndex: 500, left: ctxMenu.x, top: ctxMenu.y, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 7, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', minWidth: 160, padding: '4px 0' }}
          onMouseLeave={() => setCtxMenu(null)}
          onContextMenu={e => e.preventDefault()}
        >
          {selectedIds.length > 1 ? (
            <>
              <div style={{ padding: '4px 14px', fontSize: 10, color: 'var(--text-hint)', fontWeight: 600 }}>SELECTION ({selectedIds.length})</div>
              <div
                onClick={() => { setQuickTagNode({ id: 'selection', label: `${selectedIds.length} entities` }); setCtxMenu(null); }}
                style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--text-primary)' }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = '')}
              >
                Tag Selection…
              </div>
              <div
                onClick={() => { if (confirm(`Delete ${selectedIds.length} entities?`)) deleteEntities(selectedIds); setCtxMenu(null); }}
                style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: '#ff6b6b' }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = '')}
              >
                Delete Selection
              </div>
            </>
          ) : (
            [
              { label: 'Inspect', action: () => { selectEntity(ctxMenu.nodeId); setCtxMenu(null); } },
              { label: 'Relate…', action: () => { setShowRelate(true); setCtxMenu(null); } },
              { label: 'Tag…', action: () => { setQuickTagNode({ id: ctxMenu.nodeId, label: ctxMenu.nodeLabel }); setCtxMenu(null); } },
              { label: 'Set Icon…', action: async () => {
                const picked = await invoke<string | null>('pick_icon_file');
                if (picked) {
                  // Import to CAS so the resolved path lands inside the asset
                  // protocol scope; otherwise convertFileSrc on a random
                  // user path returns a URL the WebView refuses to load.
                  let iconPath: string;
                  try {
                    iconPath = await invoke<string>('import_to_store', { filePath: picked });
                  } catch (e) {
                    console.error('Icon import failed', e);
                    setCtxMenu(null);
                    return;
                  }
                  const ent = entities.find((e: any) => e.id === ctxMenu.nodeId);
                  if (ent) {
                    const values = entityValues(ent.id, keyValueTraits);
                    await invoke('save_entity_data', {
                      id: ctxMenu.nodeId,
                      values: { ...values, 'ui.icon': iconPath },
                    });
                  }
                }
                setCtxMenu(null);
              }},
              { label: 'Clear Icon', action: async () => {
                const ent2 = entities.find((e: any) => e.id === ctxMenu.nodeId);
                const values = ent2 ? entityValues(ent2.id, keyValueTraits) : {};
                if (ent2 && values['ui.icon']) {
                  const { ['ui.icon']: _removed, ...rest } = values;
                  await invoke('save_entity_data', { id: ctxMenu.nodeId, values: rest });
                }
                setCtxMenu(null);
              }},
              { label: 'Delete', action: () => { deleteEntity(ctxMenu.nodeId); setCtxMenu(null); }, danger: true },
            ].map(item => (
              <div key={item.label} onClick={item.action} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: (item as any).danger ? '#ff6b6b' : 'var(--text-primary)' }} onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                {item.label}
              </div>
            ))
          )}
        </div>
      )}

      {selectedLinkMenu && (
        <div
          style={{ position: 'fixed', zIndex: 500, left: selectedLinkMenu.x, top: selectedLinkMenu.y, background: 'var(--bg-panel)', border: '1px solid var(--accent)', borderRadius: 7, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', minWidth: 180, padding: '4px 0' }}
          onMouseLeave={() => setSelectedLinkMenu(null)}
          onContextMenu={e => e.preventDefault()}
        >
          <div style={{ padding: '4px 14px', fontSize: 10, color: 'var(--text-hint)', fontWeight: 600 }}>EDGE · {selectedLinkMenu.label}</div>
          <div
            onClick={async () => {
              const menu = selectedLinkMenu;
              setSelectedLinkMenu(null);
              selectedLinkRef.current = null;
              try {
                await invoke('reify_edge', {
                  fromId: `entity:${menu.source}`,
                  toId: `entity:${menu.target}`,
                  label: menu.label,
                });
              } catch (e) { console.error('reify_edge failed:', e); }
            }}
            style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--text-primary)' }}
            onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
            onMouseLeave={ev => (ev.currentTarget.style.background = '')}
          >
            Reify to Node
          </div>
          <div
            onClick={async () => {
              const menu = selectedLinkMenu;
              setSelectedLinkMenu(null);
              selectedLinkRef.current = null;
              try {
                await invoke('remove_edge', {
                  fromId: `entity:${menu.source}`,
                  toId: `entity:${menu.target}`,
                  label: menu.label,
                });
              } catch (e) { console.error('remove_edge failed:', e); }
            }}
            style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: '#ff6b6b' }}
            onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')}
            onMouseLeave={ev => (ev.currentTarget.style.background = '')}
          >
            Delete Edge
          </div>
        </div>
      )}

      {quickTagNode && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={e => { if (e.target === e.currentTarget) setQuickTagNode(null); }}>
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 9, padding: '20px 24px', minWidth: 300, boxShadow: '0 6px 32px rgba(0,0,0,0.5)' }}>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>Add tag to <strong>{quickTagNode.label}</strong></p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input autoFocus type="text" value={quickTagInput} onChange={e => setQuickTagInput(e.target.value)} onKeyDown={async ev => {
                if (ev.key === 'Enter') {
                  if (quickTagNode.id === 'selection') {
                    await tagEntities(selectedIds, quickTagInput.trim());
                  } else {
                    await tagEntity(quickTagNode.id, quickTagInput.trim());
                  }
                  setQuickTagNode(null); setQuickTagInput('');
                }
                if (ev.key === 'Escape') setQuickTagNode(null);
              }} placeholder="Tag name…" style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
              <button
                onClick={async () => {
                  if (quickTagNode.id === 'selection') {
                    await tagEntities(selectedIds, quickTagInput.trim());
                  } else {
                    await tagEntity(quickTagNode.id, quickTagInput.trim());
                  }
                  setQuickTagNode(null); setQuickTagInput('');
                }}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 5, padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              >
                Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation moved inline into the Graph side panel's
          selection actions block. The Delete key still toggles
          showDeleteConfirm via the store; the side panel renders the
          inline Yes/No row when it's true. */}

      {showRelate && ctxMenu && (
        <RelateDialog sourceEntityId={ctxMenu.nodeId} sourceLabel={ctxMenu.nodeLabel} onClose={() => setShowRelate(false)} />
      )}
    </div>
  );
});
