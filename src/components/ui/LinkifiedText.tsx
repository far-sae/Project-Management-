import React, { useMemo } from 'react';
import { splitLinks } from '@/lib/linkify';
import { cn } from '@/lib/utils';

/**
 * Plain text with any web addresses / emails turned into links. Web links
 * open in a new tab; clicking a link never triggers the surrounding element
 * (e.g. "click to edit" on a description).
 */
export const LinkifiedText: React.FC<{ text: string; className?: string; linkClassName?: string }> = ({
  text,
  className,
  linkClassName,
}) => {
  const parts = useMemo(() => splitLinks(text), [text]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <React.Fragment key={i}>{p.value}</React.Fragment>
        ) : (
          <a
            key={i}
            href={p.href}
            {...(p.href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'break-all text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              linkClassName,
            )}
          >
            {p.value}
          </a>
        ),
      )}
    </span>
  );
};
