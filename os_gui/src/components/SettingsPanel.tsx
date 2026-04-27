import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useOsStore } from '../store';
import { formatBytes } from './StoreStatePanel';
import { THEMES, LOCALES, KEYBINDS_REFERENCE, TEXT_SCALE_MIN, TEXT_SCALE_MAX, TEXT_SCALE_STEP, type Theme } from '../config';
import { ThemedSelect } from './ThemedSelect';

interface SettingsPanelProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

export function SettingsPanel({ theme, onThemeChange }: SettingsPanelProps) {
  const activeLocale        = useOsStore(s => s.activeLocale);
  const setActiveLocale     = useOsStore(s => s.setActiveLocale);
  const tilingModeEnabled   = useOsStore(s => s.tilingModeEnabled);
  const setTilingMode       = useOsStore(s => s.setTilingModeEnabled);
  const fetchAllEntities    = useOsStore(s => s.fetchAllEntities);
  const fetchStorageHealth  = useOsStore(s => s.fetchStorageHealth);
  const fetchBlobTraits     = useOsStore(s => s.fetchBlobTraits);
  const fetchKeyValueTraits = useOsStore(s => s.fetchKeyValueTraits);
  const fetchTableTraits    = useOsStore(s => s.fetchTableTraits);
  const fetchSpatialTraits  = useOsStore(s => s.fetchSpatialTraits);
  const fetchTemporalTraits = useOsStore(s => s.fetchTemporalTraits);
  const fetchAllLabelTraits = useOsStore(s => s.fetchAllLabelTraits);
  const uiTextScale         = useOsStore(s => s.uiTextScale);
  const setUiTextScale      = useOsStore(s => s.setUiTextScale);
  const gcRunning           = useOsStore(s => s.gcRunning);
  const lastGcResult        = useOsStore(s => s.lastGcResult);
  const runInputGc          = useOsStore(s => s.runInputGc);

  const [confirmDb,   setConfirmDb]   = useState(false);
  const [confirmBlob, setConfirmBlob] = useState(false);
  const [clearDbErr,  setClearDbErr]  = useState('');
  const [clearBlobErr, setClearBlobErr] = useState('');

  const doClearDatabase = async () => {
    setClearDbErr('');
    try {
      await invoke('clear_database');
      await Promise.all([fetchAllEntities(), fetchSpatialTraits(), fetchTemporalTraits(), fetchBlobTraits(), fetchKeyValueTraits(), fetchTableTraits(), fetchAllLabelTraits(), fetchStorageHealth()]);
    } catch (e: any) { setClearDbErr(String(e)); }
    setConfirmDb(false);
  };

  const doClearBlobStore = async () => {
    setClearBlobErr('');
    try {
      await invoke('clear_blob_store');
      await Promise.all([fetchBlobTraits(), fetchStorageHealth()]);
    } catch (e: any) { setClearBlobErr(String(e)); }
    setConfirmBlob(false);
  };

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
        <ThemedSelect
          value={theme}
          onChange={v => onThemeChange(v as Theme)}
          options={THEMES.map(t => ({ value: t.id, label: t.label }))}
          size="sm"
        />
      </div>

      <div style={section}>
        <span style={sectionLabel}>Language</span>
        <ThemedSelect
          value={activeLocale}
          onChange={setActiveLocale}
          options={LOCALES.map(l => ({ value: l.value, label: l.label }))}
          size="sm"
        />
      </div>

      <div style={section}>
        <span style={sectionLabel}>Zoom</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setUiTextScale(uiTextScale - TEXT_SCALE_STEP)}
            disabled={uiTextScale <= TEXT_SCALE_MIN + 1e-6}
            title="Decrease zoom"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', width: 28, height: 24, cursor: uiTextScale <= TEXT_SCALE_MIN + 1e-6 ? 'default' : 'pointer', fontSize: 13, opacity: uiTextScale <= TEXT_SCALE_MIN + 1e-6 ? 0.5 : 1 }}
          >−</button>
          <span style={{ minWidth: 48, textAlign: 'center', fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {Math.round(uiTextScale * 100)}%
          </span>
          <button
            onClick={() => setUiTextScale(uiTextScale + TEXT_SCALE_STEP)}
            disabled={uiTextScale >= TEXT_SCALE_MAX - 1e-6}
            title="Increase zoom"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)', width: 28, height: 24, cursor: uiTextScale >= TEXT_SCALE_MAX - 1e-6 ? 'default' : 'pointer', fontSize: 13, opacity: uiTextScale >= TEXT_SCALE_MAX - 1e-6 ? 0.5 : 1 }}
          >+</button>
          <button
            onClick={() => setUiTextScale(1.0)}
            title="Reset to 100%"
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-hint)', padding: '0 8px', height: 24, cursor: 'pointer', fontSize: 11, marginLeft: 4 }}
          >Reset</button>
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-hint)', marginTop: 4, lineHeight: 1.4 }}>
          Scales every UI element. Restart not required.
        </p>
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

      <div style={section}>
        <span style={sectionLabel}>Data Management</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Clear Database */}
          <div>
            {!confirmDb ? (
              <button onClick={() => { setConfirmDb(true); setClearDbErr(''); }}
                style={{ background: 'none', border: '1px solid #ff6b6b', borderRadius: 5, padding: '4px 12px', cursor: 'pointer', color: '#ff6b6b', fontSize: 11, fontWeight: 700 }}>
                Clear Database
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#ff6b6b' }}>Wipe all entities, traits, edges, and history?</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={doClearDatabase}
                    style={{ background: '#ff6b6b', border: 'none', borderRadius: 5, padding: '4px 12px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Yes, wipe</button>
                  <button onClick={() => setConfirmDb(false)}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>Cancel</button>
                </div>
              </div>
            )}
            {clearDbErr && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '4px 0 0' }}>{clearDbErr}</p>}
          </div>

          {/* Clear Blob Store */}
          <div>
            {!confirmBlob ? (
              <button onClick={() => { setConfirmBlob(true); setClearBlobErr(''); }}
                style={{ background: 'none', border: '1px solid #ff6b6b', borderRadius: 5, padding: '4px 12px', cursor: 'pointer', color: '#ff6b6b', fontSize: 11, fontWeight: 700 }}>
                Clear Blob Store
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#ff6b6b' }}>Remove all blob files and blob trait records?</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={doClearBlobStore}
                    style={{ background: '#ff6b6b', border: 'none', borderRadius: 5, padding: '4px 12px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 700 }}>Yes, wipe</button>
                  <button onClick={() => setConfirmBlob(false)}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', color: 'var(--text-hint)', fontSize: 11 }}>Cancel</button>
                </div>
              </div>
            )}
            {clearBlobErr && <p style={{ fontSize: 11, color: '#ff6b6b', margin: '4px 0 0' }}>{clearBlobErr}</p>}
          </div>

        </div>
      </div>

      <div style={section}>
        <span style={sectionLabel}>Maintenance</span>
        <p style={{ fontSize: 11, color: 'var(--text-hint)', lineHeight: 1.5, margin: '0 0 8px' }}>
          {lastGcResult
            ? `Last GC swept ${lastGcResult.swept_entities} entities, removed ${lastGcResult.removed_blobs} blobs, and reclaimed ${formatBytes(lastGcResult.reclaimed_bytes)}.`
            : 'Manual GC sweeps expired soft-deleted entities and unreferenced blobs.'}
        </p>
        <button
          onClick={() => runInputGc()}
          disabled={gcRunning}
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            borderRadius: 5,
            padding: '4px 12px',
            cursor: gcRunning ? 'wait' : 'pointer',
            fontSize: 11,
            fontWeight: 700,
            opacity: gcRunning ? 0.7 : 1,
          }}
        >
          {gcRunning ? 'Running GC…' : 'Run GC'}
        </button>
      </div>

    </div>
  );
}
