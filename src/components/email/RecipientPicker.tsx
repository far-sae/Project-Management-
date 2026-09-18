import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Clipboard, FileSpreadsheet, Check, AlertTriangle, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Recipient } from '@/services/supabase/email';

export type RecipientMode = 'contacts' | 'paste' | 'csv';

export const recipientKey = (r: Recipient): string => r.contactId ?? r.email.toLowerCase();

interface RecipientPickerProps {
  mode: RecipientMode;
  onModeChange: (mode: RecipientMode) => void;

  contacts: Recipient[];
  contactsLoading: boolean;
  selectedContactKeys: Set<string>;
  onToggleContact: (key: string) => void;
  onSelectAllContacts: () => void;
  onSelectNoneContacts: () => void;

  pasteText: string;
  onPasteTextChange: (value: string) => void;
  pastedRecipients: Recipient[];
  pastedErrors: string[];

  csvFileName: string;
  onCsvFile: (file: File) => void;
  csvRecipients: Recipient[];
  csvErrors: string[];
  csvColumns: string[];
}

const MODES: { value: RecipientMode; label: string; icon: React.ReactNode }[] = [
  { value: 'contacts', label: 'CRM contacts', icon: <Users className="w-4 h-4 mr-1.5" /> },
  { value: 'paste', label: 'Paste', icon: <Clipboard className="w-4 h-4 mr-1.5" /> },
  { value: 'csv', label: 'CSV', icon: <FileSpreadsheet className="w-4 h-4 mr-1.5" /> },
];

export const RecipientPicker: React.FC<RecipientPickerProps> = ({
  mode, onModeChange,
  contacts, contactsLoading, selectedContactKeys, onToggleContact, onSelectAllContacts, onSelectNoneContacts,
  pasteText, onPasteTextChange, pastedRecipients, pastedErrors,
  csvFileName, onCsvFile, csvRecipients, csvErrors, csvColumns,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {MODES.map((m) => (
          <Button
            key={m.value}
            type="button"
            size="sm"
            variant={mode === m.value ? 'default' : 'outline'}
            onClick={() => onModeChange(m.value)}
          >
            {m.icon}{m.label}
          </Button>
        ))}
      </div>

      {mode === 'contacts' && (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
            <span className="text-sm font-medium">
              {contactsLoading ? 'Loading contacts…' : `${contacts.length} contact${contacts.length === 1 ? '' : 's'} with an email`}
            </span>
            {!contactsLoading && contacts.length > 0 && (
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={onSelectAllContacts}>All</Button>
                <Button type="button" size="sm" variant="ghost" onClick={onSelectNoneContacts}>None</Button>
              </div>
            )}
          </div>
          {contactsLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              <Loader2 className="w-6 h-6 mx-auto animate-spin" />
            </div>
          ) : contacts.length === 0 ? (
            <p className="px-3 py-6 text-sm text-center text-muted-foreground">No CRM contacts with an email address.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {contacts.map((c) => {
                const key = recipientKey(c);
                const checked = selectedContactKeys.has(key);
                return (
                  <div
                    key={key}
                    role="checkbox"
                    aria-checked={checked}
                    tabIndex={0}
                    onClick={() => onToggleContact(key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleContact(key); } }}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/50"
                  >
                    <div className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked ? 'bg-primary border-primary' : 'border-input',
                    )}>
                      {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm truncate">{c.name || c.email}</p>
                      {c.name && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {mode === 'paste' && (
        <div className="space-y-2">
          <Textarea
            value={pasteText}
            onChange={(e) => onPasteTextChange(e.target.value)}
            placeholder={'jane@acme.com\nJohn Doe <john@acme.com>, sam@acme.com'}
            className="min-h-[120px] font-mono text-xs"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{pastedRecipients.length} parsed</Badge>
            {pastedErrors.length > 0 && (
              <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
                <AlertTriangle className="w-3 h-3 mr-1" />{pastedErrors.length} invalid
              </Badge>
            )}
          </div>
          {pastedErrors.length > 0 && (
            <ul className="text-xs text-red-600 dark:text-red-400 list-disc pl-4 max-h-24 overflow-y-auto">
              {pastedErrors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          )}
        </div>
      )}

      {mode === 'csv' && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 text-center transition-colors hover:border-primary hover:bg-muted"
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">{csvFileName || 'Click to choose a CSV file'}</p>
            <p className="text-xs text-muted-foreground">Needs an "email" column; other columns become merge fields.</p>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsvFile(f); e.currentTarget.value = ''; }}
          />
          {csvFileName && (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{csvRecipients.length} rows</Badge>
              {csvErrors.length > 0 && (
                <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
                  <AlertTriangle className="w-3 h-3 mr-1" />{csvErrors.join(', ')}
                </Badge>
              )}
              {csvColumns.length > 0 && (
                <span className="text-xs text-muted-foreground">Columns: {csvColumns.join(', ')}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RecipientPicker;
