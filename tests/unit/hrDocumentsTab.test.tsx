// HR documents tab: a table of every employee's documents with filters, an
// upload dialog and a confirmed delete. The documents come in as the `docs`
// prop; "today" is pinned to Wednesday 18 November 2026.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast: h.toast }));

import { HrDocumentsTab } from '@/components/hr/HrDocumentsTab';
import type { HrPerson } from '@/components/hr/types';
import type { UseEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import { HR_DOCUMENT_MAX_BYTES, type EmployeeDocument } from '@/services/supabase/hrDocuments';

const NOW = new Date(2026, 10, 18, 10, 0, 0);

const PEOPLE: HrPerson[] = [
  { userId: 'ana', displayName: 'Ana', email: 'a@x.io', profile: null },
  { userId: 'bob', displayName: 'Bob', email: 'b@x.io', profile: null },
];

const doc = (id: string, over: Partial<EmployeeDocument>): EmployeeDocument => ({
  id,
  organizationId: 'o1',
  userId: 'ana',
  title: `Doc ${id}`,
  category: 'contract',
  fileName: `${id}.pdf`,
  filePath: `o1/ana/${id}.pdf`,
  fileSize: 1024,
  fileType: 'application/pdf',
  expiresOn: null,
  uploadedBy: 'ana',
  createdAt: new Date(2026, 0, 5, 10, 0, 0),
  ...over,
});

const DOCUMENTS: EmployeeDocument[] = [
  doc('d1', {
    title: 'Employment contract', fileName: 'ana-contract.pdf', userId: 'ana', category: 'contract',
    fileSize: 2 * 1024 * 1024,
  }),
  doc('d2', {
    title: 'Work visa', fileName: 'visa_scan.jpg', userId: 'bob', category: 'id', expiresOn: '2026-12-02',
    createdAt: new Date(2026, 9, 30, 9, 0, 0),
  }),
  doc('d3', {
    title: 'First aid certificate', fileName: 'first-aid.pdf', userId: 'gone', category: 'certificate',
    expiresOn: '2026-11-01',
  }),
  doc('d4', { title: 'Passport', fileName: 'passport.png', userId: 'bob', category: 'id', expiresOn: '2031-06-30' }),
];

const makeDocs = (over: Partial<UseEmployeeDocuments> = {}): UseEmployeeDocuments => ({
  documents: DOCUMENTS,
  loading: false,
  setupMissing: false,
  error: null,
  refresh: vi.fn(),
  upload: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const renderTab = (docs: UseEmployeeDocuments = makeDocs(), people: HrPerson[] = PEOPLE) => {
  render(<HrDocumentsTab people={people} docs={docs} />);
  return docs;
};

const fileOfSize = (name: string, size: number): File => {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

/** Table rows without the header row. */
const bodyRows = () => screen.getAllByRole('row').slice(1);
const rowWith = (text: string) => bodyRows().find((r) => within(r).queryByText(text))!;
const titles = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0].querySelector('p')?.textContent);

/** Pick an option in a Select the way a keyboard user does. */
const choose = (trigger: HTMLElement, option: string) => {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: option }));
};

const openUpload = () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Upload document' })[0]);
  return screen.getByRole('dialog');
};

beforeAll(() => {
  // jsdom lacks these; the Select needs them to open.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HR documents tab', () => {
  it('shows only the setup notice until the database update has been run', () => {
    const docs = renderTab(makeDocs({ setupMissing: true, documents: [] }));
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeTruthy();
    expect(screen.getByText(/one-time database update/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Upload document' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByLabelText('Search documents')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(docs.refresh).toHaveBeenCalled();
  });

  it('offers to try again when the documents could not be loaded', () => {
    const docs = renderTab(makeDocs({ error: 'Could not load documents.', documents: [] }));
    expect(screen.getByRole('alert').textContent).toContain('Could not load documents.');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(docs.refresh).toHaveBeenCalled();
  });

  it('shows a spinner while loading', () => {
    renderTab(makeDocs({ loading: true, documents: [] }));
    expect(screen.getByLabelText('Loading documents')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lists every document with its employee, category, dates and size', () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Document', 'Employee', 'Category', 'Expires', 'Uploaded', 'Size', 'Actions',
    ]);
    expect(bodyRows()).toHaveLength(4);

    const contract = within(rowWith('Employment contract')).getAllByRole('cell');
    expect(contract[0].textContent).toContain('ana-contract.pdf');
    expect(contract[1].textContent).toContain('Ana');
    expect(contract[2].textContent).toBe('Contract');
    expect(contract[3].textContent).toBe('—');
    expect(contract[4].textContent).toBe('5 Jan 2026');
    expect(contract[5].textContent).toBe('2 MB');

    const visa = within(rowWith('Work visa')).getAllByRole('cell');
    expect(visa[1].textContent).toContain('Bob');
    expect(visa[2].textContent).toBe('ID');
    expect(visa[4].textContent).toBe('30 Oct 2026');

    expect(within(rowWith('First aid certificate')).getByText('Former member')).toBeTruthy();
  });

  it('flags documents that have expired or expire within 30 days', () => {
    renderTab();
    const visa = rowWith('Work visa');
    expect(within(visa).getByText('2 Dec 2026')).toBeTruthy();
    expect(within(visa).getByText('In 14 days').getAttribute('data-tone')).toBe('warning');

    const firstAid = rowWith('First aid certificate');
    expect(within(firstAid).getByText('1 Nov 2026')).toBeTruthy();
    expect(within(firstAid).getByText('Expired').getAttribute('data-tone')).toBe('danger');

    const passport = rowWith('Passport');
    expect(within(passport).getByText('30 Jun 2031')).toBeTruthy();
    expect(passport.querySelector('[data-tone]')).toBeNull();
  });

  it('searches by title or file name', () => {
    renderTab();
    const search = screen.getByLabelText('Search documents');
    fireEvent.change(search, { target: { value: 'visa' } });
    expect(titles()).toEqual(['Work visa']);
    fireEvent.change(search, { target: { value: 'PASSPORT.png' } });
    expect(titles()).toEqual(['Passport']);
  });

  it('says when nothing matches, and can clear the filters', () => {
    renderTab();
    fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'payslip' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(bodyRows()).toHaveLength(4);
    expect((screen.getByLabelText('Search documents') as HTMLInputElement).value).toBe('');
  });

  it('filters by employee and by category', () => {
    renderTab();
    choose(screen.getByRole('combobox', { name: 'Employee' }), 'Bob');
    expect(titles()).toEqual(['Work visa', 'Passport']);
    choose(screen.getByRole('combobox', { name: 'Category' }), 'Contract');
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
    choose(screen.getByRole('combobox', { name: 'Employee' }), 'Everyone');
    expect(titles()).toEqual(['Employment contract']);
    choose(screen.getByRole('combobox', { name: 'Category' }), 'All categories');
    expect(bodyRows()).toHaveLength(4);
  });

  it('invites the first upload when there are no documents yet', () => {
    renderTab(makeDocs({ documents: [] }));
    expect(screen.getByText('No documents yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Upload document' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload document' })[1]);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens a document', () => {
    const docs = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Open Work visa' }));
    expect(docs.open).toHaveBeenCalledWith(DOCUMENTS[1]);
  });

  it('says so when a document could not be opened', async () => {
    const open = vi.fn().mockRejectedValue(new Error('Link expired'));
    renderTab(makeDocs({ open }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Work visa' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Link expired'));
  });

  it('asks before deleting a document', async () => {
    const docs = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work visa' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toContain('Work visa');
    expect(docs.remove).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(docs.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Work visa' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    expect(docs.remove).toHaveBeenCalledTimes(1);
    expect(docs.remove).toHaveBeenCalledWith(DOCUMENTS[1]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the confirmation open when deleting fails', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('No connection'));
    renderTab(makeDocs({ remove }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Work visa' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('No connection'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('uploads a document for the chosen employee', async () => {
    const docs = renderTab();
    const dialog = openUpload();
    const file = fileOfSize('Passport scan.pdf', 2048);

    choose(within(dialog).getByRole('combobox', { name: 'Employee' }), 'Bob');
    choose(within(dialog).getByRole('combobox', { name: 'Category' }), 'ID');
    fireEvent.change(within(dialog).getByLabelText(/^Expiry date/), { target: { value: '2030-05-01' } });
    fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    expect(docs.upload).toHaveBeenCalledTimes(1);
    expect(docs.upload).toHaveBeenCalledWith({
      userId: 'bob',
      title: 'Passport scan',
      category: 'id',
      expiresOn: '2030-05-01',
      file,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the typed title, and sends no expiry date when none is given', async () => {
    const docs = renderTab();
    const dialog = openUpload();
    const file = fileOfSize('scan_0042.pdf', 2048);

    choose(within(dialog).getByRole('combobox', { name: 'Employee' }), 'Ana');
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: ' Offer letter ' } });
    fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(docs.upload).toHaveBeenCalledTimes(1));
    expect(docs.upload).toHaveBeenCalledWith({
      userId: 'ana',
      title: 'Offer letter',
      category: 'other',
      expiresOn: null,
      file,
    });
  });

  it('starts the upload on the employee the table is filtered to', async () => {
    const docs = renderTab();
    choose(screen.getByRole('combobox', { name: 'Employee' }), 'Bob');
    const dialog = openUpload();
    const file = fileOfSize('letter.pdf', 2048);
    fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(docs.upload).toHaveBeenCalledTimes(1));
    expect(vi.mocked(docs.upload).mock.calls[0][0].userId).toBe('bob');
  });

  it('needs an employee and a file before it saves', () => {
    const docs = renderTab();
    const dialog = openUpload();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getAllByRole('alert').map((a) => a.textContent)).toEqual([
      'Choose an employee.',
      'Choose a file.',
    ]);
    expect(docs.upload).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('refuses a file over 25 MB', () => {
    const docs = renderTab();
    const dialog = openUpload();
    choose(within(dialog).getByRole('combobox', { name: 'Employee' }), 'Bob');
    fireEvent.change(within(dialog).getByLabelText('File'), {
      target: { files: [fileOfSize('video.mov', HR_DOCUMENT_MAX_BYTES + 1)] },
    });
    expect(within(dialog).getByRole('alert').textContent).toBe('That file is larger than 25 MB.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(docs.upload).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows "Uploading…" and blocks a second save while the file is on its way', async () => {
    let finish: () => void = () => {};
    const upload = vi.fn(() => new Promise<never>((resolve) => { finish = () => resolve(undefined as never); }));
    renderTab(makeDocs({ upload: upload as unknown as UseEmployeeDocuments['upload'] }));
    const dialog = openUpload();
    choose(within(dialog).getByRole('combobox', { name: 'Employee' }), 'Bob');
    fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [fileOfSize('a.pdf', 10)] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const busy = (await within(dialog).findByRole('button', { name: 'Uploading…' })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(upload).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open when the upload fails', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('Bucket is full'));
    renderTab(makeDocs({ upload }));
    const dialog = openUpload();
    choose(within(dialog).getByRole('combobox', { name: 'Employee' }), 'Bob');
    fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [fileOfSize('a.pdf', 10)] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Bucket is full'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
