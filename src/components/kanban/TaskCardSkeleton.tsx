import React from 'react';
import { cn } from '@/lib/utils';

interface TaskCardSkeletonProps {
  count?: number;
}

/** Lightweight shimmer placeholder card used while tasks are loading. */
export const TaskCardSkeleton: React.FC<TaskCardSkeletonProps> = ({
  count = 3,
}) => {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'rounded-lg border border-border bg-card p-3 mb-2.5',
            'animate-pulse',
          )}
          aria-hidden="true"
        >
          <div className="h-3 w-3/4 rounded bg-secondary mb-2" />
          <div className="h-2 w-1/2 rounded bg-secondary mb-3" />
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-12 rounded-full bg-secondary" />
            <div className="h-4 w-10 rounded-full bg-secondary" />
            <div className="ml-auto h-5 w-5 rounded-full bg-secondary" />
          </div>
        </div>
      ))}
    </>
  );
};

export default TaskCardSkeleton;
