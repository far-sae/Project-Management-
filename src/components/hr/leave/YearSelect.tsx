import React, { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface YearSelectProps {
  year: number;
  years: number[];
  onChange: (year: number) => void;
}

/** The year the balances and the public holiday list are shown for. */
export const YearSelect: React.FC<YearSelectProps> = ({ year, years, onChange }) => {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Year
      </Label>
      <Select value={String(year)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className="w-28 tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)} className="tabular-nums">
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
