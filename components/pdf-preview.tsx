'use client';
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// oxlint-disable-next-line import/default -- Vite's ?url loader exports the bundled asset URL.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export type PdfPreviewHandle = { print: () => Promise<void> };
type PageImage = { src: string; width: number; height: number; text: string };
async function bounded<T>(promise: Promise<T>, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function PdfPreview({
  blob,
  ref,
  onReady,
}: {
  blob: Blob;
  ref: Ref<PdfPreviewHandle>;
  onReady: (ready: boolean) => void;
}) {
  const [pages, setPages] = useState<PageImage[]>([]),
    [error, setError] = useState(''),
    [zoom, setZoom] = useState(100);
  const documentRef = useRef<PDFDocumentProxy | null>(null),
    printFrame = useRef<HTMLIFrameElement | null>(null),
    scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | undefined;
    onReady(false);
    setPages([]);
    setError('');
    void (async () => {
      const pdfjs = await bounded(
        import('pdfjs-dist'),
        'The preview took too long to load.',
      );
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const loading = pdfjs.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        useSystemFonts: true,
      });
      task = loading;
      const doc = await bounded(
        loading.promise,
        'The PDF took too long to load.',
      );
      if (cancelled) return;
      documentRef.current = doc;
      const rendered: PageImage[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i),
          viewport = page.getViewport({ scale: 1.5 }),
          canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await bounded(
          page.render({ canvas, viewport }).promise,
          'A page took too long to render.',
        );
        const text = (await page.getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
        rendered.push({
          src: canvas.toDataURL('image/png'),
          width: viewport.width / 1.5,
          height: viewport.height / 1.5,
          text,
        });
        canvas.width = canvas.height = 0;
        if (cancelled) return;
        setPages([...rendered]);
      }
      onReady(true);
    })().catch((e) => {
      if (!cancelled)
        setError(
          'Could not display PDF pages. Close this preview and generate it again. ' +
            (e instanceof Error ? e.message : ''),
        );
    });
    return () => {
      cancelled = true;
      documentRef.current = null;
      void task?.destroy();
      printFrame.current?.remove();
    };
  }, [blob, onReady]);
  useImperativeHandle(ref, () => ({
    print: async () => {
      const doc = documentRef.current;
      if (!doc) throw new Error('The PDF is still loading.');
      const images: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i),
          viewport = page.getViewport({ scale: 3 }),
          canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await bounded(
          page.render({ canvas, viewport, intent: 'print' }).promise,
          'A page took too long to prepare for printing.',
        );
        const orientation =
          viewport.width > viewport.height ? 'landscape' : 'portrait';
        images.push(
          `<section class="${orientation}"><img src="${canvas.toDataURL('image/png')}" /></section>`,
        );
        canvas.width = canvas.height = 0;
      }
      printFrame.current?.remove();
      const frame = document.createElement('iframe');
      frame.title = 'Print marketing report';
      frame.style.cssText =
        'position:fixed;width:1px;height:1px;bottom:0;left:0;border:0;opacity:0;pointer-events:none';
      printFrame.current = frame;
      const loaded = new Promise<void>((resolve) => {
        frame.onload = () => resolve();
      });
      frame.srcdoc = `<!doctype html><html><head><title>Launch marketing report</title><style>@page{margin:0}@page portrait{size:letter portrait}@page landscape{size:letter landscape}html,body{margin:0;padding:0}section{break-after:page;overflow:hidden}section:last-child{break-after:auto}.portrait{page:portrait;width:8.5in;height:11in}.landscape{page:landscape;width:11in;height:8.5in}img{display:block;width:100%;height:100%}</style></head><body>${images.join('')}</body></html>`;
      document.body.appendChild(frame);
      await bounded(loaded, 'The print window took too long to open.');
      await bounded(
        Promise.all(
          Array.from(frame.contentDocument!.images).map((img) => img.decode()),
        ),
        'The print pages took too long to load.',
      );
      let opened = false;
      frame.contentWindow!.addEventListener(
        'beforeprint',
        () => {
          opened = true;
        },
        { once: true },
      );
      frame.contentWindow!.focus();
      frame.contentWindow!.print();
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!opened)
        throw new Error(
          'This browser did not open the print dialog. Open Launch in Chrome to print directly, or use Download PDF.',
        );
    },
  }));
  return (
    <div className="pdf-pages-viewer">
      <div className="pdf-viewer-toolbar">
        <span>
          {pages.length ? `${pages.length} pages` : 'Rendering pages…'}
        </span>
        <label>
          Zoom{' '}
          <select
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={75}>75%</option>
            <option value={100}>Fit width</option>
            <option value={125}>125%</option>
            <option value={150}>150%</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="report-error">
          {error}
        </p>
      )}
      <div className="pdf-viewer-body">
        <nav className="pdf-thumbnails" aria-label="PDF pages">
          {pages.map((page, i) => (
            <button
              key={i}
              onClick={() =>
                scrollRef.current
                  ?.querySelector(`[data-page="${i}"]`)
                  ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
              }
              aria-label={`Go to page ${i + 1}`}
            >
              <img src={page.src} alt="" />
              <span>{i + 1}</span>
            </button>
          ))}
        </nav>
        <div className="pdf-page-scroll" ref={scrollRef}>
          {!pages.length && !error && <output>Preparing page previews…</output>}
          {pages.map((page, i) => (
            <figure
              key={i}
              data-page={i}
              style={{
                width: `${zoom}%`,
                maxWidth: zoom === 100 ? `${page.width * 1.2}px` : 'none',
              }}
            >
              <img src={page.src} alt={`Page ${i + 1}: ${page.text}`} />
              <figcaption>
                Page {i + 1} ·{' '}
                {page.width > page.height ? 'Landscape' : 'Portrait'}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
