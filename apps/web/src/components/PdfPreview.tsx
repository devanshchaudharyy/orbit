import { useEffect, useRef, useState } from 'react';
import { Button } from '@orbit/ui';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export default function PdfPreview({ bytes }: { bytes: ArrayBuffer }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let stopped = false,
      close: () => void = () => {};
    void import('pdfjs-dist')
      .then((pdf) => {
        if (stopped) return;
        pdf.GlobalWorkerOptions.workerSrc = worker;
        const task = pdf.getDocument({
          data: new Uint8Array(bytes.slice(0)),
          enableXfa: false,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/',
        });
        close = () => {
          void task.destroy();
        };
        void task.promise
          .then((value) => {
            if (!stopped) setDocument(value);
          })
          .catch(() => {
            if (!stopped) {
              setError('This PDF could not be rendered. You can still download the original file.');
              setLoading(false);
            }
          });
      })
      .catch(() => {
        if (!stopped) {
          setError('PDF preview is unavailable. Retry or download the original file.');
          setLoading(false);
        }
      });
    return () => {
      stopped = true;
      close();
    };
  }, [bytes]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let stopped = false,
      render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setLoading(true);
    void document
      .getPage(page)
      .then((value) => {
        if (stopped || !canvas.current) return;
        const base = value.getViewport({ scale: 1 }),
          viewport = value.getViewport({
            scale: Math.min(1.5, 900 / base.width, 1400 / base.height),
          });
        const target = canvas.current;
        target.width = viewport.width;
        target.height = viewport.height;
        render = value.render({ canvas: target, viewport });
        return render.promise;
      })
      .then(() => {
        if (!stopped) setLoading(false);
      })
      .catch(() => {
        if (!stopped) {
          setError('This PDF page could not be rendered.');
          setLoading(false);
        }
      });
    return () => {
      stopped = true;
      render?.cancel();
    };
  }, [document, page]);
  return (
    <div className="pdf-preview">
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          {loading ? <p role="status">Rendering PDF page…</p> : null}
          <canvas ref={canvas} aria-label={`PDF page ${page}`} role="img" />
          <div className="library-actions">
            <Button
              disabled={!document || page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous page
            </Button>
            <span>
              Page {page} of {document?.numPages ?? '…'}
            </span>
            <Button
              disabled={!document || page >= document.numPages || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next page
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
