import { useMemo } from 'react';
import { Database, Plus, SquareTerminal, Variable, X } from 'lucide-react';
import { useOsStore } from '../store';
import type { TerminalSessionKind } from '../models';

const KIND_META: Record<TerminalSessionKind, { label: string; accent: string }> = {
  shell: { label: 'Shell', accent: '#7eb0ff' },
  sql: { label: 'SQL', accent: '#f5d060' },
  prolog: { label: 'Prolog', accent: '#d680ff' },
};

function SessionButton({
  kind,
  onClick,
}: {
  kind: TerminalSessionKind;
  onClick: () => void;
}) {
  const meta = KIND_META[kind];
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      <Plus size={12} style={{ color: meta.accent }} />
      {meta.label}
    </button>
  );
}

export function TerminalSidePanel() {
  const terminalSessions = useOsStore(s => s.terminalSessions);
  const activeTerminalSessionId = useOsStore(s => s.activeTerminalSessionId);
  const createTerminalSession = useOsStore(s => s.createTerminalSession);
  const activateTerminalSession = useOsStore(s => s.activateTerminalSession);
  const closeTerminalSession = useOsStore(s => s.closeTerminalSession);

  const sessions = useMemo(
    () => terminalSessions.filter(session => session.visible),
    [terminalSessions],
  );

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.title.localeCompare(b.title)),
    [sessions],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          New Session
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
          <SessionButton kind="shell" onClick={() => void createTerminalSession('shell')} />
          <SessionButton kind="sql" onClick={() => void createTerminalSession('sql')} />
          <SessionButton kind="prolog" onClick={() => void createTerminalSession('prolog')} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Sessions
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>
            {orderedSessions.length} live session{orderedSessions.length === 1 ? '' : 's'}
          </div>
        </div>

        {orderedSessions.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-hint)' }}>
            No active sessions.
          </div>
        ) : orderedSessions.map(session => {
          const meta = KIND_META[session.kind];
          const active = session.id === activeTerminalSessionId;
          return (
            <div
              key={session.id}
              onClick={() => activateTerminalSession(session.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderBottom: '1px solid var(--border)',
                background: active ? 'rgba(91,138,240,0.08)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {session.kind === 'shell'
                ? <SquareTerminal size={14} style={{ color: meta.accent, flexShrink: 0 }} />
                : session.kind === 'sql'
                  ? <Database size={14} style={{ color: meta.accent, flexShrink: 0 }} />
                  : <Variable size={14} style={{ color: meta.accent, flexShrink: 0 }} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {session.title}
                </div>
                <div style={{ fontSize: 10, color: meta.accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {session.kind}
                </div>
              </div>
              <button
                onClick={event => {
                  event.stopPropagation();
                  void closeTerminalSession(session.id);
                }}
                title={`Close ${session.title}`}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-hint)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
