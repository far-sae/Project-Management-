// The runs list: status chips with counts, search by name, and each row opening its run.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import type { RunSummary } from '../../../../api/_automation/shared/types';
import { NOW, polyfillDom, runSummary, runs } from './fixtures';

const auto = vi.hoisted(() => {
  const call = vi.fn();
  // One object for every render: a new one each time would re-run the loading effect for ever.
  return { call, state: { client: { call }, workspaceId: 'w' as string | null, workspaceName: 'Studio' } };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@/hooks/useAutomation', () => ({ useAutomation: () => auto.state }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));

import { AutomationRunsPage } from '@/pages/automation/Runs';
import { AutomationError } from '@/services/automation/client';
import { dateTime } from '@/lib/automation/format';

let list: RunSummary[];
const serve = (overrides: Record<string, () => unknown> = {}) => {
  auto.call.mockImplementation(async (path: string) => {
    if (overrides[path]) return overrides[path]();
    if (path === 'runs') return list;
    const status = /^runs\?status=(\w+)$/.exec(path);
    if (status) return list.filter((r) => r.status === status[1]);
    throw new AutomationError('Not found.', 404);
  });
};

const OneRun = () => <div>run {useParams().id}</div>;
const open = (at = '/crm/automation/runs') => render(
  <MemoryRouter initialEntries={[at]}>
    <Routes>
      <Route path="/crm/automation/runs" element={<AutomationRunsPage />} />
      <Route path="/crm/automation/runs/:id" element={<OneRun />} />
    </Routes>
  </MemoryRouter>,
);
const table = () => within(screen.getByRole('region', { name: 'Runs' }));
const ready = () => screen.findByRole('region', { name: 'Runs' });
const chips = () => within(screen.getByRole('group', { name: 'Filter by status' }));
const names = () => table().getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]!.textContent);
const paths = () => auto.call.mock.calls.map((c) => c[0] as string);

beforeAll(polyfillDom);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  list = [...runs];
  auto.state.workspaceId = 'w';
  auto.call.mockReset();
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Automation runs', () => {
  it('asks for a workspace, and calls nothing, while none is selected', async () => {
    auto.state.workspaceId = null;
    open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Runs');
    expect(screen.getByText('Pick a workspace in the sidebar to see its runs.')).toBeTruthy();
    await Promise.resolve();
    expect(auto.call).not.toHaveBeenCalled();
  });

  it('lists every run with its automation, status, result, steps and times', async () => {
    open();
    await ready();
    expect(paths()).toEqual(['runs']);
    expect(table().getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Who', 'Automation', 'Status', 'Result', 'Steps', 'Started', 'Last change',
    ]);
    expect(names()).toEqual(['Northwind Studio', 'Harbour Dental', 'Fieldway Logistics', 'Jon Petrov']);

    const harbour = within(table().getByRole('link', { name: 'Harbour Dental' }).closest('tr') as HTMLElement);
    expect(table().getByRole('link', { name: 'Harbour Dental' }).getAttribute('href')).toBe('/crm/automation/runs/r2');
    expect(harbour.getByText('New lead to project')).toBeTruthy();
    expect(harbour.getByText('Needs approval').getAttribute('data-tone')).toBe('warning');
    expect(harbour.getByText('Stopped at step 3: waiting for approval')).toBeTruthy();
    expect(harbour.getByText('2 of 6')).toBeTruthy();
    expect(harbour.getByText(dateTime(runs[1]!.started))).toBeTruthy();
    expect(harbour.getByText('2 hours ago')).toBeTruthy();

    const jon = within(table().getByRole('link', { name: 'Jon Petrov' }).closest('tr') as HTMLElement);
    expect(jon.getByText('Trade show leads')).toBeTruthy();
    expect(jon.getByText('Stopped').getAttribute('data-tone')).toBe('muted');
    expect(jon.getByText('2 of 4')).toBeTruthy();
    expect(screen.getByText('4 runs')).toBeTruthy();
  });

  it('has a chip per status with its count, and asks the server for the one chosen', async () => {
    open();
    await ready();
    expect(chips().getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All 4', 'Running 0', 'Waiting 1', 'Needs approval 1', 'Finished 1', 'Stopped 1', 'Failed 0',
    ]);
    expect(chips().getByRole('button', { name: 'All 4' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(chips().getByRole('button', { name: 'Needs approval 1' }));
    await waitFor(() => expect(paths()).toEqual(['runs', 'runs?status=needs_approval']));
    expect(names()).toEqual(['Harbour Dental']);
    expect(chips().getByRole('button', { name: 'Needs approval 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 run')).toBeTruthy();

    fireEvent.click(chips().getByRole('button', { name: 'All 4' }));
    expect(names()).toHaveLength(4);
  });

  it('shows everything the server has in one status, even runs older than the newest hundred', async () => {
    const old = runSummary({ id: 'r9', subject: 'Old Mill', status: 'stopped', result: 'Stopped by Sam' });
    serve({ 'runs?status=stopped': () => [runs[3]!, old] });
    open();
    await ready();
    fireEvent.click(chips().getByRole('button', { name: 'Stopped 1' }));
    expect(await table().findByRole('link', { name: 'Old Mill' })).toBeTruthy();
    expect(names()).toEqual(['Jon Petrov', 'Old Mill']);
    expect(chips().getByRole('button', { name: 'Stopped 2' })).toBeTruthy();
  });

  it('starts on the status named in the address', async () => {
    open('/crm/automation/runs?status=stopped');
    await ready();
    await waitFor(() => expect(paths().sort()).toEqual(['runs', 'runs?status=stopped']));
    expect(names()).toEqual(['Jon Petrov']);
    expect(chips().getByRole('button', { name: 'Stopped 1' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('searches by name, and can clear a search that finds nothing', async () => {
    open();
    await ready();
    const search = screen.getByRole('textbox', { name: 'Search runs by name' });
    fireEvent.change(search, { target: { value: 'harb' } });
    expect(names()).toEqual(['Harbour Dental']);
    fireEvent.change(search, { target: { value: 'trade show' } });
    expect(names()).toEqual(['Jon Petrov']);

    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(screen.getByText('No runs match these filters.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(names()).toHaveLength(4);
  });

  it('opens the run from anywhere on its row', async () => {
    open();
    await ready();
    fireEvent.click(table().getByText('Follow-up created for Thursday'));
    expect(await screen.findByText('run r3')).toBeTruthy();
  });

  it('says when a run starts while there are none', async () => {
    list = [];
    open();
    expect(await screen.findByText('No runs yet. A run starts when a lead is added in this workspace.')).toBeTruthy();
    expect(chips().getByRole('button', { name: 'All 0' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('shows placeholders while loading', () => {
    auto.call.mockImplementation(() => new Promise(() => {}));
    open();
    expect(screen.getByRole('status', { name: 'Loading the runs' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Runs');
  });

  it('shows the server’s sentence when the list cannot be read, and tries again', async () => {
    serve({ runs: () => { throw new AutomationError('Choose a workspace.', 403); } });
    open();
    expect((await screen.findByRole('alert')).textContent).toBe('Choose a workspace.');
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await ready()).toBeTruthy();
  });

  it('says quietly what is missing when the server answers 503', async () => {
    serve({ runs: () => { throw new AutomationError('Automation is not ready yet: ANTHROPIC_API_KEY is missing.', 503); } });
    open();
    const note = await screen.findByText('Automation is not ready yet: ANTHROPIC_API_KEY is missing.');
    expect(note.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads the list again on Refresh', async () => {
    open();
    await ready();
    list = [runSummary({ id: 'r7', subject: 'Brightside Bakery', status: 'running', result: 'Researching the lead' }), ...runs];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await table().findByRole('link', { name: 'Brightside Bakery' })).toBeTruthy();
    expect(chips().getByRole('button', { name: 'Running 1' })).toBeTruthy();
    expect(paths()).toEqual(['runs', 'runs']);
  });
});
