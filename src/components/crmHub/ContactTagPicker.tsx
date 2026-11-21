import { publicMessage } from '@/lib/publicError';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus, X, Settings, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase/config';
import { useCrmTags } from '@/hooks/useCrmHub';
import {
  listContactTagIds, attachTagToContact, detachTagFromContact,
} from '@/services/supabase/crmHub/tags';
import { Button } from '@/components/ui/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';

interface Props {
  contactId: string;
  /** Compact = inline row (old sidebar style). Default = full panel layout. */
  variant?: 'panel' | 'inline';
}

export const ContactTagPicker: React.FC<Props> = ({ contactId, variant = 'panel' }) => {
  const { items: allTags, loading: tagsLoading } = useCrmTags();
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await listContactTagIds(contactId);
      setAttached(new Set(ids));
    } catch (err) {
      toast.error(publicMessage(err, 'Could not load tags'));
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const channel = supabase
      .channel(`crm-contact-tags-${contactId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_contact_tags', filter: `contact_id=eq.${contactId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [contactId, refresh]);

  const attachedTags = allTags.filter((t) => attached.has(t.id));

  const toggleTag = async (tagId: string) => {
    const isAttached = attached.has(tagId);
    setBusy(true);
    try {
      if (isAttached) {
        await detachTagFromContact(contactId, tagId);
      } else {
        await attachTagToContact(contactId, tagId);
      }
      await refresh();
    } catch (err) {
      toast.error(publicMessage(err, 'Could not update tag'));
    } finally {
      setBusy(false);
    }
  };

  const noTagsInOrg = !tagsLoading && allTags.length === 0;

  // Compact inline variant (legacy — kept for other consumers if any)
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {(loading || tagsLoading) ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        ) : (
          <>
            {attachedTags.length === 0 && (
              <span className="text-xs text-muted-foreground">None</span>
            )}
            {attachedTags.map((t) => (
              <TagPill key={t.id} name={t.name} color={t.color} onRemove={() => void toggleTag(t.id)} busy={busy} />
            ))}
            <AddTagButton
              open={open}
              onOpenChange={setOpen}
              attached={attached}
              onToggle={toggleTag}
              busy={busy}
              noTagsInOrg={noTagsInOrg}
            />
          </>
        )}
      </div>
    );
  }

  // Panel variant (default) — layout matches the AssocPanel cards on the right rail.
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(loading || tagsLoading) ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : attachedTags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags on this lead yet.</p>
        ) : attachedTags.map((t) => (
          <TagPill key={t.id} name={t.name} color={t.color} onRemove={() => void toggleTag(t.id)} busy={busy} />
        ))}
      </div>
      <AddTagButton
        open={open}
        onOpenChange={setOpen}
        attached={attached}
        onToggle={toggleTag}
        busy={busy}
        noTagsInOrg={noTagsInOrg}
      />
    </div>
  );
};

const TagPill: React.FC<{
  name: string;
  color: string;
  onRemove: () => void;
  busy: boolean;
}> = ({ name, color, onRemove, busy }) => (
  <span
    className="inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-xs font-medium"
    style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
  >
    <span className="truncate text-foreground">{name}</span>
    <button
      type="button"
      onClick={onRemove}
      disabled={busy}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
      title="Remove tag"
      aria-label={`Remove tag ${name}`}
    >
      <X className="h-3 w-3" aria-hidden />
    </button>
  </span>
);

const AddTagButton: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  attached: Set<string>;
  onToggle: (tagId: string) => Promise<void> | void;
  busy: boolean;
  noTagsInOrg: boolean;
}> = ({ open, onOpenChange, attached, onToggle, busy, noTagsInOrg }) => {
  if (noTagsInOrg) {
    return (
      <Button asChild size="sm" variant="outline" className="w-full">
        <Link to="/crm/tags">
          <Settings aria-hidden />
          Create tags first
        </Link>
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="w-full" disabled={busy}>
          <Plus aria-hidden />
          Add or remove tags
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="max-h-64 overflow-y-auto">
          <TagCheckboxList
            attached={attached}
            onToggle={onToggle}
            busy={busy}
          />
        </div>
        <div className="mt-2 border-t border-border pt-2">
          <Button asChild size="sm" variant="ghost" className="w-full justify-start">
            <Link to="/crm/tags">
              <Settings aria-hidden />
              Manage tags
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const TagCheckboxList: React.FC<{
  attached: Set<string>;
  onToggle: (tagId: string) => Promise<void> | void;
  busy: boolean;
}> = ({ attached, onToggle, busy }) => {
  const { items: allTags } = useCrmTags();
  if (allTags.length === 0) return null;
  return (
    <div className="space-y-0.5 py-1">
      {allTags.map((t) => {
        const isOn = attached.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => void onToggle(t.id)}
            disabled={busy}
            role="checkbox"
            aria-checked={isOn}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary disabled:opacity-50"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
              }`}
            >
              {isOn && <Check className="h-3 w-3" aria-hidden />}
            </span>
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: t.color }}
              aria-hidden
            />
            <span className="truncate text-foreground">{t.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ContactTagPicker;
