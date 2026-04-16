import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
// @ts-ignore
import ForceGraph2D from 'force-graph';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

import { useOsStore, resolvedLabel } from '../store';
import { RelateDialog } from './RelateDialog';
import { KEYBINDS } from '../App';
import { getConvexHull, drawRoundedHullPath, getStableColor, findShortestPath, pathEdgeKeys } from '../utils/graphUtils';
import { SearchableDropdown } from './SearchableDropdown';

interface GNode {
  id: string;
  label: string;
  kind: string;
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

const KIND_COLORS: Record<string, string> = {
  physical: '#6de096',
  digital: '#7eb0ff',
  abstract: '#f5d060',
  agent: '#d680ff',
  blob: '#ff9f43',
  temporal: '#ff7eb3',
};

const selectEntities = (s: any) => s.entities;
const selectEdges = (s: any) => s.edges;
const selectSelectedId = (s: any) => s.selectedEntityId;
const selectSelectEntity = (s: any) => s.selectEntity;
const selectBlobTraits = (s: any) => s.blobTraits;

/**
 * Visual configuration for Tag Regions
 */
const REGION_STYLE = {
  dilationRadius: 15,    // Space around node center included in region hull
  borderWidth: 1.0,      // Boundary stroke thickness
  borderAlpha: 0.85,      // Boundary stroke opacity
  hatchSpacing: 5,      // Distance between diagonal lines (pixels)
  hatchAlpha: 0.5,      // Opacity of the diagonal hatch lines (controls "faintness")
  hatchLineWidth: 0.5,   // Integer for maximum sharpness
  roundness: 0.7,        // Corner roundness factor (0.0 to 1.0)
  labelVOffset: 12,      // Vertical offset for the tag label above the hull
  labelAlpha: 0.85,      // Opacity of the tag label
  labelFont: 'bold 6px "JetBrains Mono", sans-serif',
};


const ENTITY_KINDS = ['physical', 'digital', 'abstract', 'agent', 'blob', 'temporal'];

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
  const { deleteEntity, deleteEntities, tagEntity, tagEntities, showRegions, toggleRegions, updateNodePosition, nodePositions, filterKinds, toggleFilterKind, setFilterKinds, filterEdgeLabels, toggleFilterEdgeLabel, highlightedPath, highlightedEdgeKeys, setHighlightedPath, clearHighlightedPath, expandContext, loadExactIds, clearGraph, loadFullGraph, setHopCount, graphMode } = useOsStore();
  const hopCount = useOsStore((s: any) => s.hopCount);
  const allLabelTraits = useOsStore((s: any) => s.allLabelTraits);
  const activeLocale = useOsStore((s: any) => s.activeLocale);
  const allEntities = useOsStore((s: any) => s.allEntities);
  const backendReady = useOsStore((s: any) => s.backendReady);

  // Phase 44: explore bar state
  const [exploreQuery, setExploreQuery] = useState('');
  const [exploreInputFocused, setExploreInputFocused] = useState(false);
  const [exploreStatus, setExploreStatus] = useState<string | null>(null);
  const exploreDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local dropdown list: filters allEntities by kind and/or label without a backend round-trip.
  const filteredDropdown = useMemo(() => {
    const q = exploreQuery.trim().toLowerCase();
    if (/^select\s/i.test(q)) return []; // SQL mode — dropdown not used
    return allEntities.filter((e: any) => {
      if (q.length === 0) return true; // show all when empty
      if (ENTITY_KINDS.includes(q)) return e.kind === q; // exact kind match
      if ((e.kind as string).startsWith(q)) return true;                        // partial kind
      const label = resolvedLabel(e, allLabelTraits, activeLocale).toLowerCase();
      if (label.includes(q)) return true;
      return allLabelTraits.some((t: any) => t.owner === e.id && t.text.toLowerCase().includes(q));
    }).slice(0, 60);
  }, [exploreQuery, allEntities, allLabelTraits, activeLocale]);

  // searchQuery drives local node highlight in the canvas; wired to exploreQuery
  const [searchQuery, setSearchQuery] = useState('');
  const [showGrid, setShowGrid] = useState(true);
  const [toggledImageNodes, setToggledImageNodes] = useState<Set<string>>(new Set());

  // Path finder state
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string; nodeLabel: string } | null>(null);
  const [showRelate, setShowRelate] = useState(false);
  const [quickTagNode, setQuickTagNode] = useState<{ id: string; label: string } | null>(null);
  const [quickTagInput, setQuickTagInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
          setExploreInputFocused(false);
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
    }
  }, [toggledImageNodes]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const onNodeClick = useCallback((node: any, event: MouseEvent) => {
    const nodeId: string = (node as GNode).id;
    const fullId = nodeId.startsWith('entity:') ? nodeId : `entity:${nodeId}`;

    // Toggle multi-select
    if (KEYBINDS.multiSelectModifier(event)) {
      toggleSelection(fullId);
      return;
    }

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
  }, [selectEntity, toggleSelection]);

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

    const g = (ForceGraph2D as any)()(containerRef.current)
      .graphData({ nodes: [], links: [] })
      .backgroundColor('rgba(0,0,0,0)')
      .linkColor((link: any) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const edgeKey = `${sourceId}|${targetId}`;
        if (highlightedEdgeKeysRef.current.size > 0 && highlightedEdgeKeysRef.current.has(edgeKey)) {
          return getComputedStyle(document.documentElement).getPropertyValue('--graph-path').trim() || '#f5a623';
        }
        const sq = searchQueryRef.current.toLowerCase();
        const sm = !sq || (link.source?.label && link.source.label.toLowerCase().includes(sq));
        const tm = !sq || (link.target?.label && link.target.label.toLowerCase().includes(sq));
        const baseColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#a0a0a0';
        return (sq && !sm && !tm) ? 'rgba(100, 100, 100, 0.15)' : baseColor;
      })
      .linkWidth((link: any) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const edgeKey = `${sourceId}|${targetId}`;
        return highlightedEdgeKeysRef.current.has(edgeKey) ? 4 : 1.5;
      })
      .linkDirectionalArrowLength(5)
      .linkDirectionalArrowRelPos(1)
      .onNodeClick(onNodeClick)
      .onNodeRightClick(onNodeRightClick)
      .onBackgroundClick(() => {
        // Clear selection on background click
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
              
              // We want standard white PDF background since we'll draw it on the graph
              offCtx.fillStyle = '#ffffff';
              offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);

              return page.render({ canvasContext: offCtx, viewport: viewport } as any).promise.then(() => {
                // Pixel-level Theme Color Injection
                const temp = document.createElement('div');
                document.body.appendChild(temp);
                
                const getRgb = (varName: string) => {
                  temp.style.color = `var(${varName})`;
                  const colorString = getComputedStyle(temp).color;
                  const match = colorString.match(/\d+/g);
                  if (match && match.length >= 3) {
                    return [parseInt(match[0], 10), parseInt(match[1], 10), parseInt(match[2], 10)];
                  }
                  return [255, 255, 255];
                };

                const bgTone = getRgb('--bg-primary');
                const textTone = getRgb('--text-primary');
                document.body.removeChild(temp);

                const imageData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                  const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
                  if (a === 0) continue; 
                  
                  const lightness = (r + g + b) / (3 * 255);
                  data[i] = textTone[0] * (1 - lightness) + bgTone[0] * lightness;
                  data[i+1] = textTone[1] * (1 - lightness) + bgTone[1] * lightness;
                  data[i+2] = textTone[2] * (1 - lightness) + bgTone[2] * lightness;
                }
                offCtx.putImageData(imageData, 0, 0);

                n.img = offCanvas; // Cash into image property
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

            ctx.save();
            ctx.drawImage(n.img, n.x - w / 2, n.y - h / 2, w, h);
            ctx.restore();

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

        if (globalScale > 0.8) {
          const fontSize = 4;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const txtCol = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e4e6f0';
          ctx.fillStyle = txtCol;
          ctx.font = `${fontSize}px "JetBrains Mono", sans-serif`;
          ctx.fillText(n.label, n.x, n.y + (isImageReady ? (n.__imgH! / 2 + 5) : radius + 3.5));
        }
        ctx.globalAlpha = 1;
      })
      .linkCanvasObjectMode(() => 'after')
      .linkCanvasObject((link: any, ctx: CanvasRenderingContext2D) => {
        const sq = searchQueryRef.current.toLowerCase();
        const sm = !sq || (link.source?.label && link.source.label.toLowerCase().includes(sq));
        const tm = !sq || (link.target?.label && link.target.label.toLowerCase().includes(sq));
        if (sq && !sm && !tm) return;

        if (!link.source || !link.target || typeof link.source !== 'object' || typeof link.target !== 'object') return;
        if (link.source.x == null || link.source.y == null || Number.isNaN(link.source.x) || Number.isNaN(link.source.y)) return;
        if (link.target.x == null || link.target.y == null || Number.isNaN(link.target.x) || Number.isNaN(link.target.y)) return;
        if (link.source.id === link.target.id) return;

        const label = link.label;
        if (!label) return;

        const fontSize = 3;
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
        ctx.fillStyle = txtSec;
        ctx.fillText(label, x, y);
      })
      .onRenderFramePre((ctx: CanvasRenderingContext2D, _globalScale: number) => {
        // 1. Draw Grid
        if (showGridRef.current) {
          const canvas = ctx.canvas;
          const width = canvas.width;
          const height = canvas.height;
          const t = (canvas as any).__zoom ?? { x: 0, y: 0, k: 1 };
          const tx = t.x;
          const ty = t.y;
          const k = t.k;

          const spacing = 50 * k;
          if (spacing >= 4) {
            ctx.save();
            ctx.resetTransform();
            const borderCol = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#444';
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
          }
        }

        // 2. Draw Tag Regions
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
                  // Include the tag entity itself in its region
                  if (toNode) {
                    groups[toId].points.push({ x: toNode.x, y: toNode.y });
                  }
                }
                groups[toId].points.push({ x: fromNode.x, y: fromNode.y });
              }
            }
          });

          Object.entries(groups).forEach(([tagId, group]) => {
            if (group.points.length < 1) return;

            // Dilation: add a bubble around each node to create the "gap"
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

            ctx.save();

            // 1. Define the hull path for fill and clipping
            ctx.beginPath();
            drawRoundedHullPath(ctx, hull, REGION_STYLE.roundness);

            // 2. Background Fill
            ctx.globalAlpha = 0.05;
            ctx.fillStyle = color;
            ctx.fill();

            // 3. Manual Hatching (Clipped to the hull)
            ctx.save();
            ctx.clip();

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = REGION_STYLE.hatchLineWidth;
            ctx.globalAlpha = REGION_STYLE.hatchAlpha;

            // Calculate the exact range of k = x - y for the diagonals
            const kValues = hull.map(p => p.x - p.y);
            const kMin = Math.min(...kValues);
            const kMax = Math.max(...kValues);

            const spacing = REGION_STYLE.hatchSpacing;
            // Sweep k from min to max. We add extra padding to ensure full edge coverage
            for (let k = kMin - spacing; k < kMax + spacing; k += spacing) {
              // Diagonal line x = y + k. 
              // To cover the hull, we draw a line long enough to cross the bounding box.
              const minY = Math.min(...hull.map(p => p.y)) - spacing;
              const maxY = Math.max(...hull.map(p => p.y)) + spacing;
              ctx.moveTo(k + minY, minY);
              ctx.lineTo(k + maxY, maxY);
            }
            ctx.stroke();
            ctx.restore(); // Remove clipping

            // 4. Border (Redraw the path if needed or reuse if possible)
            // Note: restoring state might have cleared the path in some browsers if it wasn't saved, 
            // so we redraw it for the stroke to be safe.
            ctx.beginPath();
            drawRoundedHullPath(ctx, hull, REGION_STYLE.roundness);
            ctx.globalAlpha = REGION_STYLE.borderAlpha;
            ctx.strokeStyle = color;
            ctx.lineWidth = REGION_STYLE.borderWidth;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            ctx.restore();

            // Label
            if (_globalScale > 0.4) {
              ctx.save();
              ctx.font = REGION_STYLE.labelFont;
              ctx.fillStyle = color;
              ctx.textAlign = 'center';
              const minYHull = Math.min(...hull.map(p => p.y));
              const avgX = hull.reduce((a, b) => a + b.x, 0) / hull.length;
              ctx.globalAlpha = REGION_STYLE.labelAlpha;
              ctx.fillText(group.label.toUpperCase(), avgX, minYHull - REGION_STYLE.labelVOffset);
              ctx.restore();
            }
          });
        }

        // 3. (Marquee rect is now a React div overlay — no canvas drawing needed)
      })
      .cooldownTicks(300)
      .d3AlphaDecay(0.02)
      .d3VelocityDecay(0.3);

    g.d3Force('charge').strength(-50).distanceMin(8).distanceMax(300);
    g.d3Force('link').distance(40);

    g.onNodeDragEnd((node: any) => {
      if (node.id) updateNodePosition(node.id, node.x, node.y);
    });

    graphRef.current = g;
  }, [onNodeClick, onNodeRightClick]);

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

  // Synchronous filtering for UI stats and data preparation
  const filteredData = useMemo(() => {
    const isFiltered = filterKinds.length > 0;
    const kindNodes = isFiltered
      ? entities.filter((e: any) => filterKinds.includes(e.kind))
      : entities;

    const nodeIds = new Set(kindNodes.map((e: any) => e.id.replace('entity:', '')));
    const kindEdges = edges.filter((e: any) => {
      const sourceId = e.from.replace('entity:', '');
      const targetId = e.to.replace('entity:', '');
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return false;
      if (filterEdgeLabels.length > 0 && filterEdgeLabels.includes(e.label)) return false;
      return true;
    });

    return { nodes: kindNodes, edges: kindEdges };
  }, [entities, edges, filterKinds, filterEdgeLabels]);

  // Sync data to force-graph instance
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;

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
      if (live) {
        live.label = displayLabel;
        live.kind = entity.kind;
        live.metadata = entity.metadata;
        nextNodes.push(live);
      } else {
        nextNodes.push({
          id: strippedId,
          label: displayLabel,
          kind: entity.kind,
          metadata: entity.metadata,
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

    g.graphData({ nodes: nextNodes, links: nextLinks });
  }, [filteredData, nodePositions, showRegions, allLabelTraits, activeLocale]);


  useEffect(() => {
    graphRef.current?.nodeColor(graphRef.current?.nodeColor());
    graphRef.current?.linkColor(graphRef.current?.linkColor());
  }, [selectedId, searchQuery, showGrid, showRegions, blobTraits]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      graphRef.current?.width(el.clientWidth).height(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Derive unique edge labels for the label filter
  const allEdgeLabels = useMemo(() => {
    const labels = new Set<string>();
    edges.forEach((e: any) => e.label && labels.add(e.label));
    return Array.from(labels).sort();
  }, [edges]);

  return (
    <div className="panel graph-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* TOOLBAR: Row 1 - Explore bar, graph controls, toggles */}
      <div className="panel-stats">
        <div className="panel-row" style={{ flexWrap: 'wrap' }}>
          {/* Phase 44: Explore bar */}
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder={/^select\s/i.test(exploreQuery) ? 'SurrealQL...' : 'Explore entities...'}
              value={exploreQuery}
              onChange={e => setExploreQuery(e.target.value)}
              onFocus={() => setExploreInputFocused(true)}
              onBlur={() => setTimeout(() => setExploreInputFocused(false), 150)}
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--accent)',
                color: 'var(--text-primary)',
                padding: '2px 8px',
                borderRadius: 4,
                outline: 'none',
                fontSize: 11,
                width: 180,
                height: 22,
              }}
            />
            {exploreInputFocused && filteredDropdown.length > 0 && (
              <div style={{
                position: 'absolute',
                top: 25,
                left: 0,
                width: 240,
                maxHeight: 260,
                overflowY: 'auto',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                zIndex: 200,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
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
                        padding: '4px 10px',
                        fontSize: 11,
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        gap: 6,
                        alignItems: 'center',
                      }}
                      onMouseEnter={el => (el.currentTarget.style.background = 'var(--bg-primary)')}
                      onMouseLeave={el => (el.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ color: KIND_COLORS[e.kind as string] ?? 'var(--text-hint)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{e.kind as string}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</span>
                      {matchingTrait && matchingTrait.lang !== activeLocale && (
                        <span style={{ fontSize: 9, color: 'var(--text-hint)', flexShrink: 0 }}>{matchingTrait.lang}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {exploreStatus && (
            <span style={{ fontSize: 10, color: 'var(--text-hint)', fontStyle: 'italic' }}>
              {exploreStatus}
            </span>
          )}

          {/* Graph mode controls */}
          <button
            onClick={() => clearGraph()}
            title="Clear graph"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-hint)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11, height: 22 }}
          >
            Clear
          </button>
          <button
            onClick={() => backendReady && loadFullGraph()}
            disabled={!backendReady}
            title={backendReady ? 'Load all entities from database' : 'Backend initializing…'}
            style={{ background: graphMode === 'full' ? 'var(--accent)' : 'var(--bg-secondary)', border: `1px solid ${graphMode === 'full' ? 'var(--accent)' : 'var(--border)'}`, color: graphMode === 'full' ? '#fff' : backendReady ? 'var(--text-primary)' : 'var(--text-hint)', padding: '2px 8px', borderRadius: 4, cursor: backendReady ? 'pointer' : 'not-allowed', fontSize: 11, height: 22, opacity: backendReady ? 1 : 0.5 }}
          >
            {backendReady ? 'Load Full' : 'Init…'}
          </button>

          {/* Hops spinner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', fontWeight: 600 }}>Hops:</span>
            <button onClick={() => setHopCount(hopCount - 1)} disabled={hopCount <= 0} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11, width: 18, height: 18, padding: 0, lineHeight: 1 }}>−</button>
            <span style={{ fontSize: 11, color: 'var(--text-primary)', minWidth: 10, textAlign: 'center' }}>{hopCount}</span>
            <button onClick={() => setHopCount(hopCount + 1)} disabled={hopCount >= 5} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11, width: 18, height: 18, padding: 0, lineHeight: 1 }}>+</button>
          </div>

          <button
            onClick={() => {
              if (graphRef.current) {
                graphRef.current.zoom(1, 400);
                setTimeout(() => graphRef.current?.zoomToFit(400, 30), 450);
              }
            }}
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11, height: 22 }}
          >
            Reset
          </button>

          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-hint)', textTransform: 'uppercase', marginLeft: 8 }}>Find Path:</span>

          <SearchableDropdown
            placeholder="From entity..."
            value={pathFrom}
            onChange={setPathFrom}
            options={entities.map((e: any) => ({ id: e.id, label: e.label }))}
            style={{ width: 140 }}
          />

          <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>→</span>

          <SearchableDropdown
            placeholder="To entity..."
            value={pathTo}
            onChange={setPathTo}
            options={entities.map((e: any) => ({ id: e.id, label: e.label }))}
            style={{ width: 140 }}
          />

          <button
            onClick={() => {
              setPathError(null);
              const fromEntity = entities.find((e: any) => e.label === pathFrom || e.id === pathFrom || e.id === `entity:${pathFrom}`);
              const toEntity = entities.find((e: any) => e.label === pathTo || e.id === pathTo || e.id === `entity:${pathTo}`);
              if (!fromEntity || !toEntity) { setPathError('Entity not found'); return; }
              const fromShort = fromEntity.id.replace('entity:', '');
              const toShort = toEntity.id.replace('entity:', '');
              const shortEdges = edges.map((e: any) => ({ from: e.from.replace('entity:', ''), to: e.to.replace('entity:', ''), label: e.label }));
              const pathShort = findShortestPath(fromShort, toShort, shortEdges);
              if (!pathShort) { setPathError('No path found'); return; }
              const pathPrefixed = pathShort.map(id => `entity:${id}`);
              const eKeys = pathEdgeKeys(pathShort);
              setHighlightedPath(pathPrefixed, eKeys);
            }}
            style={{ background: 'var(--accent)', border: 'none', borderRadius: 4, padding: '2px 10px', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, height: 22 }}
          >
            Find
          </button>

          {highlightedPath.length > 0 && (
            <button
              onClick={() => { clearHighlightedPath(); setPathError(null); }}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', color: 'var(--text-hint)', cursor: 'pointer', fontSize: 11, height: 22 }}
            >
              ✕
            </button>
          )}

          {pathError && <span style={{ fontSize: 11, color: 'var(--error)' }}>{pathError}</span>}

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-hint)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
              Grid
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-hint)', cursor: 'pointer' }}>
              <input type="checkbox" checked={showRegions} onChange={() => toggleRegions()} />
              Regions
            </label>
          </div>
        </div>

        {/* Row 2: Node Count + Kind Filter */}
        <div className="panel-row" style={{ borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 4 }}>
          <span className="event-badge" style={{ marginRight: 4 }}>
            {filterKinds.length > 0 || filterEdgeLabels.length > 0 ? `${filteredData.nodes.length}/${entities.length} nodes` : `${entities.length} nodes`}
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', fontWeight: 600, textTransform: 'uppercase' }}>Nodes:</span>
            {['physical', 'digital', 'abstract', 'agent', 'blob', 'temporal'].map(kind => {
              const active = filterKinds.includes(kind);
              return (
                <button
                  key={kind}
                  onClick={() => toggleFilterKind(kind)}
                  style={{
                    background: active ? KIND_COLORS[kind] : 'transparent',
                    border: `1px solid ${active ? KIND_COLORS[kind] : 'var(--border)'}`,
                    color: active ? '#000' : 'var(--text-secondary)',
                    fontSize: 10,
                    padding: '1px 7px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    opacity: active ? 1 : 0.6,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {kind}
                </button>
              );
            })}
            {filterKinds.length > 0 && (
              <button
                onClick={() => setFilterKinds([])}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 10, padding: '2px 4px', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Row 3: Edge Count + Edge Label Filter — show when edges exist OR active filters set */}
        {(allEdgeLabels.length > 0 || filterEdgeLabels.length > 0) && (
          <div className="panel-row" style={{ borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 4 }}>
            <span className="event-badge" style={{ marginRight: 4 }}>
              {filterKinds.length > 0 || filterEdgeLabels.length > 0 ? `${filteredData.edges.length}/${edges.length} edges` : `${edges.length} edges`}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', fontWeight: 600, textTransform: 'uppercase' }}>Edges:</span>
            {allEdgeLabels.map(label => {
              const hidden = filterEdgeLabels.includes(label);
              return (
                <button
                  key={label}
                  onClick={() => toggleFilterEdgeLabel(label)}
                  style={{
                    background: hidden ? 'var(--bg-primary)' : 'transparent',
                    border: `1px solid ${hidden ? 'var(--accent)' : 'var(--border)'}`,
                    color: hidden ? 'var(--accent)' : 'var(--text-hint)',
                    fontSize: 10,
                    padding: '1px 8px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    textDecoration: hidden ? 'line-through' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

      </div>

      <div 
        ref={containerRef} 
        style={{ flex: 1, width: '100%', minHeight: 0, overflow: 'hidden', position: 'relative', outline: 'none' }} 
        onClick={() => setCtxMenu(null)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            const idsToDelete = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
            if (idsToDelete.length > 0) {
              setShowDeleteConfirm(true);
            }
          }
        }}
      >
        {/* Marquee selection overlay */}
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

        {/* Phase 44: empty-state overlay */}
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
            // Bulk Actions
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
            // Single Action
            [
              { label: 'Inspect', action: () => { selectEntity(ctxMenu.nodeId); setCtxMenu(null); } },
              { label: 'Relate…', action: () => { setShowRelate(true); setCtxMenu(null); } },
              { label: 'Tag…', action: () => { setQuickTagNode({ id: ctxMenu.nodeId, label: ctxMenu.nodeLabel }); setCtxMenu(null); } },
              { label: 'Delete', action: () => { deleteEntity(ctxMenu.nodeId); setCtxMenu(null); }, danger: true },
            ].map(item => (
              <div key={item.label} onClick={item.action} style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: (item as any).danger ? '#ff6b6b' : 'var(--text-primary)' }} onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg)')} onMouseLeave={ev => (ev.currentTarget.style.background = '')}>
                {item.label}
              </div>
            ))
          )}
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

      {showDeleteConfirm && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
        >
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 9, padding: '20px 24px', minWidth: 250, boxShadow: '0 6px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-primary)', textAlign: 'center' }}>
              Delete {selectedIds.length > 0 ? selectedIds.length : 1} selected entit{(selectedIds.length > 0 ? selectedIds.length : 1) > 1 ? 'ies' : 'y'}?
            </p>
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#ff6b6b', fontWeight: 600 }}>Sure?</span>
              <button 
                onClick={() => { 
                  const idsToDelete = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
                  deleteEntities(idsToDelete); 
                  setShowDeleteConfirm(false); 
                }} 
                style={{ background: '#ff6b6b', border: 'none', borderRadius: 5, padding: '6px 14px', cursor: 'pointer', color: '#fff', fontSize: 13, fontWeight: 700 }}
              >Yes</button>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 12px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 13, fontWeight: 600 }}>No</button>
            </span>
          </div>
        </div>
      )}

      {showRelate && ctxMenu && (
        <RelateDialog sourceEntityId={ctxMenu.nodeId} sourceLabel={ctxMenu.nodeLabel} onClose={() => setShowRelate(false)} />
      )}
    </div>
  );
});
