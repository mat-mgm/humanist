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

    // Simple shell echo simulation
    let commandBuffer = '';
    term.onData(e => {
      switch (e) {
        case '\r': // Enter
          term.writeln('');
          const cmd = commandBuffer.trim();
          if (cmd === 'help') {
            term.writeln('Available commands: \x1b[36mhelp\x1b[0m, \x1b[36mclear\x1b[0m, \x1b[36mecho\x1b[0m, \x1b[36mdate\x1b[0m, \x1b[36mwhoami\x1b[0m, \x1b[36mping\x1b[0m');
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
          } else if (cmd.length > 0) {
            term.writeln(`\x1b[31mbash: ${cmd}: command not found\x1b[0m`);
          }
          commandBuffer = '';
          term.write('\x1b[1;32m$\x1b[0m ');
          break;
        case '\x7F': // Backspace
          if (term.buffer.active.cursorX > 2) {
            term.write('\b \b');
            commandBuffer = commandBuffer.slice(0, -1);
          }
          break;
        default:
          if (e.length === 1 && e.charCodeAt(0) >= 32) {
            term.write(e);
            commandBuffer += e;
          }
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
