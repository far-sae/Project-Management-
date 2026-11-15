/**
 * Character offset inside `container`'s text at screen point (x, y), or null
 * if the browser can't tell or the point is outside the container. Used to
 * put the cursor exactly where someone clicked when a read-only text view
 * turns into a textarea.
 */
export function textOffsetFromPoint(
  container: HTMLElement,
  x: number,
  y: number,
  doc: Document = container.ownerDocument,
): number | null {
  type CaretDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const d = doc as CaretDoc;
  let node: Node | null = null;
  let offset = 0;
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = d.caretRangeFromPoint?.(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !container.contains(node)) return null;
  try {
    const before = doc.createRange();
    before.setStart(container, 0);
    before.setEnd(node, offset);
    return before.toString().length;
  } catch {
    return null;
  }
}
