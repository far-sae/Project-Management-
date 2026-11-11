import React, { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
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
  /** Path shape. Defaults to 'smoothstep' (AI map); the project map uses 'bezier'. */
  curve?: 'bezier' | 'smoothstep';
  /** When true the X button only shows on hover / selection (and stays
   *  faintly visible on touch screens). Defaults to always-visible. */
  revealOnHover?: boolean;
}

/** Edge with a one-click "X" button at the midpoint.
 *
 *  - The button lives inside `EdgeLabelRenderer` so it sits in screen-space
 *    above the canvas — translation/zoom math is handled by React Flow.
 *  - `nodrag nopan` stops React Flow from interpreting clicks on the button
 *    as a viewport pan; `pointer-events-auto` re-enables clicks. */
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
  const d = data as DeletableEdgeData | undefined;
  const params = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [edgePath, labelX, labelY] =
    d?.curve === 'bezier' ? getBezierPath(params) : getSmoothStepPath(params);
  const [hovered, setHovered] = useState(false);

  const onDelete = d?.onDelete;
  const tooltip = d?.removeLabel ?? 'Remove connection';
  const reveal = !!d?.revealOnHover;
  const visible = hovered || selected;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {reveal && (
        // Wide invisible hit path so hovering near the line reveals the X.
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={22}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      )}
      {onDelete && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="nodrag nopan pointer-events-auto"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
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
                'flex items-center justify-center rounded-full border border-border bg-card shadow-sm ' +
                'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                'motion-safe:transition-[opacity,transform,color,background-color] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.97] ' +
                (selected
                  ? 'h-6 w-6 opacity-100 text-destructive ring-2 ring-destructive/30'
                  : 'h-5 w-5 text-muted-foreground hover:text-destructive-foreground hover:bg-destructive hover:border-destructive ' +
                    (!reveal
                      ? 'opacity-50 hover:opacity-100'
                      : visible
                        ? 'opacity-100'
                        : 'opacity-0 [@media(pointer:coarse)]:opacity-50'))
              }
            >
              <X className="w-3 h-3" strokeWidth={2.5} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default DeletableEdge;
