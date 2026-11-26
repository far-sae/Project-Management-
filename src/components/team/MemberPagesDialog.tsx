// The window on the Team page where the owner (or an admin) chooses which
// pages one person sees and can use. Every page is a switch. Where a page has
// things that were for admins only, a second choice says how much is given.
// Nothing is kept until Save is pressed.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { publicMessage } from '@/lib/publicError';
import { ACCESS_PAGES, hasOwnPages, pagesFor, type AccessArea, type AccessLevel, type AccessPage, type MemberAccess } from '@/lib/memberAccess';
import { clearMemberPages, saveMemberPages } from '@/services/supabase/memberAccess';

interface Props {
  /** The person whose pages are chosen. Null: the window is closed. */
  member: { userId: string; name: string } | null;
  organizationId: string;
  /** What was chosen for this person before, if anything. */
  access: MemberAccess | undefined;
  /** The person who is choosing. */
  grantedBy?: string;
  /** A page whose plan feature the organisation does not have is left out. */
  hasFeature: (feature: NonNullable<AccessPage['feature']>) => boolean;
  onOpenChange: (open: boolean) => void;
  /** The new rows of this person; undefined when they are a standard member again. */
  onSaved: (access: MemberAccess | undefined) => void;
}

const GROUPS: AccessPage['group'][] = ['Work', 'Sales and marketing'];

export const MemberPagesDialog: React.FC<Props> = ({ member, organizationId, access, grantedBy, hasFeature, onOpenChange, onSaved }) => {
  const [pages, setPages] = useState<Record<AccessArea, AccessLevel>>(() => pagesFor(access));
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const memberId = member?.userId ?? null;

  // Opened for a person: start from what they have now.
  // Only when the window opens for a person: what they have is not put back while the owner is switching.
  const accessNow = useRef(access);
  accessNow.current = access;
  useEffect(() => { if (memberId) setPages(pagesFor(accessNow.current)); }, [memberId]);

  const offered = useMemo(() => ACCESS_PAGES.filter((p) => !p.feature || hasFeature(p.feature)), [hasFeature]);
  const own = hasOwnPages(access);
  const changed = JSON.stringify(pages) !== JSON.stringify(pagesFor(access));
  const name = member?.name ?? 'This person';

  const set = (area: AccessArea, level: AccessLevel) => setPages((old) => ({ ...old, [area]: level }));

  const save = async () => {
    if (!member) return;
    setBusy('save');
    try {
      await saveMemberPages(organizationId, member.userId, pages, grantedBy);
      onSaved({ ...pages });
      toast.success(`Saved. ${name} sees the new pages the next time they open the app.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(publicMessage(error, 'The pages could not be saved. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (!member) return;
    setBusy('reset');
    try {
      await clearMemberPages(organizationId, member.userId);
      onSaved(undefined);
      toast.success(`${name} has the standard pages of a member again.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(publicMessage(error, 'The pages could not be changed. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={member !== null} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What {name} can see</DialogTitle>
          <DialogDescription>
            Switch a page on and {name} sees it in the menu and can work in it. Switch it off and it is closed for them.
            {' '}My Tasks, Calendar, their own projects and their own settings are always on.
          </DialogDescription>
        </DialogHeader>

        {!own && (
          <p role="status" className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-muted-foreground">
            Nothing was chosen for {name} yet. The switches show what a member has in the menu today. Press Save to keep exactly these pages.
          </p>
        )}

        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => {
            const rows = offered.filter((p) => p.group === group);
            return rows.length === 0 ? null : (
              <section key={group} aria-label={group}>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</h4>
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {rows.map((page) => {
                    const level = pages[page.area];
                    const on = level !== 'off';
                    const id = `page-${page.area}`;
                    return (
                      <li key={page.area} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <label htmlFor={id} className="text-sm font-medium text-foreground">{page.label}</label>
                          <p className="text-xs text-muted-foreground">{page.hint}</p>
                        </div>
                        {page.manage && on && (
                          <select
                            aria-label={`How much of ${page.label}`} value={level} onChange={(e) => set(page.area, e.target.value as AccessLevel)}
                            className="h-11 rounded-md border border-input bg-background px-2 text-sm md:h-8"
                          >
                            <option value="use">{page.manage.use}</option>
                            <option value="manage">{page.manage.manage}</option>
                          </select>
                        )}
                        <Switch id={id} checked={on} onCheckedChange={(next) => set(page.area, next ? 'use' : 'off')} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {own && (
              <Button variant="ghost" disabled={busy !== null} onClick={() => void reset()}>
                {busy === 'reset' && <Loader2 className="animate-spin" aria-hidden />}Back to standard
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy !== null} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={busy !== null || (own && !changed)} onClick={() => void save()}>
              {busy === 'save' && <Loader2 className="animate-spin" aria-hidden />}Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MemberPagesDialog;
