import { useOsStore } from '../store';
import { GraphSidePanel } from './GraphSidePanel';
import { SettingsPanel } from './SettingsPanel';
import { EntityInspectorPanel } from './EntityInspector';
import { EntityKnowledgePanel } from './EntityKnowledgePanel';
import { AssetPreview } from './AssetPreview';
import { ErrorBoundary } from './ErrorBoundary';
import { InputsSidePanel } from './InputsSidePanel';

type Theme = 'catppuccin-mocha' | 'catppuccin-latte' | 'dracula' | 'tokyo-night'
  | 'solarized-dark' | 'solarized-light' | 'nord' | 'gruvbox-dark' | 'github-light';

interface SidePanelProps {
  themeSearch: string;
  onThemeChange: (t: Theme) => void;
  onThemeSearchChange: (s: string) => void;
  width?: number;
}

const PANEL_TITLES: Record<string, string> = {
  inputs:    'Inputs',
  graph:     'Knowledge Graph',
  causal:    'Causal Panel',
  terminal:  'Terminal',
  inspector: 'Properties',
  registry:  'Entities & Relations',
  preview:   'Preview',
  settings:  'Settings',
};

function SidePanelContent({ activity, themeSearch, onThemeChange, onThemeSearchChange }: {
  activity: string;
  themeSearch: string;
  onThemeChange: (t: Theme) => void;
  onThemeSearchChange: (s: string) => void;
}) {
  switch (activity) {
    case 'inputs':    return <InputsSidePanel />;
    case 'graph':     return <GraphSidePanel />;
    case 'causal':    return (
      <div style={{ padding: 12, fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>
        Use the tab bar inside the Causal Panel to switch between Timeline and Calendar.
      </div>
    );
    case 'inspector': return <ErrorBoundary label="Properties"><EntityInspectorPanel /></ErrorBoundary>;
    case 'registry':  return <ErrorBoundary label="Entities & Relations"><EntityKnowledgePanel /></ErrorBoundary>;
    case 'preview':   return <ErrorBoundary label="Preview"><AssetPreview /></ErrorBoundary>;
    case 'settings':  return (
      <SettingsPanel
        themeSearch={themeSearch}
        onThemeChange={onThemeChange} onThemeSearchChange={onThemeSearchChange}
      />
    );
    default: return null;
  }
}

export function SidePanel({ themeSearch, onThemeChange, onThemeSearchChange, width }: SidePanelProps) {
  const activeActivity = useOsStore(s => s.activeActivity);
  const sidePanelOpen  = useOsStore(s => s.sidePanelOpen);

  if (!sidePanelOpen) return null;

  return (
    <div className="side-panel" style={width !== undefined ? { width } : undefined}>
      <div className="side-panel-header">
        <span className="side-panel-title">{PANEL_TITLES[activeActivity] ?? activeActivity}</span>
      </div>
      <div className="side-panel-body">
        <SidePanelContent
          activity={activeActivity}
          themeSearch={themeSearch}
          onThemeChange={onThemeChange} onThemeSearchChange={onThemeSearchChange}
        />
      </div>
    </div>
  );
}
