import { useOsStore } from '../store';
import { GraphSidePanel } from './GraphSidePanel';
import { SettingsPanel } from './SettingsPanel';
import { EntityInspectorPanel } from './EntityInspector';
import { EntityKnowledgePanel } from './EntityKnowledgePanel';
import { AssetPreview } from './AssetPreview';
import { ErrorBoundary } from './ErrorBoundary';
import { InputsSidePanel } from './InputsSidePanel';
import { OutputsSidePanel } from './OutputsSidePanel';
import { TerminalSidePanel } from './TerminalSidePanel';
import { EditionSidePanel } from './EditionSidePanel';

type Theme = 'catppuccin-mocha' | 'catppuccin-latte' | 'dracula' | 'tokyo-night'
  | 'solarized-dark' | 'solarized-light' | 'nord' | 'gruvbox-dark' | 'github-light';

interface SidePanelProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  width?: number;
}

const PANEL_TITLES: Record<string, string> = {
  inputs:    'Inputs',
  outputs:   'Outputs',
  edition:   'Edition',
  graph:     'Knowledge Graph',
  causal:    'Causal Panel',
  terminal:  'Terminal',
  inspector: 'Properties',
  registry:  'Entities & Relations',
  preview:   'Preview',
  settings:  'Settings',
};

function SidePanelContent({ activity, theme, onThemeChange }: {
  activity: string;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}) {
  switch (activity) {
    case 'inputs':    return <InputsSidePanel />;
    case 'outputs':   return <ErrorBoundary label="Outputs"><OutputsSidePanel /></ErrorBoundary>;
    case 'edition':   return <EditionSidePanel />;
    case 'graph':     return <GraphSidePanel />;
    case 'causal':    return (
      <div style={{ padding: 12, fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5 }}>
        Use the tab bar inside the Causal Panel to switch between Timeline and Calendar.
      </div>
    );
    case 'terminal':  return <ErrorBoundary label="Terminal Side Panel"><TerminalSidePanel /></ErrorBoundary>;
    case 'inspector': return <ErrorBoundary label="Properties"><EntityInspectorPanel /></ErrorBoundary>;
    case 'registry':  return <ErrorBoundary label="Entities & Relations"><EntityKnowledgePanel /></ErrorBoundary>;
    case 'preview':   return <ErrorBoundary label="Preview"><AssetPreview /></ErrorBoundary>;
    case 'settings':  return (
      <SettingsPanel theme={theme} onThemeChange={onThemeChange} />
    );
    default: return null;
  }
}

export function SidePanel({ theme, onThemeChange, width }: SidePanelProps) {
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
          theme={theme}
          onThemeChange={onThemeChange}
        />
      </div>
    </div>
  );
}
