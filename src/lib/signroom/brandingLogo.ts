/** Box of an image's content, in pixels: left and top inclusive, right and bottom exclusive. */
export type Bounds = { left: number; top: number; right: number; bottom: number };

/**
 * Where the logo itself is, inside the empty margin around it. The margin is
 * whatever the top-left pixel is: see-through (a transparent PNG), or one plain
 * colour such as white (a JPEG or an opaque PNG). Null when the whole image is margin.
 */
export function contentBounds(data: Uint8ClampedArray, width: number, height: number): Bounds | null {
  const clear = data[3]! < 16;
  const [r, g, b] = [data[0]!, data[1]!, data[2]!];
  const isMargin = (i: number) =>
    clear
      ? data[i + 3]! < 16
      : data[i + 3]! > 239 && Math.abs(data[i]! - r) <= 16 && Math.abs(data[i + 1]! - g) <= 16 && Math.abs(data[i + 2]! - b) <= 16;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isMargin((y * width + x) * 4)) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      bottom = y + 1;
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** The server's limit for a stored logo (a data URL). */
const MAX_LOGO = 400_000;

/**
 * The uploaded logo without the empty margin around it, so it fills its place
 * on documents and lines up with the company name. Keeps the original when
 * there is nothing to trim, when the browser cannot read it, or when the
 * result would be larger than the server accepts.
 */
export async function trimLogo(dataUrl: string): Promise<string> {
  try {
    const type = /^data:image\/(png|jpeg);/.exec(dataUrl)?.[1];
    if (!type) return dataUrl;
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const { naturalWidth: w, naturalHeight: h } = img;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx || !w || !h) return dataUrl;
    ctx.drawImage(img, 0, 0);
    const box = contentBounds(ctx.getImageData(0, 0, w, h).data, w, h);
    // Nothing worth trimming (under 2% of the image on every side).
    if (!box || (box.left <= w * 0.02 && box.top <= h * 0.02 && w - box.right <= w * 0.02 && h - box.bottom <= h * 0.02)) return dataUrl;
    const out = document.createElement('canvas');
    out.width = box.right - box.left;
    out.height = box.bottom - box.top;
    out.getContext('2d')!.drawImage(canvas, box.left, box.top, out.width, out.height, 0, 0, out.width, out.height);
    const trimmed = out.toDataURL(`image/${type}`, 0.92);
    return trimmed.startsWith(`data:image/${type};`) && trimmed.length <= MAX_LOGO ? trimmed : dataUrl;
  } catch {
    return dataUrl;
  }
}

/** A chosen file as a data URL. */
export const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
