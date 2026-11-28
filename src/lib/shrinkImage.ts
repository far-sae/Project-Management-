// A photo from a phone is often 5 to 12 MB, and the server takes 4 MB. Before
// a receipt is sent to be read, a large photo is drawn smaller in the browser.
// Text on a receipt stays readable at 2,000 pixels on the long side.

const LONG_SIDE = 2000;
/** Below this a photo is sent as it is. */
export const SMALL_ENOUGH_BYTES = 1_500_000;

/** The size a picture is drawn at: the long side at most `LONG_SIDE`, the shape kept. */
export function fitWithin(width: number, height: number, longSide = LONG_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > longSide)) return { width, height };
  const scale = longSide / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The file to send: the same one for a PDF, a small photo, or when the browser
 * cannot draw it; a smaller JPEG copy for a large photo. Never throws: when
 * anything goes wrong the file goes as it is and the server says if it is too big.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= SMALL_ENOUGH_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
