import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Tailwind height class for the chart area, e.g. "h-64". Default h-56. */
  bodyHeight?: string;
  className?: string;
  children: React.ReactNode;
}

export const ChartCard: React.FC<Props> = ({
  title, subtitle, action, bodyHeight = 'h-56', className, children,
}) => (
  <Card className={cn('flex flex-col', className)}>
    <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
      <div>
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </CardHeader>
    <CardContent className={cn('pt-0', bodyHeight)}>
      {children}
    </CardContent>
  </Card>
);
