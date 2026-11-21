// Simple CRM rules: the sentences, the checks, the settings screen and the database file.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NEW_RULE, ruleProblem, ruleSentence, tidyRule, type CrmRule, type RuleNames } from '@/lib/crmRules';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  readError: null as null | { code?: string; message?: string },
  inserted: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  deleted: [] as string[],
  toast: { success: vi.fn(), error: vi.fn() },
  org: {
    isAdmin: true,
    organization: {
      organizationId: 'o',
      members: [
        { userId: 'u1', displayName: 'Sam', role: 'owner', status: 'active' },
        { userId: 'u2', displayName: 'Dana', role: 'member', status: 'active' },
      ],
    },
  },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/services/supabase/config', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => (h.readError ? { data: null, error: h.readError } : { data: h.rows, error: null }) }) }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({ single: async () => { h.inserted.push(row); return { data: { id: `r${h.inserted.length}`, enabled: true, ...row }, error: null }; } }),
      }),
      update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { h.updates.push({ id, patch }); return { error: null }; } }),
      delete: () => ({ eq: async (_c: string, id: string) => { h.deleted.push(id); return { error: null }; } }),
    }),
  },
}));
vi.mock('@/context/OrganizationContext', () => ({ useOrganization: () => h.org }));
vi.mock('@/hooks/useSelectedWorkspace', () => {
  const value = { selected: { workspaceId: 'w', name: 'Studio' } };
  return { useSelectedWorkspace: () => value };
});
vi.mock('@/hooks/useCrmHub', () => {
  const stages = { items: [{ id: 's1', name: 'New Lead' }, { id: 's4', name: 'Negotiation' }] };
  return { useCrmDealStages: () => stages };
});

import { RULES_NOT_SET_UP_MESSAGE } from '@/services/supabase/crmHub/rules';
import { CrmRulesSettings } from '@/components/crmHub/CrmRulesSettings';

const NAMES: RuleNames = { people: new Map([['u1', 'Sam'], ['u2', 'Dana']]), stages: new Map([['s4', 'Negotiation']]) };
const rule = (over: Partial<CrmRule>): CrmRule => ({ id: 'r1', enabled: true, ...NEW_RULE, ...over });

beforeEach(() => {
  h.rows = [];
  h.readError = null;
  h.inserted.length = 0;
  h.updates.length = 0;
  h.deleted.length = 0;
  h.toast.success.mockClear();
  h.org.isAdmin = true;
});
afterEach(cleanup);

describe('a rule as a sentence', () => {
  it('says when, what and for whom', () => {
    expect(ruleSentence(rule({ body: 'Call {name}', dueDays: 1 }), NAMES)).toBe('When a lead comes in, add the follow-up “Call {name}” for its owner, due the next day.');
    expect(ruleSentence(rule({ sourceContains: 'Website form', action: 'assign', personId: 'u2', body: '' }), NAMES)).toBe('When a lead comes in from “Website form”, give it to Dana.');
    expect(ruleSentence(rule({ event: 'deal_stage', stageId: 's4', action: 'notify', body: '{name} is in negotiation', personId: 'u1' }), NAMES))
      .toBe('When a deal reaches “Negotiation”, tell Sam: “{name} is in negotiation”.');
    expect(ruleSentence(rule({ event: 'deal_won', body: 'Send the welcome pack', dueDays: 3 }), NAMES)).toBe('When a deal is won, add the follow-up “Send the welcome pack” for its owner, due in 3 days.');
    expect(ruleSentence(rule({ event: 'deal_lost', body: 'Ask why', dueDays: 0, personId: 'gone' }), NAMES)).toBe('When a deal is lost, add the follow-up “Ask why” for someone who has left, due the same day.');
  });

  it('copes with a stage that was deleted', () => {
    expect(ruleSentence(rule({ event: 'deal_stage', stageId: 'gone', action: 'notify', body: 'x' }), NAMES)).toBe('When a deal reaches “a stage that was deleted”, tell its owner: “x”.');
  });
});

describe('checking a new rule', () => {
  it('accepts the rule the form starts with', () => {
    expect(ruleProblem(NEW_RULE, 0)).toBeNull();
  });

  it('says what is missing', () => {
    expect(ruleProblem({ ...NEW_RULE, event: 'deal_stage' }, 0)).toBe('Choose the stage the deal must reach.');
    expect(ruleProblem({ ...NEW_RULE, body: '  ' }, 0)).toBe('Write what the follow-up is called.');
    expect(ruleProblem({ ...NEW_RULE, action: 'notify', body: '' }, 0)).toBe('Write what the notice says.');
    expect(ruleProblem({ ...NEW_RULE, action: 'assign' }, 0)).toBe('Choose the person to give it to.');
    expect(ruleProblem({ ...NEW_RULE, event: 'deal_won', action: 'assign', personId: 'u2' }, 0)).toBe('A lead or a deal can be given to a person only when it is made.');
    expect(ruleProblem({ ...NEW_RULE, dueDays: 900 }, 0)).toBe('The follow-up can be due in 0 to 365 days.');
    expect(ruleProblem(NEW_RULE, 30)).toBe('A workspace can have 30 rules at most.');
  });

  it('clears what does not belong to the rule before it is saved', () => {
    expect(tidyRule({ event: 'deal_won', stageId: 's4', sourceContains: ' web ', action: 'notify', personId: '', body: ' Well done ', dueDays: 9 }))
      .toEqual({ event: 'deal_won', stageId: null, sourceContains: '', action: 'notify', personId: null, body: 'Well done', dueDays: 1 });
    expect(tidyRule({ ...NEW_RULE, action: 'assign', personId: 'u2', body: 'left over' }).body).toBe('');
  });
});

describe('Rules in CRM settings', () => {
  const choose = async (label: string, option: string) => {
    fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
    fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
  };

  it('adds a rule and shows it as a sentence', async () => {
    render(<CrmRulesSettings />);
    expect(await screen.findByText('No rules yet.')).toBeTruthy();
    await choose('When', 'A deal reaches a stage');
    await choose('Which stage', 'Negotiation');
    await choose('Do', 'Send a notice');
    await choose('For whom', 'Sam');
    fireEvent.change(screen.getByLabelText('The notice says'), { target: { value: '{name} is in negotiation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Rule added. It runs from now on.'));
    expect(h.inserted[0]).toEqual({
      organization_id: 'o', workspace_id: 'w', event: 'deal_stage', stage_id: 's4', source_contains: '', action: 'notify', person_id: 'u1',
      body: '{name} is in negotiation', due_days: 1,
    });
    expect(screen.getByText('When a deal reaches “Negotiation”, tell Sam: “{name} is in negotiation”.')).toBeTruthy();
  });

  it('offers “give it to a person” only for the moment a lead or deal is made', async () => {
    render(<CrmRulesSettings />);
    await screen.findByText('No rules yet.');
    await choose('Do', 'Give it to a person');
    await choose('When', 'A deal is won');
    // The action falls back, and is no longer offered.
    expect(screen.getByRole('combobox', { name: 'Do' }).textContent).toContain('Add a follow-up');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Do' }), { key: 'ArrowDown' });
    await screen.findByRole('option', { name: 'Send a notice' });
    expect(screen.queryByRole('option', { name: 'Give it to a person' })).toBeNull();
  });

  it('does not save a rule that is not complete, and says why', async () => {
    render(<CrmRulesSettings />);
    await screen.findByText('No rules yet.');
    fireEvent.change(screen.getByLabelText('The follow-up is called'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Write what the follow-up is called.');
    expect(h.inserted).toHaveLength(0);
  });

  it('switches a rule off and removes one', async () => {
    h.rows = [{ id: 'r1', enabled: true, event: 'deal_won', stage_id: null, source_contains: '', action: 'follow_up', person_id: null, body: 'Send the welcome pack', due_days: 1 }];
    render(<CrmRulesSettings />);
    const sentence = 'When a deal is won, add the follow-up “Send the welcome pack” for its owner, due the next day.';
    await screen.findByText(sentence);
    fireEvent.click(screen.getByRole('switch', { name: `Rule is on: ${sentence}` }));
    await waitFor(() => expect(h.updates).toEqual([{ id: 'r1', patch: { enabled: false } }]));
    fireEvent.click(screen.getByRole('button', { name: `Remove the rule: ${sentence}` }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Rule removed'));
    expect(h.deleted).toEqual(['r1']);
  });

  it('lets a member read the rules but not change them', async () => {
    h.org.isAdmin = false;
    h.rows = [{ id: 'r1', enabled: true, event: 'lead_created', stage_id: null, source_contains: '', action: 'follow_up', person_id: null, body: 'Call {name}', due_days: 1 }];
    render(<CrmRulesSettings />);
    await screen.findByText('When a lead comes in, add the follow-up “Call {name}” for its owner, due the next day.');
    expect(screen.getByText('Only the owner and admins can add or change rules.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
  });

  it('says which file to run while rules are not set up', async () => {
    h.readError = { code: 'PGRST205', message: 'no table' };
    render(<CrmRulesSettings />);
    expect((await screen.findByRole('alert')).textContent).toBe(RULES_NOT_SET_UP_MESSAGE);
    expect(RULES_NOT_SET_UP_MESSAGE).toContain('201_crm_rules.sql');
  });
});

describe('migration 201', () => {
  const raw = readFileSync(resolve(process.cwd(), 'supabase/migrations/201_crm_rules.sql'), 'utf8');
  const flat = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

  it('can be run twice', () => {
    expect(raw.toLowerCase()).toContain('safe to run more than once');
    expect(flat).toContain('create table if not exists public.crm_rules');
    expect(flat).not.toMatch(/create (?!or replace )function/i);
    expect((flat.match(/drop trigger if exists/g) ?? []).length).toBe((flat.match(/create trigger/g) ?? []).length);
    expect((flat.match(/drop policy if exists/g) ?? []).length).toBe((flat.match(/create policy/g) ?? []).length);
  });

  it('knows exactly the events and actions the screens offer', () => {
    expect(flat).toContain("check (event in ('lead_created', 'deal_created', 'deal_stage', 'deal_won', 'deal_lost'))");
    expect(flat).toContain("check (action in ('follow_up', 'notify', 'assign'))");
    expect(flat).toContain("check (action <> 'assign' or event in ('lead_created', 'deal_created'))");
  });

  it('never lets a rule stop a lead being added or a deal being saved', () => {
    // Each rule runs in its own guarded step, and so does each trigger.
    expect((flat.match(/exception when others then null; end;/g) ?? []).length).toBe(3);
    expect(flat).toContain('after insert on public.crm_contacts for each row execute function public.crm_rules_on_contact()');
    expect(flat).toContain('after insert or update on public.crm_deals for each row execute function public.crm_rules_on_deal()');
  });

  it('runs a stage rule only when the stage really changed, and a won rule only on becoming won', () => {
    expect(flat).toContain('if new.stage_id is distinct from old.stage_id then perform public.crm_run_rules(\'deal_stage\'');
    expect(flat).toContain("if new.status is distinct from old.status and new.status::text = 'won' then");
    expect(flat).toContain("elsif new.status is distinct from old.status and new.status::text = 'lost' then");
  });

  it('lets the owner and admins make rules, and nobody call the engine directly', () => {
    expect(flat).toContain('for all to authenticated using (public.is_org_admin_or_owner(organization_id)) with check (public.is_org_admin_or_owner(organization_id))');
    expect(flat).toContain('revoke all on function public.crm_run_rules(text, uuid, uuid, uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated');
  });

  it('writes follow-ups and notices into columns those tables really have', () => {
    expect(flat).toContain('insert into public.crm_tasks (organization_id, workspace_id, owner_id, assigned_to, contact_id, deal_id, title, due_date, priority, status)');
    expect(flat).toContain('insert into public.notifications (user_id, type, title, message, read, link)');
    const notices = readFileSync(resolve(process.cwd(), 'supabase/migrations/001_notifications_table.sql'), 'utf8');
    for (const column of ['user_id', 'type', 'title', 'message', 'read', 'link']) expect(notices, column).toMatch(new RegExp(`\\n\\s+${column} `));
    const crm = readFileSync(resolve(process.cwd(), 'supabase/migrations/144_crm_hub_schema.sql'), 'utf8');
    const tasks = crm.slice(crm.indexOf('create table if not exists public.crm_tasks (')).split(');')[0];
    for (const column of ['owner_id', 'assigned_to', 'contact_id', 'deal_id', 'title', 'due_date', 'priority', 'status']) expect(tasks, column).toMatch(new RegExp(`\\n\\s+${column} `));
  });
});
