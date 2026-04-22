import { memo, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import '@xterm/xterm/css/xterm.css';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface PtyCanvasProps {
  sessionId: string;
  /** If true, does not call spawn_terminal on mount — caller owns session lifecycle. */
  skipAutoSpawn?: boolean;
  /** Optional command sent once after the PTY spawns (only when skipAutoSpawn is false). */
  initCommand?: string;
}

function getXtermTheme(): Record<string, string> {
  const s = getComputedStyle(document.documentElement);
  const g = (v: string) => s.getPropertyValue(v).trim();
  return {
    background:    g('--bg-primary')    || '#1e1e2e',
    foreground:    g('--text-primary')  || '#cdd6f4',
    cursor:        g('--accent')        || '#f5c2e7',
    selectionBackground: g('--bg-panel') || '#313244',
    black:   '#45475a', red:     g('--error')   || '#f38ba8',
    green:   '#a6e3a1', yellow:  '#f9e2af',
    blue:    '#89b4fa', magenta: '#f5c2e7',
    cyan:    '#94e2d5', white:   '#bac2de',
    brightBlack:   '#585b70', brightRed:     '#f38ba8',
    brightGreen:   '#a6e3a1', brightYellow:  '#f9e2af',
    brightBlue:    '#89b4fa', brightMagenta: '#f5c2e7',
    brightCyan:    '#94e2d5', brightWhite:   '#a6adc8',
  };
}

export const PtyCanvas = memo(function PtyCanvas({ sessionId, skipAutoSpawn, initCommand }: PtyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      allowTransparency: true,
      fontSize: 13,
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
      theme: { background: '#00000000', ...getXtermTheme() },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current  = fit;

    if (!skipAutoSpawn) {
      invoke('spawn_terminal', { sessionId }).then(() => {
        if (initCommand) {
          invoke('write_to_terminal', {
            sessionId,
            input: Array.from(textEncoder.encode(initCommand + '\n')),
          }).catch(() => {});
        }
      }).catch(() => {
        // Session may already exist — still send initCommand if given
        if (initCommand) {
          invoke('write_to_terminal', {
            sessionId,
            input: Array.from(textEncoder.encode(initCommand + '\n')),
          }).catch(() => {});
        }
      });
    }

    // Resize
    const fitAndResize = () => {
      fit.fit();
      invoke('resize_terminal', { sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    const ro = new ResizeObserver(fitAndResize);
    ro.observe(containerRef.current);

    // Forward keyboard input as byte array
    const inputDispose = term.onData(data => {
      invoke('write_to_terminal', {
        sessionId,
        input: Array.from(textEncoder.encode(data)),
      }).catch(() => {});
    });

    // Receive PTY output — payload is [sessionId: string, data: number[]]
    let unlistenData:  (() => void) | undefined;
    let unlistenExit:  (() => void) | undefined;

    listen<[string, number[]]>('pty-data', (ev) => {
      const [sid, data] = ev.payload;
      if (sid !== sessionId) return;
      term.write(textDecoder.decode(new Uint8Array(data)));
    }).then(fn => { unlistenData = fn; });

    listen<string>('pty-process-exit', (ev) => {
      if (ev.payload !== sessionId) return;
      term.write('\r\n[process exited]\r\n');
    }).then(fn => { unlistenExit = fn; });

    // Theme observer
    const themeObserver = new MutationObserver(() => {
      term.options.theme = { background: '#00000000', ...getXtermTheme() };
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      ro.disconnect();
      inputDispose.dispose();
      themeObserver.disconnect();
      unlistenData?.();
      unlistenExit?.();
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
    };
  }, [sessionId]);

  // Re-send initCommand if it changes while mounted (only when skipAutoSpawn is false)
  const prevInitRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (skipAutoSpawn || !initCommand || initCommand === prevInitRef.current) return;
    prevInitRef.current = initCommand;
    invoke('write_to_terminal', {
      sessionId,
      input: Array.from(textEncoder.encode(initCommand + '\n')),
    }).catch(() => {});
  }, [initCommand, sessionId, skipAutoSpawn]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}
    />
  );
});
