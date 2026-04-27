// Centralized in-code configuration. Values here are DEFAULTS; the Settings UI
// can override them at runtime via the `humanist:settings` localStorage entry,
// merged shallowly per top-level group on load.

export type Theme =
  | 'catppuccin-mocha' | 'catppuccin-latte' | 'dracula' | 'tokyo-night'
  | 'solarized-dark' | 'solarized-light' | 'nord' | 'gruvbox-dark' | 'github-light';

export type Locale =
  | 'en' | 'de' | 'fr' | 'pt' | 'es' | 'ca' | 'it' | 'nl' | 'zh' | 'ja' | 'ko' | 'ar' | 'ru';

export type EntityCategory = 'physical' | 'digital' | 'abstract' | 'persona';

export type GraphLayoutMode = 'default' | 'clustered' | 'hairball';

export interface ForceGraphParams {
  chargeStrength: number;
  chargeDistanceMin: number;
  chargeDistanceMax: number;
  linkDistance: number;
  alphaDecay: number;
  velocityDecay: number;
  cooldownTicks: number;
  flowBias: number;
  // Per-tick velocity nudge toward (0, 0). Higher values pack disconnected
  // subgraphs closer to one another; the hard collide keeps them from
  // merging or overlapping. Tune from 0.02 (loose) to 0.12 (tight).
  gravityStrength: number;
}

export const THEMES: { id: Theme; label: string }[] = [
  { id: 'catppuccin-mocha',  label: 'Catppuccin Mocha' },
  { id: 'catppuccin-latte',  label: 'Catppuccin Latte' },
  { id: 'dracula',           label: 'Dracula' },
  { id: 'tokyo-night',       label: 'Tokyo Night' },
  { id: 'solarized-dark',    label: 'Solarized Dark' },
  { id: 'solarized-light',   label: 'Solarized Light' },
  { id: 'nord',              label: 'Nord' },
  { id: 'gruvbox-dark',      label: 'Gruvbox Dark' },
  { id: 'github-light',      label: 'GitHub Light' },
];

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'en — English' },
  { value: 'de', label: 'de — Deutsch' },
  { value: 'fr', label: 'fr — Français' },
  { value: 'pt', label: 'pt — Português' },
  { value: 'es', label: 'es — Español' },
  { value: 'ca', label: 'ca — Català' },
  { value: 'it', label: 'it — Italiano' },
  { value: 'nl', label: 'nl — Nederlands' },
  { value: 'zh', label: 'zh — 中文' },
  { value: 'ja', label: 'ja — 日本語' },
  { value: 'ko', label: 'ko — 한국어' },
  { value: 'ar', label: 'ar — العربية' },
  { value: 'ru', label: 'ru — Русский' },
];

export const KEYBINDS_REFERENCE: { key: string; action: string }[] = [
  { key: 'Ctrl+G',   action: 'Graph canvas' },
  { key: 'Ctrl+M',   action: 'Globe canvas' },
  { key: 'Ctrl+L',   action: 'Timeline canvas' },
  { key: 'Ctrl+Y',   action: 'Calendar canvas' },
  { key: 'Ctrl+T',   action: 'Terminal' },
  { key: 'Ctrl+B',   action: 'Toggle side panel' },
  { key: 'Ctrl+\\',  action: 'Toggle right panel' },
  { key: 'Ctrl+Tab', action: 'Cycle activities' },
  { key: 'Ctrl+N',   action: 'New entity' },
  { key: 'Ctrl+I',   action: 'Ingest data' },
  { key: 'Delete',   action: 'Delete selected nodes' },
];

// Predicate-style keybindings used by App-level keyboard handlers.
// Edit here to remap; restart picks the change up immediately.
export const KEYBINDS = {
  layoutMaster:        (e: KeyboardEvent) => e.ctrlKey && e.key === '1',
  layoutBstack:        (e: KeyboardEvent) => e.ctrlKey && e.key === '2',
  layoutMonocle:       (e: KeyboardEvent) => e.ctrlKey && e.key === '3',
  layoutGrid:          (e: KeyboardEvent) => e.ctrlKey && e.key === '4',
  focusNext:           (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'j',
  focusPrev:           (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'k',
  swapMaster:          (e: KeyboardEvent) => e.ctrlKey && e.key === 'Enter',
  closePane:           (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'q',
  toggleGraph:         (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'g',
  toggleInspector:     (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'v',
  toggleTerminal:      (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 't',
  toggleGlobe:         (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'm',
  toggleTimeline:      (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'l',
  toggleCalendar:      (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'y',
  toggleSidePanel:     (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'b',
  toggleRightPanel:    (e: KeyboardEvent) => e.ctrlKey && e.key === '\\',
  cycleActivityFwd:    (e: KeyboardEvent) => e.ctrlKey && !e.shiftKey && e.key === 'Tab',
  cycleActivityBwd:    (e: KeyboardEvent) => e.ctrlKey && e.shiftKey && e.key === 'Tab',
  ingestData:          (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'i',
  createEntity:        (e: KeyboardEvent) => e.ctrlKey && e.key.toLowerCase() === 'n',
  runBenchmark:        (e: KeyboardEvent) => e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b',
  multiSelectModifier: (e: any) => e.shiftKey || e.ctrlKey,
  marqueeModifier:     (e: any) => e.shiftKey,
};

// Per-entity-category visual color (also drives label coloring on dropdowns).
// Indexed by string for ergonomic any-typed call sites.
export const KIND_COLORS: Record<string, string> = {
  physical: '#6de096',
  digital:  '#7eb0ff',
  abstract: '#f5d060',
  persona:  '#d680ff',
};

// Force-graph parameter presets keyed by layout mode. The user can switch live
// via the Graph side panel; the GraphPanel re-applies on every mode change.
export const GRAPH_PRESETS: Record<GraphLayoutMode, ForceGraphParams> = {
  default: {
    chargeStrength: -50,
    chargeDistanceMin: 8,
    chargeDistanceMax: 300,
    linkDistance: 40,
    alphaDecay: 0.02,
    velocityDecay: 0.3,
    cooldownTicks: 300,
    flowBias: 0.6,
    gravityStrength: 0.06,
  },
  // Many small dense subgraphs: stronger charge to push clusters apart, shorter
  // links so each cluster stays compact, slower cooldown so the layout settles.
  // Higher gravity tucks isolated subgraphs toward the centre so they pack
  // close to one another (hard collide keeps them from merging).
  clustered: {
    chargeStrength: -180,
    chargeDistanceMin: 6,
    chargeDistanceMax: 220,
    linkDistance: 22,
    alphaDecay: 0.012,
    velocityDecay: 0.45,
    cooldownTicks: 600,
    flowBias: 0.5,
    gravityStrength: 0.10,
  },
  // One big hairball: gentler charge with longer reach, longer links so the
  // hub spreads, faster cooldown so the user can interact sooner.
  hairball: {
    chargeStrength: -28,
    chargeDistanceMin: 12,
    chargeDistanceMax: 700,
    linkDistance: 90,
    alphaDecay: 0.025,
    velocityDecay: 0.22,
    cooldownTicks: 220,
    flowBias: 0.4,
    gravityStrength: 0.03,
  },
};

// Global UI font scale. Applied as `document.documentElement.style.fontSize`
// equal to BASE_FONT_SIZE_PX × scale, so every CSS `rem` and inherited font
// size scales uniformly. Bound by [TEXT_SCALE_MIN, TEXT_SCALE_MAX] in the
// stepper; values outside that range are clamped on load.
export const BASE_FONT_SIZE_PX = 14;
export const DEFAULT_TEXT_SCALE = 1.0;
export const TEXT_SCALE_MIN = 0.7;
export const TEXT_SCALE_MAX = 1.6;
export const TEXT_SCALE_STEP = 0.05;

// Performance thresholds.
export const GRAPH_PERF = {
  // Below this zoom (k), draw images as a small kind-color rect placeholder
  // instead of decoding/blitting the full bitmap.
  imageLodZoomThreshold: 0.45,
  // Auto-pause the simulation once alpha drops below this value (in addition
  // to the per-preset cooldownTicks). Setting alpha back to 1 (e.g. by
  // dragging a node) automatically resumes.
  autoPauseAlphaEpsilon: 0.005,
};

// Tag region visuals.
export const REGION_STYLE = {
  dilationRadius: 15,
  borderWidth:    1.0,
  borderAlpha:    0.85,
  hatchSpacing:   5,
  hatchAlpha:     0.5,
  hatchLineWidth: 0.5,
  roundness:      0.7,
  labelVOffset:   12,
  labelAlpha:     0.85,
  labelFont:      'bold 6px "JetBrains Mono", sans-serif',
};

// Side / right panel default sizing (px).
export const PANEL_SIZES = {
  sidePanelDefault:  280,
  sidePanelMin:      180,
  sidePanelMax:      640,
  rightPanelDefault: 320,
  rightPanelMin:     200,
  rightPanelMax:     720,
};

export const DEFAULT_THEME: Theme = 'tokyo-night';
export const DEFAULT_LOCALE: Locale = 'en';
export const DEFAULT_GRAPH_MODE: GraphLayoutMode = 'default';

// Persisted runtime overrides. The store reads this on startup and writes back
// whenever a setting changes via the Settings UI or any other mutation hook.
export const SETTINGS_STORAGE_KEY = 'humanist:settings';

export interface PersistedSettings {
  theme?: Theme;
  locale?: Locale;
  tilingModeEnabled?: boolean;
  graphLayoutMode?: GraphLayoutMode;
  graphShowNodeLabels?: boolean;
  graphShowEdgeLabels?: boolean;
  graphHiddenRelationshipLabels?: string[];
  graphHiddenLabelCategories?: EntityCategory[];
  graphSimulationPaused?: boolean;
  uiTextScale?: number;
}

export function loadPersistedSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function persistSettings(patch: PersistedSettings): void {
  try {
    const current = loadPersistedSettings();
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* best-effort */
  }
}
