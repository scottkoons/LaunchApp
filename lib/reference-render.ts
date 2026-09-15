// Keep the actual source artwork. AI selects documents; it never redraws menus.
export async function referencePages(blob: Blob, title: string) {
  const name =
    title
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .slice(0, 100) || 'Reference';
  if (blob.type !== 'application/pdf') {
    const extension = (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      } as Record<string, string>
    )[blob.type];
    if (!extension)
      throw new Error('This source is not a supported image or PDF.');
    return {
      pages: [new File([blob], `${name}.${extension}`, { type: blob.type })],
      original: undefined,
    };
  }
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } =
    await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    useSystemFonts: true,
  });
  try {
    const doc = await loading.promise;
    if (doc.numPages > 12)
      throw new Error(
        'This PDF has more than 12 pages. Upload it directly to keep it as a document.',
      );
    const pages: File[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(
        2.5,
        2400 / Math.max(natural.width, natural.height),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvas, viewport }).promise;
        const image = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        );
        if (!image || image.size > 20 * 1024 * 1024)
          throw new Error(
            'A menu page could not be converted to an image. Try a smaller PDF.',
          );
        pages.push(
          new File([image], `${name}-page-${number}.png`, {
            type: 'image/png',
          }),
        );
      } finally {
        canvas.width = canvas.height = 0;
      }
      page.cleanup();
    }
    return {
      pages,
      original: new File([blob], `${name}.pdf`, { type: 'application/pdf' }),
    };
  } finally {
    await loading.destroy();
  }
}
