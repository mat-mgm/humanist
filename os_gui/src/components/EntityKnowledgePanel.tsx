import { useState } from 'react';
import { EntityRegistry } from './EntityRegistry';
import { OntologyPanel } from './OntologyPanel';

type Tab = 'entities' | 'relationships';

export function EntityKnowledgePanel() {
  const [tab, setTab] = useState<Tab>('entities');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Tab bar — same style as CausalPanel's timeline/calendar switcher */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2,
        height: 28, flexShrink: 0,
        background: 'var(--bg-panel-header)',
        borderBottom: '1px solid var(--border)',
        padding: '0 8px',
      }}>
        {(['entities', 'relationships'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              padding: '2px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: tab === t ? 'var(--accent)' : 'transparent',
              color: tab === t ? '#fff' : 'var(--text-hint)',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {t === 'entities' ? 'Entities' : 'Relationships'}
          </button>
        ))}
      </div>

      {/* Scrollable panel body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {tab === 'entities' ? <EntityRegistry /> : <OntologyPanel />}
      </div>

    </div>
  );
}
