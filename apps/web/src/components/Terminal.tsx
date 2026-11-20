import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

export interface TerminalHandle {
  write: (text: string) => void;
  clear: () => void;
}

/** Read-only xterm.js view of the server console. Commands are typed in a separate input. */
export function Terminal({ ref }: { ref: Ref<TerminalHandle> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const pending = useRef<string[]>([]);

  useImperativeHandle(ref, () => ({
    write: (text) => {
      if (terminalRef.current) terminalRef.current.write(text);
      else pending.current.push(text);
    },
    clear: () => terminalRef.current?.clear(),
  }));

  useEffect(() => {
    const terminal = new XTerm({
      disableStdin: true,
      convertEol: true,
      cursorBlink: false,
      cursorStyle: 'underline',
      scrollback: 5000,
      fontSize: 13,
      lineHeight: 1.25,
      fontFamily: 'ui-monospace, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
      theme: {
        background: '#060a12',
        foreground: '#d5dcec',
        cursor: '#060a12',
        selectionBackground: '#22d3ee44',
        cyan: '#5ee7ff',
        brightCyan: '#8eedff',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current!);
    terminalRef.current = terminal;
    for (const text of pending.current.splice(0)) terminal.write(text);

    const refit = () => {
      try {
        fit.fit();
      } catch {
        /* container not visible yet */
      }
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(containerRef.current!);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
