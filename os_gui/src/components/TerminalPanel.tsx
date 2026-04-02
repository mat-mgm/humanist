import { memo, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export const TerminalPanel = memo(function TerminalPanel() {
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
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 1000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    term.writeln('\x1b[1;36mSpatial-OS Terminal\x1b[0m');
    term.writeln('Version 0.1.0\r\n');
    term.write('\x1b[1;32m$\x1b[0m ');

    termRef.current = term;

    // Resize observer to keep terminal fitted
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch (e) { }
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
      // We only want to handle keydown events, not keyup, to avoid double-firing
      if (e.type !== 'keydown') return true;

      const isModifier = e.ctrlKey || e.metaKey;
      if (isModifier && e.shiftKey) {
        const key = e.key.toLowerCase();
        
        if (key === 'c' && term.hasSelection()) {
          // navigator.clipboard is often blocked in secure contexts without explicit permissions
          // xterm structures its hidden textarea precisely so this standard synchronous copy works
          document.execCommand('copy');
          term.clearSelection();
          return false; // Prevent xterm from processing this
        }
        
        if (key === 'v') {
          if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then((text) => {
              const cleanText = text.replace(/[\r\n]/g, '');
              if (!cleanText) return;
              commandBuffer = commandBuffer.slice(0, cursorIdx) + cleanText + commandBuffer.slice(cursorIdx);
              cursorIdx += cleanText.length;
              redrawLine();
            }).catch(err => console.error('Clipboard async read failed (permissions?):', err));
          }
          return false; // Prevent xterm from processing this
        }
      }
      return true; // Let xterm handle everything else normally (like Ctrl+C interrupt)
    });

    // History array and cursor state
    const history: string[] = [];
    let historyIdx = -1;
    let commandBuffer = '';
    let cursorIdx = 0; // relative to the start of the command

    const printPrompt = () => {
      term.write('\x1b[1;32m$\x1b[0m ');
    };

    const redrawLine = () => {
      // Clear line from cursor, backtrack to prompt, print buffer, then position cursor
      term.write('\x1b[2K\x1b[G');
      printPrompt();
      term.write(commandBuffer);
      
      // Move cursor back if it's not at the end of the buffer
      if (cursorIdx < commandBuffer.length) {
        term.write(`\x1b[${commandBuffer.length - cursorIdx}D`);
      }
    };

    term.onData(e => {
      switch (e) {
        case '\r': // Enter
          term.writeln('');
          const cmd = commandBuffer.trim();
          
          if (cmd.length > 0) {
            if (history[history.length - 1] !== cmd) {
              history.push(cmd);
            }
          }
          historyIdx = history.length;

          if (cmd === 'help') {
            term.writeln('Available commands: \x1b[36mhelp\x1b[0m, \x1b[36mclear\x1b[0m, \x1b[36mpl\x1b[0m, \x1b[36mecho\x1b[0m, \x1b[36mdate\x1b[0m, \x1b[36mwhoami\x1b[0m, \x1b[36mping\x1b[0m');
          } else if (cmd === 'clear') {
            term.clear();
          } else if (cmd === 'date') {
            term.writeln(new Date().toString());
          } else if (cmd === 'whoami') {
            term.writeln('spatial_os_user');
          } else if (cmd.startsWith('echo ')) {
            term.writeln(cmd.substring(5));
          } else if (cmd === 'ping') {
            term.writeln('pong');
          } else if (cmd.startsWith('?- ') || cmd.startsWith('pl ')) {
            const pq = cmd.replace(/^(\?- |pl )/, '');
            
            // Dynamic async import of @tauri-apps/api/core to prevent breaking environments outside Tauri
            import('@tauri-apps/api/core').then(async ({ invoke }) => {
              try {
                const results = await invoke('run_prolog_query', { query: pq }) as string[];
                if (results.length === 0) {
                  term.writeln('\x1b[33mNo matches found.\x1b[0m');
                } else {
                  results.forEach(res => term.writeln(`\x1b[36m${res}\x1b[0m`));
                }
              } catch (err: any) {
                term.writeln(`\x1b[31merror: ${typeof err === 'object' ? JSON.stringify(err) : err}\x1b[0m`);
              }
              printPrompt();
            }).catch(() => {
              term.writeln('\x1b[31merror: Tauri IPC not available\x1b[0m');
              printPrompt();
            });
            // We return early and omit printPrompt() because the async call will print it later
            commandBuffer = '';
            cursorIdx = 0;
            return;
          } else if (cmd.length > 0) {
            term.writeln(`\x1b[31mbash: ${cmd}: command not found\x1b[0m`);
          }
          commandBuffer = '';
          cursorIdx = 0;
          printPrompt();
          break;

        case '\x7F': // Backspace
          if (cursorIdx > 0) {
            commandBuffer = commandBuffer.slice(0, cursorIdx - 1) + commandBuffer.slice(cursorIdx);
            cursorIdx--;
            redrawLine();
          }
          break;

        case '\x1b[A': // Up arrow
          if (history.length > 0 && historyIdx > 0) {
            historyIdx--;
            commandBuffer = history[historyIdx];
            cursorIdx = commandBuffer.length;
            redrawLine();
          }
          break;

        case '\x1b[B': // Down arrow
          if (historyIdx < history.length - 1) {
            historyIdx++;
            commandBuffer = history[historyIdx];
            cursorIdx = commandBuffer.length;
            redrawLine();
          } else {
            historyIdx = history.length;
            commandBuffer = '';
            cursorIdx = 0;
            redrawLine();
          }
          break;

        case '\x1b[C': // Right arrow
          if (cursorIdx < commandBuffer.length) {
            cursorIdx++;
            term.write('\x1b[C');
          }
          break;

        case '\x1b[D': // Left arrow
          if (cursorIdx > 0) {
            cursorIdx--;
            term.write('\x1b[D');
          }
          break;

        case '\x03': // Ctrl+C (if not yielded to browser due to no selection)
          term.writeln('^C');
          commandBuffer = '';
          cursorIdx = 0;
          printPrompt();
          break;

        case '\x16': // Ctrl+V (won't usually trigger if yielded above)
          break;

        default:
          // Ignore other control sequences
          if (e.length === 1 && e.charCodeAt(0) < 32 && e !== '\x03' && e !== '\t') return;
          if (e.startsWith('\x1b')) return;

          // Process input (could be single char from typing or multi-char from paste)
          const cleanText = e.replace(/[\r\n]/g, ''); // strip newlines so paste stays inline
          if (!cleanText) return;

          commandBuffer = commandBuffer.slice(0, cursorIdx) + cleanText + commandBuffer.slice(cursorIdx);
          cursorIdx += cleanText.length;
          redrawLine();
      }
    });

    return () => {
      ro.disconnect();
      themeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  return (
    <div className="panel terminal-panel" style={{ background: 'var(--bg-panel)' }}>
      <div className="panel-body" style={{ padding: 8 }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
      </div>
    </div>
  );
});
