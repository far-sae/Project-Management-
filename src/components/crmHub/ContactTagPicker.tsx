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
      toast.error(err instanceof Error ? err.message : 'Could not load tags');
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
      toast.error(err instanceof Error ? err.message : 'Could not update tag');
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
          <p className="text-xs text-muted-foreground italic px-1">No tags attached yet.</p>
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
    className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs"
    style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
  >
    <span className="text-foreground">{name}</span>
    <button
      type="button"
      onClick={onRemove}
      disabled={busy}
      className="h-4 w-4 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center disabled:opacity-50"
      title="Remove tag"
    >
      <X className="w-3 h-3" />
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
          <Settings className="w-3.5 h-3.5 mr-1.5" />
          Create tags first
        </Link>
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="w-full" disabled={busy}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add / remove tags
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
        <div className="border-t border-border mt-2 pt-2">
          <Button asChild size="sm" variant="ghost" className="w-full justify-start text-xs">
            <Link to="/crm/tags">
              <Settings className="w-3 h-3 mr-1.5" />
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
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-left text-sm disabled:opacity-50"
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
              }`}
            >
              {isOn && <Check className="w-3 h-3" />}
            </span>
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: t.color }}
            />
            <span className="text-foreground truncate">{t.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ContactTagPicker;
