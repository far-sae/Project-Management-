// The set-up check: which database files have been run, and whether calling has its settings.
import React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SETUP_PARTS, probeState } from '@/lib/crmSetup';

type Reply = { error: null | { code?: string; message?: string } };

const h = vi.hoisted(() => ({
  /** What the database answers for each table, `table.column` or function. Nothing here = no error. */
  errors: {} as Record<string, { code?: string; message?: string }>,
  asked: [] as string[],
  voiceSetup: vi.fn(),
}));

vi.mock('@/services/supabase/config', () => {
  const reply = (key: string): Promise<Reply> => {
    h.asked.push(key);
    return Promise.resolve({ error: h.errors[key] ?? null });
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: (columns: string) => ({ limit: () => reply(columns === '*' ? table : `${table}.${columns}`) }),
      }),
      rpc: (name: string) => reply(name),
    },
  };
});
vi.mock('@/services/voice/client', () => ({ voiceSetup: h.voiceSetup, forgetVoiceSetup: vi.fn() }));
vi.mock('@/context/AuthContext', () => {
  const value = { user: { userId: '0c000000-0000-4000-8000-000000000001' } };
  return { useAuth: () => value };
});
vi.mock('@/context/OrganizationContext', () => {
  const value = { isOwner: true, organization: { organizationId: '0b000000-0000-4000-8000-000000000001' } };
  return { useOrganization: () => value };
});

import { runSetupCheck } from '@/services/supabase/crmHub/setupCheck';
import { SetupCheck } from '@/components/crmHub/SetupCheck';

const READY_CALLING = { configured: true, ready: true, problem: null, numbers: { US: true, GB: false } };

beforeEach(() => {
  h.errors = {};
  h.asked.length = 0;
  h.voiceSetup.mockReset().mockResolvedValue(READY_CALLING);
});
afterEach(cleanup);

describe('reading the answer of the database', () => {
  it('knows a table that is there from one that is not', () => {
    const probe = { kind: 'table', table: 'crm_calls' } as const;
    expect(probeState(probe, null)).toBe('ready');
    expect(probeState(probe, { code: '42P01', message: 'relation "public.crm_calls" does not exist' })).toBe('missing');
    expect(probeState(probe, { code: 'PGRST205', message: "Could not find the table 'public.crm_calls' in the schema cache" })).toBe('missing');
    // Not allowed to read it means it is there.
    expect(probeState(probe, { code: '42501', message: 'permission denied for table crm_calls' })).toBe('ready');
  });

  it('knows a column that is there from one that is not', () => {
    const probe = { kind: 'column', table: 'crm_tasks', column: 'kind' } as const;
    expect(probeState(probe, null)).toBe('ready');
    expect(probeState(probe, { code: '42703', message: 'column crm_tasks.kind does not exist' })).toBe('missing');
    expect(probeState(probe, { code: 'PGRST204', message: "Could not find the 'kind' column" })).toBe('missing');
  });

  it('knows a function that is there, because it answers, even with a refusal', () => {
    const probe = { kind: 'function', name: 'crm_merge_contacts', args: {} } as const;
    expect(probeState(probe, { code: 'P0001', message: 'Choose two different leads.' })).toBe('ready');
    expect(probeState(probe, null)).toBe('ready');
    expect(probeState(probe, { code: 'PGRST202', message: 'Could not find the function public.crm_merge_contacts' })).toBe('missing');
    expect(probeState(probe, { code: '42883', message: 'function does not exist' })).toBe('missing');
  });

  it('does not guess when the answer says nothing about it', () => {
    expect(probeState({ kind: 'table', table: 'crm_calls' }, { message: 'Failed to fetch' })).toBe('unknown');
    expect(probeState({ kind: 'table', table: 'crm_calls' }, { code: 'PGRST301', message: 'JWT expired' })).toBe('unknown');
    expect(probeState({ kind: 'none' }, null)).toBe('unknown');
  });
});

describe('the list of parts', () => {
  const sql = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8').replace(/\s+/g, ' ');

  it('names database files that exist, each once', () => {
    for (const part of SETUP_PARTS) expect(existsSync(resolve(process.cwd(), 'supabase/migrations', part.file)), part.file).toBe(true);
    expect(new Set(SETUP_PARTS.map((p) => p.file)).size).toBe(SETUP_PARTS.length);
    expect(new Set(SETUP_PARTS.map((p) => p.id)).size).toBe(SETUP_PARTS.length);
  });

  it('looks for something that the named file really makes', () => {
    for (const part of SETUP_PARTS) {
      const text = sql(part.file);
      if (part.probe.kind === 'table') expect(text, part.file).toContain(`create table if not exists public.${part.probe.table} (`);
      if (part.probe.kind === 'column') {
        expect(text, part.file).toContain(`alter table public.${part.probe.table} add column if not exists ${part.probe.column} `);
      }
      if (part.probe.kind === 'function') expect(text, part.file).toContain(`create or replace function public.${part.probe.name}(`);
    }
  });

  it('checks the merge function in a way that changes nothing', () => {
    const merge = SETUP_PARTS.find((p) => p.probe.kind === 'function');
    expect(merge?.probe).toEqual({ kind: 'function', name: 'crm_merge_contacts', args: { p_keep: null, p_drop: null } });
    // The function refuses two empty leads before it touches anything.
    const text = sql('193_crm_merge_leads.sql');
    expect(text.indexOf('if p_keep is null or p_drop is null')).toBeGreaterThan(-1);
    expect(text.indexOf('if p_keep is null or p_drop is null')).toBeLessThan(text.indexOf('delete from public.crm_contacts'));
  });
});

describe('running the check', () => {
  it('asks once for every part that can be checked, and reads each answer', async () => {
    h.errors = {
      crm_lead_forms: { code: 'PGRST205', message: 'Could not find the table' },
      'crm_tasks.kind': { code: '42703', message: 'column crm_tasks.kind does not exist' },
      crm_merge_contacts: { code: 'P0001', message: 'Choose two different leads.' },
      auto_rules: { message: 'Failed to fetch' },
    };
    const result = await runSetupCheck();
    expect(result).toMatchObject({
      calls: 'ready', forms: 'missing', followUps: 'missing', merge: 'ready', automation: 'unknown', emailTimeline: 'unknown',
    });
    expect(h.asked.sort()).toEqual(['auto_rules', 'crm_calls', 'crm_deals.line_items', 'crm_erase_person', 'crm_field_defs', 'crm_lead_forms', 'crm_lead_forms.share_with', 'crm_merge_contacts', 'crm_rules', 'crm_saved_views', 'crm_tasks.kind', 'crm_trash', 'crm_visibility', 'email_warmup_keys', 'social_content.post_group_id']);
  });
});

describe('Set-up check', () => {
  const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

  it('says what is ready, and which file to run for what is not', async () => {
    h.errors = { crm_lead_forms: { code: 'PGRST205', message: 'Could not find the table' } };
    render(<SetupCheck />);
    expect(await within(row('Web forms')).findByText('Not set up')).toBeTruthy();
    expect(row('Web forms').textContent).toContain('192_crm_lead_forms.sql');
    expect(within(row('Calling')).getByText('Ready')).toBeTruthy();
    expect(row('Calling').textContent).not.toContain('188_crm_calls.sql');
    expect(screen.getByText('1 part is not set up yet.')).toBeTruthy();
  });

  it('is honest about the parts it cannot see', async () => {
    render(<SetupCheck />);
    expect(await within(row('Emails on the lead’s timeline')).findByText('Cannot check')).toBeTruthy();
    expect(row('Emails on the lead’s timeline').textContent).toContain('190_email_on_lead_timeline.sql');
    expect(await screen.findByText('Everything that can be checked is set up.')).toBeTruthy();
  });

  it('shows what calling still needs on the server', async () => {
    h.voiceSetup.mockResolvedValue({ configured: true, ready: false, problem: 'TWILIO_NUMBER_UK is not set.', numbers: { US: true, GB: false } });
    render(<SetupCheck />);
    expect(await within(row('Phone provider settings')).findByText('Not ready')).toBeTruthy();
    expect(row('Phone provider settings').textContent).toContain('TWILIO_NUMBER_UK is not set.');
  });

  it('tells the owner how to keep calling to their own organisation', async () => {
    render(<SetupCheck />);
    await within(row('Phone provider settings')).findByText('Ready');
    expect(row('Phone provider settings').textContent).toContain('TWILIO_ALLOWED_ORGS');
    expect(row('Phone provider settings').textContent).toContain('0b000000-0000-4000-8000-000000000001');
  });

  it('tells the owner how to keep this page and the set-up messages to themselves', async () => {
    render(<SetupCheck />);
    const note = await screen.findByText(/The owner of every organisation on the site can see this page/);
    expect(note.textContent).toContain('VITE_APP_OWNER_USER_IDS');
    expect(note.textContent).toContain('0c000000-0000-4000-8000-000000000001');
  });

  it('tells the owner the two settings for finding leads, with the value to paste', async () => {
    render(<SetupCheck />);
    await screen.findByText('Phone provider settings');
    const text = row('Find leads settings').textContent ?? '';
    expect(text).toContain('APOLLO_API_KEY');
    expect(text).toContain('APOLLO_ALLOWED_ORGS');
    expect(text).toContain('0b000000-0000-4000-8000-000000000001');
  });

  it('says when no phone provider is set at all', async () => {
    h.voiceSetup.mockResolvedValue({ configured: false, ready: false, problem: null, numbers: { US: false, GB: false } });
    render(<SetupCheck />);
    expect(await within(row('Phone provider settings')).findByText('Not set up')).toBeTruthy();
    expect(row('Phone provider settings').textContent).toContain('TWILIO_');
  });

  it('checks again when asked', async () => {
    h.errors = { crm_calls: { code: '42P01', message: 'relation does not exist' } };
    render(<SetupCheck />);
    expect(await within(row('Calling')).findByText('Not set up')).toBeTruthy();
    h.errors = {};
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(within(row('Calling')).getByText('Ready')).toBeTruthy());
    expect(h.voiceSetup).toHaveBeenCalledTimes(2);
  });
});
