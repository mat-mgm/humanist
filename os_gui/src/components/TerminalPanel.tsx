import { memo, useEffect, useRef, useState } from 'react';
import { TerminalSquare } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { terminalSessionCommand, TERMINAL_CLEAR_MARKER, useOsStore } from '../store';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  onClose?: () => void;
}

type CompletionState = {
  sessionId: string;
  baseInput: string;
  fragment: string;
  candidates: string[];
  index: number;
  applied: string;
};

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const SQL_COMPLETIONS = [
  'SELECT ',
  'FROM ',
  'WHERE ',
  'LIMIT ',
  'ORDER BY ',
  'GROUP BY ',
  'CREATE ',
  'UPDATE ',
  'DELETE ',
  'RELATE ',
  'entity',
  'edge',
  'blob_trait',
  'spatial_trait',
  'temporal_trait',
  'label_trait',
  'relationship_type',
  'entity_history',
  'trait_history',
  'category',
  'label',
  'lang_canonical',
  'deleted_at',
  'metadata',
  'owner',
  'filename',
  'mime',
  'storage_id',
  'hash',
  'size',
  'lat',
  'lng',
  'alt',
  'heading',
  'bbox',
  'projection',
  'event_at',
  'starts_at',
  'ends_at',
  'recurrence',
  'strength',
  'latency',
  'text',
  'lang',
  'transitive',
  'symmetric',
  'inherits_traits',
  '.clear',
  '.exit',
] as const;

const PROLOG_COMPLETIONS = [
  'entity(',
  'edge(',
  'tagged_as(',
  'reachable(',
  'halt.',
  'clear.',
] as const;

function extractCompletionFragment(input: string): string | null {
  const match = input.match(/([A-Za-z_.][A-Za-z0-9_.:]*)$/);
  return match ? match[1] : null;
}

function completionPool(kind: 'shell' | 'sql' | 'prolog'): readonly string[] {
  switch (kind) {
    case 'sql':
      return SQL_COMPLETIONS;
    case 'prolog':
      return PROLOG_COMPLETIONS;
    case 'shell':
    default:
      return [];
  }
}

function matchingCompletions(kind: 'shell' | 'sql' | 'prolog', fragment: string): string[] {
  const lowered = fragment.toLowerCase();
  return [...new Set(completionPool(kind).filter(candidate => candidate.toLowerCase().startsWith(lowered)))];
}

function nextCompletion(
  sessionId: string,
  input: string,
  kind: 'shell' | 'sql' | 'prolog',
  previous: CompletionState | null,
): { removeCount: number; insertText: string; nextState: CompletionState } | null {
  if (previous && previous.sessionId === sessionId) {
    const completedInput = `${previous.baseInput.slice(0, previous.baseInput.length - previous.fragment.length)}${previous.applied}`;
    if (input === completedInput && previous.candidates.length > 0) {
      const index = (previous.index + 1) % previous.candidates.length;
      const applied = previous.candidates[index];
      return {
        removeCount: previous.applied.length,
        insertText: applied,
        nextState: { ...previous, index, applied },
      };
    }
  }

  const fragment = extractCompletionFragment(input);
  if (!fragment) return null;

  const candidates = matchingCompletions(kind, fragment);
  if (candidates.length === 0) return null;
  if (candidates.length === 1 && candidates[0] === fragment) return null;

  const applied = candidates[0];
  return {
    removeCount: fragment.length,
    insertText: applied,
    nextState: {
      sessionId,
      baseInput: input,
      fragment,
      candidates,
      index: 0,
      applied,
    },
  };
}

function trackTypedInput(
  buffer: Record<string, string>,
  completion: { current: CompletionState | null },
  sessionId: string,
  kind: 'shell' | 'sql' | 'prolog',
  data: string,
) {
  if (kind === 'shell') return;

  if (data.startsWith('\u001b')) {
    buffer[sessionId] = '';
    completion.current = null;
    return;
  }

  let next = buffer[sessionId] ?? '';
  for (const ch of data) {
    if (ch === '\r' || ch === '\n' || ch === '\u0003' || ch === '\u0015') {
      next = '';
      completion.current = null;
      continue;
    }
    if (ch === '\u007f') {
      next = next.slice(0, -1);
      completion.current = null;
      continue;
    }
    if (ch === '\u001b' || ch === '\t') {
      completion.current = null;
      continue;
    }
    if (ch >= ' ') {
      next += ch;
      completion.current = null;
    }
  }
  buffer[sessionId] = next;
}

function renderCommandInput(term: Terminal, prompt: string, input: string, cursor: number) {
  term.write('\r');
  term.write(`${prompt}${input}\x1b[K`);
  const moveLeft = input.length - cursor;
  if (moveLeft > 0) {
    term.write(`\x1b[${moveLeft}D`);
  }
}

function applyPastedText(
  term: Terminal,
  sessionId: string,
  text: string,
  inputBuffer: Record<string, string>,
) {
  if (!text) return;

  const state = useOsStore.getState();
  const session = state.terminalSessions.find(existing => existing.id === sessionId);
  if (!session) return;

  if (session.kind !== 'shell') {
    const nextInput = `${session.currentInput.slice(0, session.cursor)}${text}${session.currentInput.slice(session.cursor)}`;
    const nextCursor = session.cursor + text.length;
    inputBuffer[sessionId] = nextInput;
    state.updateTerminalSession(sessionId, {
      currentInput: nextInput,
      cursor: nextCursor,
      historyIndex: null,
    });
    renderCommandInput(term, session.prompt, nextInput, nextCursor);
    return;
  }

  trackTypedInput(inputBuffer, { current: null }, sessionId, session.kind, text);
  void invoke('write_to_terminal', {
    sessionId,
    input: Array.from(textEncoder.encode(text)),
  });
}

export const TerminalPanel = memo(function TerminalPanel({ onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputStateRef = useRef<Record<string, string>>({});
  const historyDraftRef = useRef<Record<string, string>>({});
  const completionStateRef = useRef<CompletionState | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    let disposed = false;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let onDataDisposable: { dispose: () => void } | null = null;
    let onResizeDisposable: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    let handlePaste: ((event: ClipboardEvent) => void) | null = null;

    try {
      const term = new Terminal({
        allowTransparency: false,
        theme: {
          background: '#13131d',
          foreground: '#e4e6f0',
          cursor: '#5b8af0',
        },
        fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
        fontSize: 14,
        cursorBlink: true,
        scrollback: 1000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      void useOsStore.getState().ensureTerminalWorkbench().then(async () => {
        const activeSessionId = useOsStore.getState().activePtySession;
        if (!activeSessionId) return;
        const activeSession = useOsStore.getState().terminalSessions.find(session => session.id === activeSessionId);
        await invoke('spawn_terminal', {
          sessionId: activeSessionId,
          command: activeSession ? terminalSessionCommand(activeSession.kind) : undefined,
        });
      });

      void listen<[string, number[]]>('pty-data', (event) => {
        const [sid, data] = event.payload;
        let chunk = textDecoder.decode(new Uint8Array(data));
        const shouldClear = chunk.includes(TERMINAL_CLEAR_MARKER);
        if (shouldClear) {
          chunk = chunk.split(TERMINAL_CLEAR_MARKER).join('');
          inputStateRef.current[sid] = '';
          historyDraftRef.current[sid] = '';
          completionStateRef.current = completionStateRef.current?.sessionId === sid ? null : completionStateRef.current;
          useOsStore.getState().replaceTerminalSessionTranscript(sid, '');
          useOsStore.getState().updateTerminalSession(sid, {
            currentInput: '',
            cursor: 0,
            historyIndex: null,
          });
          if (sid === useOsStore.getState().activePtySession) {
            term.reset();
          }
        }
        if (chunk.length === 0) {
          return;
        }
        const state = useOsStore.getState();
        state.appendTerminalSessionTranscript(sid, chunk);
        if (sid === state.activePtySession) {
          term.write(chunk);
          const activeSession = state.terminalSessions.find(session => session.id === sid);
          if (activeSession && activeSession.kind !== 'shell') {
            renderCommandInput(term, activeSession.prompt, activeSession.currentInput, activeSession.cursor);
          }
        }
      }).then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlistenData = cleanup;
      });

      void listen<string>('pty-process-exit', (event) => {
        const sid = event.payload;
        const state = useOsStore.getState();
        const visibleSession = state.terminalSessions.find(session => session.id === sid && session.visible);

        delete inputStateRef.current[sid];
        delete historyDraftRef.current[sid];
        if (completionStateRef.current?.sessionId === sid) {
          completionStateRef.current = null;
        }

        if (visibleSession) {
          void state.closeTerminalSession(sid);
          return;
        }

        if (sid === state.activePtySession) {
          state.setActivePtySession(state.activeTerminalSessionId);
        }
      }).then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlistenExit = cleanup;
      });

      void listen<string>('term-edit-error', (event) => {
        term.writeln(`\r\n\x1b[1;31m[Save Error] ${event.payload}\x1b[0m`);
      }).then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlistenError = cleanup;
      });

      onDataDisposable = term.onData((data) => {
        const state = useOsStore.getState();
        const activeSessionId = state.activePtySession;
        if (!activeSessionId) return;
        const activeSession = state.terminalSessions.find(session => session.id === activeSessionId);
        if (activeSession?.kind !== 'shell') {
          return;
        }
        if (activeSession && activeSession.kind !== 'shell' && data === '\r') {
          const input = inputStateRef.current[activeSessionId] ?? '';
          const trimmed = input.trim();
          const nextHistory = trimmed.length === 0
            ? activeSession.history
            : activeSession.history[activeSession.history.length - 1] === input
              ? activeSession.history
              : [...activeSession.history, input];
          state.updateTerminalSession(activeSessionId, {
            currentInput: '',
            history: nextHistory,
            historyIndex: null,
          });
        }
        trackTypedInput(inputStateRef.current, completionStateRef, activeSessionId, activeSession?.kind ?? 'shell', data);
        if (activeSession?.kind !== 'shell' && data !== '\r') {
          state.updateTerminalSession(activeSessionId, {
            currentInput: inputStateRef.current[activeSessionId] ?? '',
            historyIndex: null,
          });
        }
        void invoke('write_to_terminal', {
          sessionId: activeSessionId,
          input: Array.from(textEncoder.encode(data)),
        });
      });

      onResizeDisposable = term.onResize(({ rows, cols }) => {
        const activeSessionId = useOsStore.getState().activePtySession;
        if (!activeSessionId) return;
        void invoke('resize_terminal', {
          sessionId: activeSessionId,
          rows,
          cols,
        });
      });

      const updateTheme = () => {
        const styles = getComputedStyle(document.documentElement);
        const bg = styles.getPropertyValue('--terminal-bg').trim() || '#13131d';
        const fg = styles.getPropertyValue('--text-primary').trim() || '#e4e6f0';
        const cursor = styles.getPropertyValue('--accent').trim() || '#5b8af0';
        term.options.theme = {
          background: bg,
          foreground: fg,
          cursor,
        };
      };

      updateTheme();
      themeObserver = new MutationObserver(updateTheme);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore fit races during panel transitions
        }
      });
      resizeObserver.observe(containerRef.current);

      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;

        if (event.key === 'Escape' && onClose) {
          onClose();
          return false;
        }

        const state = useOsStore.getState();
        const activeSessionId = state.activePtySession;
        const activeSession = activeSessionId
          ? state.terminalSessions.find(session => session.id === activeSessionId)
          : null;

        if (activeSessionId && activeSession && activeSession.kind !== 'shell') {
          const input = activeSession.currentInput;
          const cursor = activeSession.cursor;
          const updateCommandSession = (
            nextInput: string,
            nextCursor: number,
            historyIndex: number | null = activeSession.historyIndex,
          ) => {
            inputStateRef.current[activeSessionId] = nextInput;
            state.updateTerminalSession(activeSessionId, {
              currentInput: nextInput,
              cursor: nextCursor,
              historyIndex,
            });
            renderCommandInput(term, activeSession.prompt, nextInput, nextCursor);
          };

          if (event.key === 'c' && event.ctrlKey && !event.metaKey && !event.altKey) {
            completionStateRef.current = null;
            const interruptedInput = input;
            inputStateRef.current[activeSessionId] = '';
            historyDraftRef.current[activeSessionId] = '';
            state.appendTerminalSessionTranscript(activeSessionId, `${activeSession.prompt}${interruptedInput}^C\r\n`);
            state.updateTerminalSession(activeSessionId, {
              currentInput: '',
              cursor: 0,
              historyIndex: null,
            });
            term.write('^C\r\n');
            renderCommandInput(term, activeSession.prompt, '', 0);
            return false;
          }

          if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === 'ArrowLeft') {
              updateCommandSession(input, Math.max(0, cursor - 1));
              return false;
            }
            if (event.key === 'ArrowRight') {
              updateCommandSession(input, Math.min(input.length, cursor + 1));
              return false;
            }
            if (event.key === 'Home') {
              updateCommandSession(input, 0);
              return false;
            }
            if (event.key === 'End') {
              updateCommandSession(input, input.length);
              return false;
            }
            if (event.key === 'Backspace') {
              if (cursor === 0) {
                return false;
              }
              const nextInput = `${input.slice(0, cursor - 1)}${input.slice(cursor)}`;
              completionStateRef.current = null;
              updateCommandSession(nextInput, cursor - 1, null);
              return false;
            }
            if (event.key === 'Delete') {
              if (cursor >= input.length) {
                return false;
              }
              const nextInput = `${input.slice(0, cursor)}${input.slice(cursor + 1)}`;
              completionStateRef.current = null;
              updateCommandSession(nextInput, cursor, null);
              return false;
            }
            if (event.key === 'ArrowUp') {
              if (activeSession.history.length === 0) {
                return false;
              }
              const nextIndex = activeSession.historyIndex === null
                ? activeSession.history.length - 1
                : Math.max(0, activeSession.historyIndex - 1);
              if (activeSession.historyIndex === null) {
                historyDraftRef.current[activeSessionId] = input;
              }
              const nextInput = activeSession.history[nextIndex] ?? '';
              completionStateRef.current = null;
              updateCommandSession(nextInput, nextInput.length, nextIndex);
              return false;
            }
            if (event.key === 'ArrowDown') {
              if (activeSession.historyIndex === null) {
                return false;
              }
              const nextIndex = activeSession.historyIndex + 1;
              if (nextIndex >= activeSession.history.length) {
                const draft = historyDraftRef.current[activeSessionId] ?? '';
                completionStateRef.current = null;
                updateCommandSession(draft, draft.length, null);
                return false;
              }
              const nextInput = activeSession.history[nextIndex] ?? '';
              completionStateRef.current = null;
              updateCommandSession(nextInput, nextInput.length, nextIndex);
              return false;
            }
            if (event.key === 'Enter') {
              const trimmed = input.trim();
              const nextHistory = trimmed.length === 0
                ? activeSession.history
                : activeSession.history[activeSession.history.length - 1] === input
                  ? activeSession.history
                  : [...activeSession.history, input];
              completionStateRef.current = null;
              historyDraftRef.current[activeSessionId] = '';
              state.appendTerminalSessionTranscript(activeSessionId, `${activeSession.prompt}${input}\r\n`);
              state.syncTerminalHistoryForKind(activeSession.kind, nextHistory);
              state.updateTerminalSession(activeSessionId, {
                currentInput: '',
                cursor: 0,
                historyIndex: null,
              });
              inputStateRef.current[activeSessionId] = '';
              term.write('\r\n');
              void invoke('write_to_terminal', {
                sessionId: activeSessionId,
                input: Array.from(textEncoder.encode(`${input}\n`)),
              });
              return false;
            }
            if (event.key.length === 1) {
              const nextInput = `${input.slice(0, cursor)}${event.key}${input.slice(cursor)}`;
              completionStateRef.current = null;
              updateCommandSession(nextInput, cursor + event.key.length, null);
              return false;
            }
          }
        }

        if (event.key === 'Tab' && activeSessionId && activeSession && activeSession.kind !== 'shell') {
          const input = activeSession.currentInput;
          const completion = nextCompletion(
            activeSessionId,
            input,
            activeSession.kind,
            completionStateRef.current,
          );
          if (!completion) {
            term.write('\x07');
            return false;
          }

          completionStateRef.current = completion.nextState;
          const nextInput = `${input.slice(0, input.length - completion.removeCount)}${completion.insertText}`;
          state.updateTerminalSession(activeSessionId, {
            currentInput: nextInput,
            cursor: nextInput.length,
            historyIndex: null,
          });
          inputStateRef.current[activeSessionId] = nextInput;
          renderCommandInput(term, activeSession.prompt, nextInput, nextInput.length);
          return false;
        }

        const isModifier = event.ctrlKey || event.metaKey;
        if (!isModifier || !event.shiftKey) {
          return true;
        }

        const key = event.key.toLowerCase();

        if ((key === 'p' || key === 'c') && term.hasSelection()) {
          const selection = term.getSelection();
          navigator.clipboard.writeText(selection).catch(() => {
            document.execCommand('copy');
          });
          term.clearSelection();
          return false;
        }

        if (key === 'v') {
          navigator.clipboard.readText().then((text) => {
            const currentState = useOsStore.getState();
            const currentSessionId = currentState.activePtySession;
            if (!currentSessionId) return;
            applyPastedText(term, currentSessionId, text, inputStateRef.current);
          });
          return false;
        }

        return true;
      });

      handlePaste = (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (!text) return;
        const currentSessionId = useOsStore.getState().activePtySession;
        if (!currentSessionId) return;
        event.preventDefault();
        applyPastedText(term, currentSessionId, text, inputStateRef.current);
      };
      containerRef.current.addEventListener('paste', handlePaste);

      termRef.current = term;
      fitAddonRef.current = fitAddon;
    } catch (error) {
      setMountError(String(error));
    }

    return () => {
      disposed = true;
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      if (unlistenError) unlistenError();
      if (onDataDisposable) onDataDisposable.dispose();
      if (onResizeDisposable) onResizeDisposable.dispose();
      if (resizeObserver) resizeObserver.disconnect();
      if (themeObserver) themeObserver.disconnect();
      if (handlePaste) {
        containerRef.current?.removeEventListener('paste', handlePaste);
      }
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [onClose]);

  const activePtySession = useOsStore(s => s.activePtySession);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    term.options.disableStdin = !activePtySession;
    term.options.cursorBlink = Boolean(activePtySession);

    if (!activePtySession) {
      completionStateRef.current = null;
      term.reset();
      term.blur();
      return;
    }

    term.reset();
    const activeSession = useOsStore.getState().terminalSessions.find(session => session.id === activePtySession);
    inputStateRef.current[activePtySession] = activeSession?.currentInput ?? '';
    if (activeSession?.transcript) {
      term.write(activeSession.transcript);
    }
    if (activeSession && activeSession.kind !== 'shell') {
      renderCommandInput(term, activeSession.prompt, activeSession.currentInput, activeSession.cursor);
    }

    void invoke('spawn_terminal', {
      sessionId: activePtySession,
      command: activeSession ? terminalSessionCommand(activeSession.kind) : undefined,
    }).then(() => {
      void invoke('resize_terminal', {
        sessionId: activePtySession,
        rows: term.rows,
        cols: term.cols,
      });
    });
  }, [activePtySession]);

  if (mountError) {
    return (
      <div className="panel terminal-panel" style={{ background: 'var(--terminal-bg)' }}>
        <div
          className="panel-body"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: 24,
            color: 'var(--text-primary)',
          }}
        >
          <TerminalSquare size={36} style={{ color: 'var(--error)' }} />
          <div style={{ fontSize: 14, fontWeight: 700 }}>Terminal Mount Failed</div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)', textAlign: 'center', maxWidth: 420 }}>
            {mountError}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`panel terminal-panel${activePtySession ? '' : ' is-empty'}`}
      style={{ background: activePtySession ? 'var(--terminal-bg)' : 'var(--bg-secondary)' }}
    >
      <div className="panel-body" style={{ padding: 0, position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} />
        {!activePtySession && <div className="terminal-empty-canvas" />}
      </div>
    </div>
  );
});
