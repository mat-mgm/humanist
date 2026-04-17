import { useOsStore } from '../store';
import { SearchableDropdown } from './SearchableDropdown';

type Theme = 'catppuccin-mocha' | 'catppuccin-latte' | 'dracula' | 'tokyo-night'
  | 'solarized-dark' | 'solarized-light' | 'nord' | 'gruvbox-dark' | 'github-light';

const THEMES: { id: Theme; label: string }[] = [
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

const LOCALES = [
  { value: 'en', label: 'en — English' },
  { value: 'de', label: 'de — Deutsch' },
  { value: 'fr', label: 'fr — Français' },
  { value: 'pt', label: 'pt — Português' },
  { value: 'es', label: 'es — Español' },
  { value: 'zh', label: 'zh — 中文' },
  { value: 'ar', label: 'ar — العربية' },
];

const KEYBINDS_REFERENCE = [
  { key: 'Ctrl+G', action: 'Graph canvas' },
  { key: 'Ctrl+M', action: 'Globe canvas' },
  { key: 'Ctrl+L', action: 'Timeline canvas' },
  { key: 'Ctrl+Y', action: 'Calendar canvas' },
  { key: 'Ctrl+T', action: 'Terminal' },
  { key: 'Ctrl+B', action: 'Toggle side panel' },
  { key: 'Ctrl+\\', action: 'Toggle right panel' },
  { key: 'Ctrl+Tab', action: 'Cycle activities' },
  { key: 'Ctrl+N', action: 'New entity' },
  { key: 'Ctrl+I', action: 'Ingest data' },
  { key: 'Delete', action: 'Delete selected nodes' },
];

interface SettingsPanelProps {
  themeSearch: string;
  onThemeChange: (t: Theme) => void;
  onThemeSearchChange: (s: string) => void;
}

export function SettingsPanel({ themeSearch, onThemeChange, onThemeSearchChange }: SettingsPanelProps) {
  const activeLocale      = useOsStore(s => s.activeLocale);
  const setActiveLocale   = useOsStore(s => s.setActiveLocale);
  const tilingModeEnabled = useOsStore(s => s.tilingModeEnabled);
  const setTilingMode     = useOsStore(s => s.setTilingModeEnabled);

  const section: React.CSSProperties = {
    borderBottom: '1px solid var(--border)',
    padding: '10px 12px',
  };
  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: 'var(--text-hint)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    marginBottom: 8, display: 'block',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      <div style={section}>
        <span style={sectionLabel}>Theme</span>
        <SearchableDropdown
          value={themeSearch}
          onChange={onThemeSearchChange}
          onSelect={opt => { onThemeChange(opt.id as Theme); onThemeSearchChange(opt.label); }}
          options={THEMES.map(t => ({ id: t.id, label: t.label }))}
          placeholder="Search themes…"
          style={{ width: '100%' }}
        />
      </div>

      <div style={section}>
        <span style={sectionLabel}>Language</span>
        <select
          value={activeLocale}
          onChange={e => setActiveLocale(e.target.value)}
          style={{
            width: '100%', background: 'var(--bg-secondary)',
            border: '1px solid var(--border)', borderRadius: 4,
            padding: '4px 8px', fontSize: 11, color: 'var(--text-primary)',
            outline: 'none', cursor: 'pointer',
          }}
        >
          {LOCALES.map(l => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>

      <div style={section}>
        <span style={sectionLabel}>Layout</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={tilingModeEnabled}
            onChange={e => setTilingMode(e.target.checked)}
          />
          Tiling Mode (DWM)
        </label>
        <p style={{ fontSize: 10, color: 'var(--text-hint)', marginTop: 4, lineHeight: 1.4 }}>
          Restores the classic multi-panel tiling window manager.
        </p>
      </div>

      <div style={section}>
        <span style={sectionLabel}>Keyboard Shortcuts</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {KEYBINDS_REFERENCE.map(({ key, action }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--text-hint)' }}>{action}</span>
              <kbd style={{
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: 3, padding: '1px 5px', fontSize: 10,
                color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
              }}>{key}</kbd>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
