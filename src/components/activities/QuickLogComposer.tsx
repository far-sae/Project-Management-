// src/components/activities/QuickLogComposer.tsx
//
// Inline note composer with @mention support. Posts to client_notes or
// lead_notes (both require a parent entity — NOT NULL FK). After insert,
// resolves @mentions from organization.members and fires a
// "comment_mention" notification for each mentioned member (excluding self).
//
// Props:
//   entity  — fixed parent { type, id, label }. When provided the
//              "related to" chip is shown and locked. When omitted, a
//              client/lead picker is rendered (hub use — no fixed entity).
//   onPosted — called after a successful insert so the parent can reload.

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { createNote, getOrganizationClients } from '@/services/supabase/clients';
import { createLeadNote, getOrganizationLeads } from '@/services/supabase/leads';
import { createNotification } from '@/services/supabase/database';
import { extractMentions } from '@/services/agent/mentions';
import type { Client } from '@/services/supabase/clients';
import type { Lead } from '@/services/supabase/leads';

export interface QuickLogEntity {
  type: 'client' | 'lead';
  id: string;
  label?: string;
}

interface QuickLogComposerProps {
  /** When provided the entity is fixed (per-record use). When omitted, a
   *  picker is rendered so the user can choose the parent (hub use). */
  entity?: QuickLogEntity;
  onPosted: () => void;
}

export const QuickLogComposer: React.FC<QuickLogComposerProps> = ({ entity: fixedEntity, onPosted }) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const members = organization?.members ?? [];

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  // Hub-use: picked entity when no fixed entity prop.
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pickedEntity, setPickedEntity] = useState<QuickLogEntity | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // @mention dropdown state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = closed
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resolvedEntity = fixedEntity ?? pickedEntity;

  // Load clients + leads for hub picker (only when no fixed entity).
  useEffect(() => {
    if (fixedEntity || !orgId) return;
    Promise.all([
      getOrganizationClients(orgId).catch(() => [] as Client[]),
      getOrganizationLeads(orgId).catch(() => [] as Lead[]),
    ]).then(([c, l]) => {
      setClients(c);
      setLeads(l);
    });
  }, [orgId, fixedEntity]);

  // Detect @-typing — when the character before the cursor is `@` or an
  // `@word` fragment, open the mention dropdown.
  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setBody(val);

    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const match = before.match(/@([\w ]*)$/);
    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  };

  const filteredMembers = mentionQuery !== null
    ? members.filter((m) =>
        (m.displayName || m.email).toLowerCase().includes(mentionQuery.toLowerCase()),
      )
    : [];

  const insertMention = (displayName: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart ?? body.length;
    const before = body.slice(0, cursor);
    const after = body.slice(cursor);
    const base = before.replace(/@([\w ]*)$/, '');
    const newBody = `${base}@${displayName} ${after}`;
    setBody(newBody);
    setMentionQuery(null);
    // Restore focus.
    setTimeout(() => {
      ta.focus();
      const pos = base.length + displayName.length + 2; // @name + space
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const handlePost = async () => {
    if (!user || !orgId) return;
    if (!body.trim()) {
      toast.error('Write something to log');
      return;
    }
    if (!resolvedEntity) {
      toast.error('Choose a client or lead first');
      return;
    }

    setBusy(true);
    try {
      if (resolvedEntity.type === 'client') {
        await createNote(orgId, resolvedEntity.id, user.userId, user.displayName ?? user.email ?? '', {
          kind: 'note',
          body: body.trim(),
        });
      } else {
        await createLeadNote(orgId, resolvedEntity.id, user.userId, user.displayName ?? user.email ?? null, {
          kind: 'note',
          body: body.trim(),
        });
      }

      // @mention notifications — comment_mention is the type the app uses.
      const mentionList = extractMentions(
        body,
        members.map((m) => ({ userId: m.userId, name: m.displayName || m.email })),
      );
      for (const mentioned of mentionList) {
        if (mentioned.userId === user.userId) continue; // don't self-notify
        createNotification({
          userId: mentioned.userId,
          type: 'comment_mention',
          title: `${user.displayName ?? user.email} mentioned you`,
          body: body.trim().slice(0, 140),
          actorUserId: user.userId,
          actorDisplayName: user.displayName ?? user.email ?? '',
        }).catch((e) => console.warn('mention notify:', e));
      }

      toast.success('Note logged');
      setBody('');
      setMentionQuery(null);
      if (!fixedEntity) setPickedEntity(null);
      onPosted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not log note');
    } finally {
      setBusy(false);
    }
  };

  // Picker results (clients + leads filtered by search).
  const pickerItems = [
    ...clients
      .filter((c) => c.name.toLowerCase().includes(pickerSearch.toLowerCase()))
      .slice(0, 6)
      .map((c) => ({ type: 'client' as const, id: c.clientId, label: c.name })),
    ...leads
      .filter((l) => {
        const name = [l.firstName, l.lastName].filter(Boolean).join(' ') || l.company || l.email || '';
        return name.toLowerCase().includes(pickerSearch.toLowerCase());
      })
      .slice(0, 6)
      .map((l) => {
        const name = [l.firstName, l.lastName].filter(Boolean).join(' ') || l.company || l.email || l.leadId;
        return { type: 'lead' as const, id: l.leadId, label: name };
      }),
  ];

  return (
    <div className="rounded-md border bg-card p-3 space-y-2">
      {/* Entity chip / picker */}
      {fixedEntity ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Logging to:</span>
          <Badge variant="secondary" className="text-[11px]">
            {fixedEntity.type === 'client' ? 'Account' : 'Lead'}: {fixedEntity.label ?? fixedEntity.id}
          </Badge>
        </div>
      ) : (
        <div className="relative">
          {pickedEntity ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Logging to:</span>
              <Badge variant="secondary" className="text-[11px]">
                {pickedEntity.type === 'client' ? 'Account' : 'Lead'}: {pickedEntity.label ?? pickedEntity.id}
              </Badge>
              <button
                type="button"
                onClick={() => setPickedEntity(null)}
                className="ml-1 text-muted-foreground hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div>
              <input
                type="text"
                className="w-full text-xs rounded border px-2 py-1.5 bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Search client or lead to log against…"
                value={pickerSearch}
                onChange={(e) => { setPickerSearch(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              />
              {pickerOpen && pickerItems.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                  {pickerItems.map((item) => (
                    <button
                      key={`${item.type}:${item.id}`}
                      type="button"
                      className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center gap-2"
                      onMouseDown={(e) => {
                        e.preventDefault(); // prevent blur
                        setPickedEntity(item);
                        setPickerSearch('');
                        setPickerOpen(false);
                      }}
                    >
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {item.type === 'client' ? 'Account' : 'Lead'}
                      </Badge>
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Textarea with @mention dropdown */}
      <div className="relative">
        <Textarea
          ref={textareaRef}
          placeholder="Log a note… type @ to mention a teammate"
          rows={2}
          value={body}
          onChange={handleBodyChange}
          disabled={busy}
          className="resize-none text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMentionQuery(null);
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void handlePost();
            }
          }}
        />

        {/* @mention dropdown */}
        {mentionQuery !== null && filteredMembers.length > 0 && (
          <div className="absolute z-10 bottom-full mb-1 left-0 w-56 rounded-md border bg-popover shadow-md max-h-40 overflow-y-auto">
            {filteredMembers.slice(0, 8).map((m) => (
              <button
                key={m.userId}
                type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center gap-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(m.displayName || m.email);
                }}
              >
                <span className="w-5 h-5 rounded-full bg-primary/15 text-primary grid place-items-center text-[10px] font-bold shrink-0">
                  {(m.displayName || m.email).charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{m.displayName || m.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">Ctrl+Enter to post</span>
        <Button
          size="sm"
          onClick={handlePost}
          disabled={busy || !body.trim() || !resolvedEntity}
        >
          {busy
            ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
            : <Send className="w-3.5 h-3.5 mr-1" />}
          Post
        </Button>
      </div>
    </div>
  );
};
