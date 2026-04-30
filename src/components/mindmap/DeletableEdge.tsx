import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';

/** Each edge carries this in its `data` so the X button knows what to remove.
 *  Keeping the callback per-edge (rather than via a context) means a single
 *  `edgeTypes` registration covers both the project map AND the AI map even
 *  though they have different removal semantics (auto-edges hide, user edges
 *  delete, AI edges just splice from local state). */
export interface DeletableEdgeData extends Record<string, unknown> {
  onDelete?: (id: string) => void;
  /** Optional tooltip — defaults to "Remove connection". */
  removeLabel?: string;
}

/** Smoothstep edge with a one-click "X" button at the midpoint.
 *
 *  UX rationale:
 *  - Selecting a thin path and hitting Delete is hard, especially on touch
 *    devices and for less technical users. The button is always visible at
 *    a low opacity so it's discoverable, and grows + reddens on hover so
 *    the affordance is unmistakable when the user reaches for it.
 *  - The button lives inside `EdgeLabelRenderer` so it sits in screen-space
 *    above the canvas — translation/zoom math is handled by React Flow.
 *  - `nodrag nopan` stops React Flow from interpreting clicks on the button
 *    as a viewport pan; `pointer-events-auto` re-enables clicks (the default
 *    label layer is pointer-events-none so paths underneath stay selectable). */
export const DeletableEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
  markerEnd,
  selected,
}) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const onDelete = (data as DeletableEdgeData | undefined)?.onDelete;
  const tooltip = (data as DeletableEdgeData | undefined)?.removeLabel ?? 'Remove connection';

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {onDelete && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="nodrag nopan pointer-events-auto"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(id);
              }}
              title={tooltip}
              aria-label={tooltip}
              className={
                'group flex items-center justify-center rounded-full border border-border bg-card shadow-md ' +
                'transition-all duration-150 ' +
                (selected
                  ? 'h-5 w-5 opacity-100 text-destructive ring-2 ring-destructive/30'
                  : 'h-4 w-4 opacity-50 hover:opacity-100 text-muted-foreground hover:text-white hover:bg-destructive hover:border-destructive hover:scale-125')
              }
            >
              <X className="w-2.5 h-2.5" strokeWidth={3} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default DeletableEdge;
