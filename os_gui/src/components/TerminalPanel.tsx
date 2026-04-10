import { memo, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useOsStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  onClose?: () => void;
}

export const TerminalPanel = memo(function TerminalPanel({ onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    // Default theme colors matching App.css
    const term = new Terminal({
      allowTransparency: true,
      theme: {
        background: '#00000000',
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

    termRef.current = term;

    // ── PTY Integration ──────────────────────────────────────────────────────
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupPty = async () => {
      try {
        // Ensure main terminal is always spawned
        await invoke('spawn_terminal', { sessionId: 'main' });
        
        unlistenData = await listen<[string, number[]]>('pty-data', (event) => {
          const [sid, data] = event.payload;
          if (sid === useOsStore.getState().activePtySession) {
            term.write(new Uint8Array(data));
          }
        });

        unlistenExit = await listen<string>('pty-process-exit', (event) => {
          const sid = event.payload;
          const currentSid = useOsStore.getState().activePtySession;
          
          if (sid === 'main') {
            term.writeln('\r\n\x1b[1;33mMain session exited. Respawning...\x1b[0m');
            setTimeout(() => {
              invoke('spawn_terminal', { sessionId: 'main' });
            }, 500);
            return;
          }

          if (sid === currentSid) {
            term.writeln('\r\n\x1b[1;31mSession terminated. Returning to main...\x1b[0m');
            setTimeout(() => {
              useOsStore.getState().setActivePtySession('main');
            }, 800);
          }
        });

        unlistenError = await listen<string>('term-edit-error', (event) => {
          term.writeln(`\r\n\x1b[1;31m[Save Error] ${event.payload}\x1b[0m`);
        });

        term.onData(data => {
          const sid = useOsStore.getState().activePtySession;
          invoke('write_to_terminal', { sessionId: sid, input: Array.from(new TextEncoder().encode(data)) });
        });

        term.onResize(({ rows, cols }) => {
          const sid = useOsStore.getState().activePtySession;
          invoke('resize_terminal', { sessionId: sid, rows, cols });
        });

        // Initial resize for all likely sessions (or just active)
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          invoke('resize_terminal', { sessionId: 'main', rows: dims.rows, cols: dims.cols });
        }

      } catch (err) {
        term.writeln(`\r\n\x1b[1;31mFailed to spawn PTY: ${err}\x1b[0m`);
      }
    };

    setupPty();

    // Resize observer to keep terminal fitted
    const ro = new ResizeObserver(() => {
      try { 
        fitAddon.fit();
      } catch (e) { }
    });
    ro.observe(containerRef.current);

    // Dynamic theme observer
    const updateTheme = () => {
      const styles = getComputedStyle(document.documentElement);
      const fg = styles.getPropertyValue('--text-primary').trim() || '#e4e6f0';
      const cursor = styles.getPropertyValue('--accent').trim() || '#5b8af0';
      term.options.theme = {
        background: '#00000000',
        foreground: fg,
        cursor: cursor,
      };
    };

    updateTheme(); // initial

    const themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Explicit Ctrl+Shift+C / Ctrl+Shift+V handling
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;

      // Esc closes the command palette (if onClose is wired)
      if (e.key === 'Escape') {
        if (onClose) onClose();
        return false;
      }

      const isModifier = e.ctrlKey || e.metaKey;
      if (isModifier && e.shiftKey) {
        const key = e.key.toLowerCase();
        
        if (key === 'c' && term.hasSelection()) {
          document.execCommand('copy');
          term.clearSelection();
          return false;
        }
        
        if (key === 'v') {
          navigator.clipboard.readText().then(text => {
            const sid = useOsStore.getState().activePtySession;
            invoke('write_to_terminal', { sessionId: sid, input: Array.from(new TextEncoder().encode(text)) });
          });
          return false;
        }
      }
      return true;
    });

    return () => {
      ro.disconnect();
      themeObserver.disconnect();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      if (unlistenError) unlistenError();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const activePtySession = useOsStore(s => s.activePtySession);
  const prevPtySession = useRef(activePtySession);

  // Handle session transitions (clearing, resizing)
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // Visual feedback for switch
    if (activePtySession !== 'main') {
      term.reset(); // Clear terminal for fresh editor view
      term.writeln(`\r\n\x1b[1;36mSwitching to editor session: ${activePtySession}...\x1b[0m`);
    } else if (prevPtySession.current !== 'main') {
      term.writeln(`\r\n\x1b[1;32mSwitched back to main terminal.\x1b[0m`);
    }
    
    prevPtySession.current = activePtySession;

    // Trigger a resize on switch to ensure the new PTY inherits the current dimensions
    const dims = { cols: term.cols, rows: term.rows };
    if (dims) {
      invoke('resize_terminal', { sessionId: activePtySession, rows: dims.rows, cols: dims.cols });
    }
  }, [activePtySession]);

  return (
    <div className="panel terminal-panel" style={{ background: 'transparent', position: 'relative' }}>
      <div 
        title="Force Restart Session"
        onClick={async () => {
          if (!termRef.current) return;
          try {
            await invoke('kill_terminal', { sessionId: activePtySession });
            termRef.current.reset();
            termRef.current.writeln(`\r\n\x1b[1;33mForce restarting session: ${activePtySession}...\x1b[0m`);
            if (activePtySession === 'main') {
              await invoke('spawn_terminal', { sessionId: 'main' });
            } else {
              // Usually if it's an edit session and you freeze, just go back to main to recover.
              useOsStore.getState().setActivePtySession('main');
            }
          } catch (e) {
            console.error(e);
          }
        }}
        style={{
          position: 'absolute',
          top: 12,
          right: 24,
          cursor: 'pointer',
          zIndex: 10,
          background: 'var(--bg-secondary)',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 12,
          border: '1px solid var(--border)',
          opacity: 0.6
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
      >
        🔄 Refresh
      </div>
      <div className="panel-body" style={{ padding: 8 }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
      </div>
    </div>
  );
});
