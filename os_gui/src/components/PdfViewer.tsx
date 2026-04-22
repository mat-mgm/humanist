import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PdfViewerProps {
  url: string;
}

function PdfPage({ pdfDoc, pageNum, scale, useThemeColors }: { pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number, useThemeColors: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy load using Intersection Observer
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '500px' }); // load slightly before it comes into view

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pdfDoc && canvasRef.current && isVisible) {
      // Small timeout to prevent completely locking the main thread if many pages are visible at once
      const t = setTimeout(() => {
        pdfDoc.getPage(pageNum).then(page => {
          const viewport = page.getViewport({ scale });
          const canvas = canvasRef.current;
          if (!canvas) return;
          const context = canvas.getContext('2d');
          if (!context) return;

          // Clear previous
          context.clearRect(0, 0, canvas.width, canvas.height);

          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport
          };
          page.render(renderContext as any).promise.then(() => {
            if (!useThemeColors) return;
            const temp = document.createElement('div');
            document.body.appendChild(temp);

            const getRgb = (varName: string) => {
              temp.style.color = `var(${varName})`;
              const colorString = getComputedStyle(temp).color;
              const match = colorString.match(/\d+/g);
              if (match && match.length >= 3) {
                return [parseInt(match[0], 10), parseInt(match[1], 10), parseInt(match[2], 10)];
              }
              return [255, 255, 255];
            };

            const bgTone = getRgb('--bg-primary');
            const textTone = getRgb('--text-primary');
            document.body.removeChild(temp);

            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
              if (a === 0) continue;
              const lightness = (r + g + b) / (3 * 255);
              data[i] = textTone[0] * (1 - lightness) + bgTone[0] * lightness;
              data[i+1] = textTone[1] * (1 - lightness) + bgTone[1] * lightness;
              data[i+2] = textTone[2] * (1 - lightness) + bgTone[2] * lightness;
            }
            context.putImageData(imageData, 0, 0);
          });
        });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [pdfDoc, pageNum, scale, isVisible, useThemeColors]);

  // Estimate aspect ratio to prevent layout shift before load (standard paper is 1:1.414 or 8.5x11)
  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        marginBottom: '20px'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          maxWidth: '100%',
          height: 'auto',
          background: 'none',
          borderRadius: 4
        }}
      />
    </div>
  );
}

export function PdfViewer({ url }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [useThemeColors, setUseThemeColors] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    pdfjsLib.getDocument(url).promise.then(doc => {
      if (!active) return;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    }).catch(err => {
      console.error("PDF Load Error:", err);
    });

    return () => {
      active = false;
    };
  }, [url]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const scDelta = e.deltaY < 0 ? 0.1 : -0.1;
        setScale(s => Math.max(0.3, Math.min(5.0, s + scDelta)));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onZoomIn = () => setScale(s => Math.min(5.0, s + 0.2));
  const onZoomOut = () => setScale(s => Math.max(0.3, s - 0.2));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', background: 'var(--bg-primary)', borderRadius: '4px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: 'var(--bg-panel-header)',
        borderBottom: '1px solid var(--border)'
      }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-hint)' }}>
          {numPages > 0 ? `${numPages} Pages` : 'Loading...'}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onZoomOut}
            style={{ padding: '4px 8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}
          >
            -
          </button>
          <span style={{ fontSize: '12px', display: 'flex', alignItems: 'center', color: 'var(--text-primary)', width: '35px', justifyContent: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            style={{ padding: '4px 8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}
          >
            +
          </button>
          <button
            onClick={() => setUseThemeColors(v => !v)}
            title={useThemeColors ? 'Switch to natural colors' : 'Switch to theme colors'}
            style={{
              padding: '4px 8px',
              background: useThemeColors ? 'var(--accent, #7aa2f7)' : 'var(--bg-secondary)',
              color: useThemeColors ? '#fff' : 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            Theme
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '20px',
          background: 'none'
        }}
      >
        {pdfDoc && Array.from({ length: numPages }).map((_, i) => (
          <PdfPage key={i} pdfDoc={pdfDoc} pageNum={i + 1} scale={scale} useThemeColors={useThemeColors} />
        ))}
      </div>
    </div>
  );
}
