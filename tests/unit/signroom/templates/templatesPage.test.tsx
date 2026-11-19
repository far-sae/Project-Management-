// The templates page: the list and its search, the preview, renaming, deleting, and starting an agreement from one.
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import type { AgreementTemplateSummary } from '../../../../api/_signroom/shared/types';
import { agreement, clientRow, crmCompanies, crmDeals, polyfillDom } from '../agreements/fixtures';
import { fullTemplate, templateRows } from './fixtures';

const sr = vi.hoisted(() => {
  const call = vi.fn();
  // One object for every render: a new one each time would re-run the page's loading effect for ever.
  const state = { client: { call, pdf: vi.fn(), upload: vi.fn() }, workspaceId: 'w' as string | null };
  return { call, state };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
const crm = vi.hoisted(() => ({
  companies: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
  deals: { items: [] as unknown[], loading: false, error: null, refresh: async () => {} },
}));

vi.mock('@/hooks/useSignroom', () => ({ useSignroom: () => sr.state }));
vi.mock('@/hooks/useCrmHub', () => ({ useCrmCompanies: () => crm.companies, useCrmDeals: () => crm.deals }));
vi.mock('@/services/supabase/config', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast }));

import { TemplatesPage } from '@/pages/signroom/Templates';
import { SignroomError } from '@/services/signroom/client';

let rows: AgreementTemplateSummary[];
let role: 'Owner' | 'Member';
type Handler = (body: unknown, method: string | undefined) => unknown;
const serve = (overrides: Record<string, Handler> = {}) => {
  sr.call.mockImplementation(async (path: string, body?: unknown, method?: string) => {
    if (overrides[path]) return overrides[path](body, method);
    if (path === 'templates') return rows;
    if (path === 'session') return { workspace: { id: 'w', name: 'Acme' }, role };
    const one = rows.find((t) => path === `templates/${t.id}`);
    if (one && method === 'DELETE') { rows = rows.filter((t) => t.id !== one.id); return { ok: true }; }
    if (one) return fullTemplate(one);
    const renamed = rows.find((t) => path === `templates/${t.id}/rename`);
    if (renamed) {
      const next = { ...renamed, name: (body as { name: string }).name };
      rows = rows.map((t) => (t.id === next.id ? next : t));
      return next;
    }
    if (path === 'clients/from-company') return clientRow({ id: 'cl-' + (body as { companyId: string }).companyId });
    if (path === 'agreements' && body) return agreement({ id: 'new1', ...(body as object) });
    throw new SignroomError('Not found.', 404);
  });
};

const Editor = () => <div>editor for {useParams().id}</div>;
const renderPage = () => render(
  <MemoryRouter initialEntries={['/crm/templates']}>
    <Routes>
      <Route path="/crm/templates" element={<TemplatesPage />} />
      <Route path="/crm/agreements" element={<div>agreements list</div>} />
      <Route path="/crm/agreements/:id/edit" element={<Editor />} />
    </Routes>
  </MemoryRouter>,
);
const rowOf = (name: string, index = 0) => screen.getAllByRole('button', { name })[index].closest('tr') as HTMLElement;
/** The row of a template, once the list has loaded. */
const listedRow = async (name: string) => {
  await screen.findAllByRole('button', { name });
  return rowOf(name);
};
const names = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('button')[0].textContent);
const openMenu = async (row: HTMLElement) => {
  fireEvent.keyDown(within(row).getByRole('button', { name: /^More actions for/ }), { key: 'Enter' });
  return screen.findByRole('menu');
};
const posted = (path: string) => sr.call.mock.calls.filter((c) => c[0] === path && c[1] !== undefined).map((c) => c[1]);
const deletes = () => sr.call.mock.calls.filter((c) => c[2] === 'DELETE').map((c) => c[0]);
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

beforeAll(polyfillDom);
beforeEach(() => {
  rows = [...templateRows];
  role = 'Owner';
  sr.state.workspaceId = 'w';
  sr.call.mockReset();
  crm.companies.items = crmCompanies;
  crm.deals.items = crmDeals;
  Object.values(toast).forEach((fn) => fn.mockReset());
  serve();
});
afterEach(cleanup);

describe('TemplatesPage', () => {
  it('asks for a workspace and calls nothing while none is selected', () => {
    sr.state.workspaceId = null;
    renderPage();
    expect(screen.getByRole('heading', { name: 'Templates' })).toBeTruthy();
    expect(screen.getByText('Pick a workspace in the sidebar to see its templates. Each template belongs to one workspace.')).toBeTruthy();
    expect(sr.call).not.toHaveBeenCalled();
  });

  it('lists each template with its type, version and the day it was made', async () => {
    renderPage();
    await screen.findAllByRole('button', { name: 'Standard NDA' });
    expect(names()).toEqual(['Retainer', 'Standard NDA', 'Standard NDA']);
    const retainer = rowOf('Retainer');
    expect(retainer.textContent).toContain('Service agreement');
    expect(retainer.textContent).toContain('v1');
    expect(retainer.textContent).toContain('6 Oct 2026');
    // Only the version that has been replaced is marked.
    expect(rowOf('Standard NDA', 0).textContent).toContain('v2');
    expect(rowOf('Standard NDA', 0).textContent).not.toContain('Older version');
    expect(rowOf('Standard NDA', 1).textContent).toContain('Older version');
    expect(screen.getByText('3 templates')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Agreements/ }).getAttribute('href')).toBe('/crm/agreements');
  });

  it('never shows the product’s internal names', async () => {
    renderPage();
    await screen.findAllByRole('button', { name: 'Standard NDA' });
    expect(document.body.textContent).not.toMatch(/signroom|securovix/i);
  });

  it('searches by name or type, and can clear a search that finds nothing', async () => {
    renderPage();
    await screen.findAllByRole('button', { name: 'Standard NDA' });
    const search = screen.getByRole('textbox', { name: 'Search templates' });
    fireEvent.change(search, { target: { value: 'retain' } });
    expect(names()).toEqual(['Retainer']);
    fireEvent.change(search, { target: { value: 'nda' } });
    expect(names()).toEqual(['Standard NDA', 'Standard NDA']);

    fireEvent.change(search, { target: { value: 'lease' } });
    expect(screen.getByText('No templates match your search.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(names()).toHaveLength(3);
  });

  it('explains how to make the first template when there are none', async () => {
    rows = [];
    renderPage();
    expect(await screen.findByText(/No templates yet\./)).toBeTruthy();
    expect(screen.getByText(/open a draft agreement and choose “Save as template”/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open agreements' }).getAttribute('href')).toBe('/crm/agreements');
    expect(screen.queryByRole('textbox', { name: 'Search templates' })).toBeNull();
  });

  it('shows the server’s sentence when the list cannot be loaded, and tries again', async () => {
    serve({ templates: () => { throw new SignroomError('Workspace access was removed.', 403); } });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('Workspace access was removed.');
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Retainer' })).toBeTruthy();
  });

  describe('preview', () => {
    it('shows the template’s text with its signer roles and their fields', async () => {
      renderPage();
      fireEvent.click((await screen.findAllByRole('button', { name: 'Standard NDA' }))[0]);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'Standard NDA' })).toBeTruthy();
      expect(dialog.textContent).toContain('NDA · v2 · Created 5 Oct 2026');
      expect(await within(dialog).findByText(/This agreement is between us and \{\{client_name\}\}\./)).toBeTruthy();
      expect(sr.call).toHaveBeenCalledWith('templates/t2');
      expect(within(dialog).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'ClientSignature, Date signed',
        'Company representativeSignature',
      ]);
      expect(dialog.textContent).toContain('{{client_name}} becomes the company’s name');
    });

    it('opens from the row menu too, and closes', async () => {
      renderPage();
      const menu = await openMenu(await listedRow('Retainer'));
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Preview' }));
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByText(/This agreement is between us/);
      expect(sr.call).toHaveBeenCalledWith('templates/t3');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close preview' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('says so for a template made from an uploaded PDF, which has no text', async () => {
      serve({ 'templates/t3': () => fullTemplate({ ...templateRows[2], sourceKind: 'upload', content: '', pages: [{ width: 595, height: 842 }, { width: 595, height: 842 }], roles: [], fields: [] }) });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Retainer' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('This template uses an uploaded PDF of 2 pages, so there is no text to show here.')).toBeTruthy();
      expect(within(dialog).getByText('No signer roles are saved with this template.')).toBeTruthy();
    });

    it('shows the server’s sentence when the template cannot be opened', async () => {
      serve({ 'templates/t3': () => { throw new SignroomError('Template not found.', 404); } });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Retainer' }));
      const dialog = await screen.findByRole('dialog');
      expect((await within(dialog).findByRole('alert')).textContent).toBe('Template not found.');
    });
  });

  describe('rename', () => {
    const startRename = async () => {
      const menu = await openMenu(await listedRow('Retainer'));
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
      const dialog = await screen.findByRole('dialog');
      return { dialog, input: within(dialog).getByLabelText('Template name') as HTMLInputElement };
    };

    it('sends the new name and shows it in the list', async () => {
      renderPage();
      const { dialog, input } = await startRename();
      expect(input.value).toBe('Retainer');
      fireEvent.change(input, { target: { value: '  Monthly retainer  ' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
      expect(await screen.findByRole('button', { name: 'Monthly retainer' })).toBeTruthy();
      expect(posted('templates/t3/rename')).toEqual([{ name: 'Monthly retainer' }]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(toast.success).toHaveBeenCalledWith('Template renamed.');
      expect(screen.queryByRole('button', { name: 'Retainer' })).toBeNull();
    });

    it('keeps the dialog open with the server’s sentence when the name is taken', async () => {
      serve({ 'templates/t3/rename': () => { throw new SignroomError('A template with that name already exists.', 409); } });
      renderPage();
      const { dialog, input } = await startRename();
      fireEvent.change(input, { target: { value: 'Standard NDA' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
      expect((await within(dialog).findByRole('alert')).textContent).toBe('A template with that name already exists.');
      expect((within(dialog).getByLabelText('Template name') as HTMLInputElement).value).toBe('Standard NDA');
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('makes no call when the name is unchanged', async () => {
      renderPage();
      const { dialog } = await startRename();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(posted('templates/t3/rename')).toEqual([]);
    });
  });

  describe('delete', () => {
    it('lets an owner delete after confirming', async () => {
      renderPage();
      const menu = await openMenu(await listedRow('Retainer'));
      await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-disabled')).not.toBe('true'));
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
      const question = await screen.findByRole('alertdialog');
      expect(question.textContent).toContain('Delete “Retainer”?');
      expect(deletes()).toEqual([]);

      fireEvent.click(within(question).getByRole('button', { name: 'Delete template' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Retainer' })).toBeNull());
      expect(deletes()).toEqual(['templates/t3']);
      expect(sr.call).toHaveBeenCalledWith('templates/t3', undefined, 'DELETE');
      expect(toast.success).toHaveBeenCalledWith('Template deleted.');
      expect(screen.getByText('2 templates')).toBeTruthy();
    });

    it('deletes nothing when the owner keeps the template', async () => {
      renderPage();
      const menu = await openMenu(await listedRow('Retainer'));
      await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-disabled')).not.toBe('true'));
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep template' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(deletes()).toEqual([]);
      expect(screen.getByRole('button', { name: 'Retainer' })).toBeTruthy();
    });

    it('is off for a member, with the reason', async () => {
      role = 'Member';
      renderPage();
      await screen.findByRole('button', { name: 'Retainer' });
      await waitFor(() => expect(sr.call).toHaveBeenCalledWith('session'));
      const menu = await openMenu(rowOf('Retainer'));
      expect((await within(menu).findByRole('menuitem', { name: 'Delete' })).getAttribute('aria-disabled')).toBe('true');
      expect(await within(menu).findByText('Only a workspace owner can delete templates.')).toBeTruthy();
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(deletes()).toEqual([]);
      // Renaming and using a template are open to members.
      expect(within(menu).getByRole('menuitem', { name: 'Rename' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('shows the server’s sentence and keeps the row when the delete is refused', async () => {
      serve({ 'templates/t3': (_body, method) => {
        if (method === 'DELETE') throw new SignroomError('Only the workspace owner can delete templates.', 403);
        return fullTemplate(templateRows[2]);
      } });
      renderPage();
      const menu = await openMenu(await listedRow('Retainer'));
      await waitFor(() => expect(within(menu).getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-disabled')).not.toBe('true'));
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete template' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only the workspace owner can delete templates.'));
      expect(screen.getByRole('button', { name: 'Retainer' })).toBeTruthy();
    });
  });

  describe('use template', () => {
    it('opens the new agreement dialog with the template and its type already chosen', async () => {
      renderPage();
      await screen.findByRole('button', { name: 'Retainer' });
      fireEvent.click(within(rowOf('Retainer')).getByRole('button', { name: 'Use template' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'New agreement' })).toBeTruthy();
      expect(within(dialog).getByRole('radio', { name: /^Service agreement/ }).getAttribute('aria-checked')).toBe('true');
      expect(within(dialog).getByRole('combobox', { name: 'Starting point' }).textContent).toContain('Retainer · v1');

      choose('Company', 'Harbour Dental');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Service agreement' }));
      expect(await screen.findByText('editor for new1')).toBeTruthy();
      expect(posted('agreements')).toEqual([{
        clientId: 'cl-c2', type: 'Service agreement', title: undefined, templateId: 't3', dealId: undefined,
      }]);
    });

    it('can start from an older version, and from the preview', async () => {
      renderPage();
      fireEvent.click((await screen.findAllByRole('button', { name: 'Standard NDA' }))[1]);
      const preview = await screen.findByRole('dialog');
      await within(preview).findByText(/This agreement is between us/);
      fireEvent.click(within(preview).getByRole('button', { name: 'Use template' }));
      const dialog = await screen.findByRole('heading', { name: 'New agreement' }).then((h) => h.closest('[role="dialog"]') as HTMLElement);
      expect(within(dialog).getByRole('radio', { name: /^NDA/ }).getAttribute('aria-checked')).toBe('true');
      expect(within(dialog).getByRole('combobox', { name: 'Starting point' }).textContent).toContain('Standard NDA · v1');
    });
  });
});
