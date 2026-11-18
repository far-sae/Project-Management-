import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { HrPerson } from '../types';
import { personName } from './leaveView';

/** 24px avatar and name, as shown in the first column of the leave tables. */
export const PersonCell: React.FC<{ person: HrPerson | undefined }> = ({ person }) => {
  const name = personName(person);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarImage src={person?.photoURL || undefined} alt="" />
        <AvatarFallback className="text-xs font-semibold" aria-hidden>
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-[14rem] truncate font-medium text-foreground" title={name}>
        {name}
      </span>
    </div>
  );
};
