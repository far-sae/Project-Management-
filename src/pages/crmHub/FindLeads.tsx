import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Search, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmContacts, useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { companyKey } from '@/lib/crmImport';
import {
  APOLLO_SOURCE, SENIORITY_OPTIONS, SIZE_OPTIONS, addedSentence, hiddenName, knownApolloIds, leadFromPerson, mergePendingPhones,
  phonePatch, phonesSentence, readPendingPhones, readPhonesChoice, savePendingPhones, savePhonesChoice, splitList, splitNewLeads,
  type PendingPhones,
} from '@/lib/crmProspects';
import { publicMessage, publicText } from '@/lib/publicError';
import { cn } from '@/lib/utils';
import { errorSentence, prospectPhones, prospectSetup, revealProspects, searchProspects } from '@/services/prospects/client';
import { ensureCompaniesByName } from '@/services/supabase/crmHub/companies';
import { createContact, listLeadEmails, updateContact } from '@/services/supabase/crmHub/contacts';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProspectFilters, ProspectSearch, ProspectSetup } from '../../../api/_prospect/shared/types';

/**
 * Find leads: search Apollo for people, tick the ones worth having, and add
 * them to the CRM as leads.
 *
 * Searching costs nothing. Adding a person costs one Apollo credit, because
 * that is when their email is fetched. Their own phone number costs eight
 * credits more, so it is fetched only while "Also get phone numbers" is on;
 * Apollo finds it a little later, and it is saved on the lead when it arrives.
 * A person who is a lead already cannot be bought again.
 * For the organisation's owner and admins.
 */

/** How many phone-number requests are asked about at once (the server's limit). */
const PHONE_BATCH = 10;
/** How long to wait before the first look for phone numbers, in seconds. Apollo then says how long to wait. */
const PHONE_FIRST_WAIT = 8;
/** After this many looks the page stops asking; what is left is collected the next time it is opened. */
const PHONE_TRIES_MAX = 40;

const BOX = 'rounded-lg border border-border bg-card';
const NO_FILTER = 'Add at least one thing to search by: a job title, a place, a company or a keyword.';

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** A row of choices where any number can be on. */
const Chips: React.FC<{
  label: string;
  options: Array<{ value: string; label: string }>;
  chosen: string[];
  onChange: (next: string[]) => void;
}> = ({ label, options, chosen, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-sm font-medium text-foreground">{label}</span>
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((option) => {
        const on = chosen.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? chosen.filter((v) => v !== option.value) : [...chosen, option.value])}
            className={cn(
              'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  </div>
);

export const CrmFindLeadsPage: React.FC<{
  /** Seconds to wait → milliseconds. Tests pass their own so they do not wait. */
  pollDelay?: (seconds: number) => number;
}> = ({ pollDelay = (seconds) => seconds * 1000 }) => {
  const id = useId();
  const { user } = useAuth();
  const { isAdmin, organization } = useOrganization();
  const organizationId = organization?.organizationId ?? null;
  const workspaceId = useWorkspaceForCreate();
  const { items: leads, refresh: refreshLeads } = useCrmContacts();

  const [setup, setSetup] = useState<ProspectSetup | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [titles, setTitles] = useState('');
  const [locations, setLocations] = useState('');
  const [keywords, setKeywords] = useState('');
  const [domains, setDomains] = useState('');
  const [seniorities, setSeniorities] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [withPhones, setWithPhones] = useState(readPhonesChoice);
  /** Phone numbers Apollo is still looking up, and the leads they belong to. */
  const [pendingPhones, setPendingPhones] = useState<PendingPhones | null>(null);
  const phoneWait = useRef(PHONE_FIRST_WAIT);
  const phoneTries = useRef(0);

  /** The filters of the search on screen, so "next page" asks for the same people. */
  const [asked, setAsked] = useState<ProspectFilters | null>(null);
  const [found, setFound] = useState<ProspectSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  /** People added in this visit, before the lead list has been read again. */
  const [added, setAdded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!isAdmin || !workspaceId) return;
    let alive = true;
    setSetup(null);
    setSetupError(null);
    prospectSetup(workspaceId)
      .then((answer) => { if (alive) setSetup(answer); })
      .catch((err) => { if (alive) setSetupError(errorSentence(err)); });
    return () => { alive = false; };
  }, [isAdmin, workspaceId]);

  // Numbers that were asked for on an earlier visit are still collected.
  const ready = setup?.ready === true;
  useEffect(() => {
    if (ready && workspaceId) setPendingPhones(readPendingPhones(workspaceId));
  }, [ready, workspaceId]);

  // Ask Apollo for the numbers until it has them all, then say what came of it.
  useEffect(() => {
    if (!ready || !workspaceId || !pendingPhones || phoneTries.current >= PHONE_TRIES_MAX) return;
    const timer = window.setTimeout(async () => {
      phoneTries.current += 1;
      let next: PendingPhones | null = { ...pendingPhones };
      try {
        const answer = await prospectPhones(workspaceId, pendingPhones.requestIds.slice(0, PHONE_BATCH));
        let added = 0;
        for (const phone of answer.phones) {
          const lead = pendingPhones.leads[phone.id];
          if (!lead) continue;
          try {
            await updateContact(lead.id, phonePatch(lead.customFields, phone));
            added += 1;
          } catch {
            /* The lead was deleted in the meantime: nothing to put the number on. */
          }
        }
        const requestIds = [...answer.pending, ...pendingPhones.requestIds.slice(PHONE_BATCH)];
        const totals = { added: pendingPhones.added + added, credits: pendingPhones.credits + answer.credits };
        phoneWait.current = answer.retryAfter > 0 ? answer.retryAfter : PHONE_FIRST_WAIT;
        if (requestIds.length === 0) {
          next = null;
          toast.success(phonesSentence(totals));
          void refreshLeads();
        } else {
          next = { ...pendingPhones, requestIds, ...totals };
        }
      } catch {
        /* The request failed: the numbers are kept waiting and asked for again. */
      }
      // Saved first: the numbers were paid for, whether or not this page is still open.
      savePendingPhones(workspaceId, next);
      setPendingPhones(next);
    }, pollDelay(phoneWait.current));
    return () => window.clearTimeout(timer);
  }, [pendingPhones, ready, workspaceId]);

  const known = useMemo(() => knownApolloIds(leads), [leads]);
  const isLead = (personId: string) => known.has(personId);
  const people = found?.people ?? [];
  const choosable = people.filter((p) => !isLead(p.id) && !added.has(p.id));
  const allChosen = choosable.length > 0 && choosable.every((p) => chosen.includes(p.id));

  const run = async (filters: ProspectFilters, page: number) => {
    if (!workspaceId) return;
    setSearching(true);
    setChosen([]);
    try {
      setFound(await searchProspects(workspaceId, filters, page));
      setAsked(filters);
    } catch (err) {
      toast.error(errorSentence(err));
    } finally {
      setSearching(false);
    }
  };

  const search = () => {
    const filters: ProspectFilters = {
      titles: splitList(titles), locations: splitList(locations), keywords: keywords.trim(), domains: splitList(domains),
      sizes, seniorities, verifiedOnly,
    };
    const empty = !filters.titles.length && !filters.locations.length && !filters.domains.length && !filters.sizes.length
      && !filters.seniorities.length && !filters.keywords;
    if (empty) { setProblem(NO_FILTER); return; }
    setProblem(null);
    void run(filters, 1);
  };

  const add = async () => {
    if (!workspaceId || !organizationId || chosen.length === 0) return;
    setConfirming(false);
    setAdding(true);
    try {
      const bought = await revealProspects(workspaceId, chosen, asked?.verifiedOnly ?? true, withPhones);
      const existing = await listLeadEmails(organizationId, workspaceId);
      const { fresh, already } = splitNewLeads(bought.people.map(leadFromPerson), existing);
      const companies = fresh.flatMap((lead) => (lead.company ? [lead.company] : []));
      const companyIds = companies.length
        ? await ensureCompaniesByName(organizationId, workspaceId, companies, user?.userId ?? null)
        : new Map<string, string>();
      let count = 0;
      /** Each person → the lead made from them, so a phone number that arrives later finds its lead. */
      const made: PendingPhones['leads'] = {};
      for (const lead of fresh) {
        const created = await createContact({
          organizationId, workspaceId, firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone,
          jobTitle: lead.jobTitle,
          companyId: lead.company ? companyIds.get(companyKey(lead.company.name)) ?? null : null,
          source: APOLLO_SOURCE, customFields: lead.customFields,
        }, user?.userId ?? null);
        made[lead.apolloId] = { id: created.id, customFields: lead.customFields };
        count += 1;
      }
      if (bought.phoneRequests.length && count > 0) {
        const waiting = mergePendingPhones(pendingPhones, { requestIds: bought.phoneRequests, leads: made, added: 0, credits: 0 });
        phoneTries.current = 0;
        phoneWait.current = PHONE_FIRST_WAIT;
        savePendingPhones(workspaceId, waiting);
        setPendingPhones(waiting);
      }
      // Everybody who was paid for is marked, added or not: none of them should be bought again.
      setAdded((old) => new Set([...old, ...bought.people.map((p) => p.id)]));
      setChosen((old) => old.filter((personId) => !bought.people.some((p) => p.id === personId)));
      toast.success(addedSentence({ added: count, credits: bought.credits, already: already.length, unverified: bought.unverified, notFound: bought.notFound }));
      if (bought.stopped) toast.warning(publicText(bought.stopped));
      void refreshLeads();
    } catch (err) {
      toast.error(err instanceof Error && err.name === 'ProspectError' ? errorSentence(err) : publicMessage(err, 'The leads could not be added. Please try again.'));
    } finally {
      setAdding(false);
    }
  };

  const back = (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/crm/contacts"><ArrowLeft aria-hidden /> Leads</Link>
      </Button>
    </div>
  );
  const shell = (children: React.ReactNode) => (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        {back}
        <PageHeader
          title="Find leads"
          description="Search Apollo for the people you want to reach, then add them as leads. Searching is free. Adding a person uses 1 Apollo credit."
        />
        {children}
      </div>
    </main>
  );
  const notice = (text: React.ReactNode) => (
    <div className={cn(BOX, 'flex flex-col items-center gap-2 border-dashed px-4 py-12 text-center')}>
      <Users className="h-5 w-5 text-muted-foreground" aria-hidden />
      <p className="max-w-xl text-sm text-muted-foreground">{text}</p>
    </div>
  );

  if (!isAdmin) return shell(notice('Only the owner and admins can find leads.'));
  if (!workspaceId) return shell(notice('Pick a workspace in the sidebar first. The leads you add go into that workspace.'));
  if (setupError) return shell(notice(<span role="alert">{setupError}</span>));
  if (!setup) {
    return shell(
      <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Checking" /></div>,
    );
  }
  if (!setup.ready) return shell(notice(publicText(setup.problem ?? 'Finding leads is not set up yet.')));

  const pages = found ? Math.max(1, Math.ceil(Math.min(found.total, found.perPage * 200) / found.perPage)) : 1;

  return shell(
    <>
      <form
        className={cn(BOX, 'flex flex-col gap-4 p-4')}
        onSubmit={(event) => { event.preventDefault(); search(); }}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-titles`}>Job titles</Label>
            <Input id={`${id}-titles`} value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="Head of Operations, COO" />
            <p className="text-xs text-muted-foreground">Any of these. Put a comma between them.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-locations`}>Where they live</Label>
            <Input id={`${id}-locations`} value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="London, United Kingdom" />
            <p className="text-xs text-muted-foreground">A city, a region or a country.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-keywords`}>Keywords</Label>
            <Input id={`${id}-keywords`} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="dental, clinic" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-domains`}>Company websites</Label>
            <Input id={`${id}-domains`} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="northwind.example" />
            <p className="text-xs text-muted-foreground">Only people who work at these companies.</p>
          </div>
        </div>
        <Chips label="Seniority" options={SENIORITY_OPTIONS} chosen={seniorities} onChange={setSeniorities} />
        <Chips label="Company size (people)" options={SIZE_OPTIONS} chosen={sizes} onChange={setSizes} />
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          <span>Only people with a verified email</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            checked={withPhones}
            onChange={(e) => { setWithPhones(e.target.checked); savePhonesChoice(e.target.checked); }}
          />
          <span className="min-w-0">
            Also get phone numbers
            <span className="block text-xs text-muted-foreground">
              8 more credits for each person a number is found for. Only numbers Apollo marks as valid are kept.
              Untick this to pay only for the email.
            </span>
          </span>
        </label>
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={searching}>
            {searching ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
            Search
          </Button>
          <span className="text-xs text-muted-foreground">No credit is used until you add somebody.</span>
        </div>
      </form>

      {pendingPhones && (
        <p role="status" className={cn(BOX, 'flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground')}>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Looking up phone numbers for {plural(Object.keys(pendingPhones.leads).length, 'lead', 'leads')}.
          They are saved on the leads when Apollo has found them. You can keep working.
        </p>
      )}

      {found && (
        found.people.length === 0 ? notice('Nobody matches. Try fewer or wider filters.') : (
          <section className="flex flex-col gap-3" aria-label="People found">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{plural(found.total, 'person', 'people')} found</span>
                {found.total > found.perPage && <> · page {found.page} of {pages.toLocaleString('en-GB')}</>}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={searching || found.page <= 1} onClick={() => asked && void run(asked, found.page - 1)}>
                  Previous page
                </Button>
                <Button variant="outline" size="sm" disabled={searching || found.page >= pages} onClick={() => asked && void run(asked, found.page + 1)}>
                  Next page
                </Button>
                <Button disabled={adding || chosen.length === 0} onClick={() => setConfirming(true)}>
                  {adding ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
                  {chosen.length ? `Add ${chosen.length} to leads` : 'Add to leads'}
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="w-10 px-3 py-2">
                      <input
                        type="checkbox" className="h-4 w-4 accent-primary" aria-label="Choose everyone on this page"
                        checked={allChosen} disabled={choosable.length === 0}
                        onChange={(e) => setChosen(e.target.checked ? choosable.map((p) => p.id) : [])}
                      />
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Job title</th>
                    <th scope="col" className="px-3 py-2 font-medium">Company</th>
                    <th scope="col" className="px-3 py-2 font-medium">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((person) => {
                    const name = hiddenName(person);
                    const lead = isLead(person.id);
                    const done = added.has(person.id);
                    return (
                      <tr key={person.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                        <td className="px-3 py-2">
                          {!lead && !done && (
                            <input
                              type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Choose ${name}`}
                              checked={chosen.includes(person.id)}
                              onChange={(e) => setChosen((old) => (e.target.checked ? [...old, person.id] : old.filter((v) => v !== person.id)))}
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-foreground">{name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{person.title || '—'}</td>
                        <td className="px-3 py-2 text-muted-foreground">{person.company || '—'}</td>
                        <td className="px-3 py-2">
                          {done ? <StatusPill tone="success">Added</StatusPill>
                            : lead ? <StatusPill tone="neutral">Already a lead</StatusPill>
                              : person.hasEmail ? <span className="text-muted-foreground">{asked?.verifiedOnly ? 'Verified' : 'Has an email'}</span>
                                : <span className="text-muted-foreground">No email</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              The full name and the email are shown once a person is added. That is the moment the credit is used.
            </p>
          </section>
        )
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add {plural(chosen.length, 'person', 'people')} as leads?</AlertDialogTitle>
            <AlertDialogDescription>
              {withPhones ? (
                <>
                  This uses up to {plural(chosen.length * 9, 'Apollo credit', 'Apollo credits')}: 1 for each person whose details are
                  found, and 8 more for each person a phone number is found for. The numbers are saved on the leads a little later,
                  when Apollo has found them.
                </>
              ) : (
                <>
                  This uses up to {plural(chosen.length, 'Apollo credit', 'Apollo credits')}: 1 for each person whose details are found.
                  Phone numbers are not fetched, because they cost 8 credits each.
                </>
              )}
              {' '}Anybody who is a lead already is not added again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void add()}>Add {plural(chosen.length, 'lead', 'leads')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>,
  );
};

export default CrmFindLeadsPage;
