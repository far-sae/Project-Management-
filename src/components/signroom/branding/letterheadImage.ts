// The first page of a PDF as a picture, to draw the person's own letterhead behind the designer's page.

const WORKER_SRC = '/signroom/pdf.worker.min.mjs';
/** Wide enough to stay sharp on the designer's page at twice its largest size. */
const PICTURE_WIDTH = 1280;

/** Draws the first page of a PDF and answers a blob URL for the picture. The caller frees it. */
export async function pdfPageImage(pdf: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  const task = pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()), enableXfa: false });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: PICTURE_WIDTH / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw the page.');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const picture = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!picture) throw new Error('The page could not be drawn.');
    return URL.createObjectURL(picture);
  } finally {
    void task.destroy();
  }
}
