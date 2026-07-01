import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, X, Tag as TagIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/services/supabase/config';
import { useCrmTags } from '@/hooks/useCrmHub';
import {
  listContactTagIds, attachTagToContact, detachTagFromContact,
} from '@/services/supabase/crmHub/tags';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  contactId: string;
}

export const ContactTagPicker: React.FC<Props> = ({ contactId }) => {
  const { items: allTags, loading: tagsLoading } = useCrmTags();
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const availableTags = allTags.filter((t) => !attached.has(t.id));

  const handleAttach = async (tagId: string) => {
    setBusy(true);
    try {
      await attachTagToContact(contactId, tagId);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not attach tag');
    } finally {
      setBusy(false);
    }
  };

  const handleDetach = async (tagId: string) => {
    setBusy(true);
    try {
      await detachTagFromContact(contactId, tagId);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove tag');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <TagIcon className="w-3.5 h-3.5" />
        Tags:
      </div>
      {loading || tagsLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      ) : (
        <>
          {attachedTags.length === 0 && (
            <span className="text-xs text-muted-foreground">None</span>
          )}
          {attachedTags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs"
              style={{ backgroundColor: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}
            >
              <span className="text-foreground">{t.name}</span>
              <button
                type="button"
                onClick={() => void handleDetach(t.id)}
                disabled={busy}
                className="h-4 w-4 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={busy || availableTags.length === 0}
              >
                <Plus className="w-3 h-3 mr-1" />
                {availableTags.length === 0 ? 'No more tags' : 'Add tag'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {availableTags.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => void handleAttach(t.id)}
                  className="flex items-center gap-2"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  {t.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
};

export default ContactTagPicker;
