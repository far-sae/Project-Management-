// HR › Leave tab: the owner records time off for anyone, approves or rejects
// requests, sets yearly allowances and keeps the list of public holidays.
// Everything comes from the `leave` prop, so the tests hand in a fake one.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { HrLeaveTab } from '@/components/hr/HrLeaveTab';
import type { HrPerson } from '@/components/hr/types';
import type { UseLeave } from '@/hooks/useLeave';
import type { LeaveRequest, PublicHoliday } from '@/services/supabase/leave';

const people: HrPerson[] = [
  { userId: 'ana', displayName: 'Ana', email: 'a@x.io', role: 'owner', profile: null },
  { userId: 'bob', displayName: 'Bob', email: 'b@x.io', role: 'member', profile: null },
];

const request = (o: Partial<LeaveRequest> & Pick<LeaveRequest, 'id' | 'startDate' | 'endDate'>): LeaveRequest => ({
  organizationId: 'o1',
  userId: 'ana',
  leaveType: 'annual',
  days: 1,
  halfDay: false,
  reason: null,
  status: 'approved',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  createdBy: 'ana',
  createdAt: new Date('2026-11-01T09:00:00Z'),
  ...o,
});

// "Today" is Wednesday 18 November 2026.
const requests: LeaveRequest[] = [
  request({ id: 'r-sick', userId: 'bob', leaveType: 'sick', startDate: '2026-03-02', endDate: '2026-03-03', days: 2 }),
  request({
    id: 'r-pending', userId: 'bob', startDate: '2026-11-23', endDate: '2026-11-25', days: 3,
    status: 'pending', reason: 'Family trip',
  }),
  request({ id: 'r-today', startDate: '2026-11-17', endDate: '2026-11-19', days: 3 }),
  request({ id: 'r-half', startDate: '2026-12-01', endDate: '2026-12-01', days: 0.5, halfDay: true }),
  request({ id: 'r-bob-soon', userId: 'bob', startDate: '2026-11-30', endDate: '2026-11-30', days: 1 }),
  request({
    id: 'r-rejected', leaveType: 'unpaid', startDate: '2026-08-03', endDate: '2026-08-04', days: 2,
    status: 'rejected', reason: 'Moving house', decisionNote: 'Busy week',
  }),
];

const holidays: PublicHoliday[] = [
  { id: 'h-xmas', date: '2026-12-25', name: 'Christmas Day' },
  { id: 'h-ny', date: '2026-01-01', name: 'New Year’s Day' },
  { id: 'h-ny27', date: '2027-01-01', name: 'New Year 2027' },
];

function makeLeave(over: Partial<UseLeave> = {}): UseLeave {
  const hs = over.holidays ?? holidays;
  return {
    requests,
    allowances: [],
    holidays: hs,
    holidayDates: hs.map((h) => h.date),
    allowanceFor: (userId: string) => ({ userId, annualDays: 20, sickDays: 10 }),
    loading: false,
    setupMissing: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({}),
    decide: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue(undefined),
    saveAllowance: vi.fn().mockResolvedValue(undefined),
    addHoliday: vi.fn().mockResolvedValue({}),
    removeHoliday: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as UseLeave;
}

const renderTab = (over: Partial<UseLeave> = {}, who: HrPerson[] = people) => {
  const leave = makeLeave(over);
  render(<HrLeaveTab people={who} leave={leave} />);
  return leave;
};

/** The value shown under a label in the figures strip. */
const figure = (label: string) =>
  screen.getByText(label).parentElement!.querySelector('dd')!.textContent;

/** The table row that holds this text. */
const rowWith = (text: string | RegExp) =>
  screen.getAllByRole('row').find((r) => within(r).queryByText(text))!;

const openSection = (name: RegExp) => {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
};

/** Pick an option in one of the dropdowns. */
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

const setValue = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const button = (name: string | RegExp, within_: HTMLElement = document.body) =>
  within(within_).getByRole('button', { name }) as HTMLButtonElement;

beforeAll(() => {
  // The dropdowns (Radix Select) need a few browser APIs jsdom leaves out.
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 12, 0, 0));
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HR leave tab: states', () => {
  it('shows only the setup notice until the database update has been run', () => {
    const leave = renderTab({ setupMissing: true });
    expect(screen.getByRole('heading', { level: 1, name: 'Leave' })).toBeTruthy();
    expect(screen.getByText(/one-time database update/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add leave' })).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(button('Check again'));
    expect(leave.refresh).toHaveBeenCalled();
  });

  it('shows a loading error with a way to try again', () => {
    const leave = renderTab({ error: 'Could not load leave.' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load leave.');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(button('Retry'));
    expect(leave.refresh).toHaveBeenCalled();
  });

  it('shows a spinner while leave is loading', () => {
    renderTab({ loading: true, requests: [] });
    expect(screen.getByLabelText('Loading leave')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('has the page title, description and the two header buttons', () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Leave' })).toBeTruthy();
    expect(screen.getByText('Time off requests, yearly balances and public holidays.')).toBeTruthy();
    expect(button('Add leave')).toBeTruthy();
    expect(button('Add holiday')).toBeTruthy();
  });

  it('shows the four headline figures', () => {
    renderTab();
    expect(figure('Pending requests')).toBe('1');
    expect(figure('On leave today')).toBe('1');
    expect(figure('Off in the next 14 days')).toBe('2');
    expect(figure('Public holidays this year')).toBe('2');
  });

  it('has three sections with their counts', () => {
    renderTab();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Requests6',
      'Balances2',
      'Public holidays2',
    ]);
    expect(screen.getByRole('tab', { name: /Requests/ }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('HR leave tab: requests', () => {
  it('lists pending requests first, then the newest start date', () => {
    renderTab();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual([
      '23 Nov – 25 Nov 2026',
      '1 Dec 2026Half day',
      '30 Nov 2026',
      '17 Nov – 19 Nov 2026',
      '3 Aug – 4 Aug 2026',
      '2 Mar – 3 Mar 2026',
    ]);
  });

  it('shows who, what kind, how many days, the status and the reason', () => {
    renderTab();
    const pending = rowWith('23 Nov – 25 Nov 2026');
    const cells = within(pending).getAllByRole('cell');
    expect(within(cells[0]).getByText('Bob')).toBeTruthy();
    expect(cells[1].textContent).toBe('Annual leave');
    expect(cells[3].textContent).toBe('3');
    expect(within(pending).getByText('Pending').getAttribute('data-tone')).toBe('warning');
    expect(within(pending).getByText('Family trip').getAttribute('title')).toBe('Family trip');

    const rejected = rowWith('3 Aug – 4 Aug 2026');
    expect(within(rejected).getByText('Unpaid leave')).toBeTruthy();
    expect(within(rejected).getByText('Rejected').getAttribute('data-tone')).toBe('danger');
    expect(within(rejected).getByText(/Busy week/)).toBeTruthy();

    const half = rowWith('1 Dec 2026');
    expect(within(half).getByText('Half day')).toBeTruthy();
    expect(within(half).getAllByRole('cell')[3].textContent).toBe('0.5');
    expect(within(half).getByText('Approved').getAttribute('data-tone')).toBe('success');
  });

  it('shows cancelled leave in a muted pill', () => {
    renderTab({
      requests: [request({ id: 'c', startDate: '2026-11-02', endDate: '2026-11-02', status: 'cancelled' })],
    });
    expect(screen.getByText('Cancelled').getAttribute('data-tone')).toBe('muted');
  });

  it('only offers Approve and Reject on a pending request', () => {
    renderTab();
    const pending = rowWith('23 Nov – 25 Nov 2026');
    expect(button('Approve', pending)).toBeTruthy();
    expect(button('Reject', pending)).toBeTruthy();
    expect(within(pending).queryByRole('button', { name: 'Cancel leave' })).toBeNull();

    const approved = rowWith('17 Nov – 19 Nov 2026');
    expect(within(approved).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(approved).queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(button('Cancel leave', approved)).toBeTruthy();

    const rejected = rowWith('3 Aug – 4 Aug 2026');
    expect(within(rejected).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Delete leave for Ana',
    ]);
  });

  it('approves a pending request', async () => {
    const leave = renderTab();
    fireEvent.click(button('Approve', rowWith('23 Nov – 25 Nov 2026')));
    await waitFor(() => expect(leave.decide).toHaveBeenCalledWith('r-pending', 'approved'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave approved for Bob'));
  });

  it('asks for an optional note before rejecting', async () => {
    const leave = renderTab();
    fireEvent.click(button('Reject', rowWith('23 Nov – 25 Nov 2026')));
    expect(leave.decide).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reject leave for Bob?')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: ' Too busy that week ' } });
    fireEvent.click(button('Reject leave', dialog));
    await waitFor(() =>
      expect(leave.decide).toHaveBeenCalledWith('r-pending', 'rejected', 'Too busy that week'),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Leave rejected for Bob');
  });

  it('rejects without a note when none is typed', async () => {
    const leave = renderTab();
    fireEvent.click(button('Reject', rowWith('23 Nov – 25 Nov 2026')));
    fireEvent.click(button('Reject leave', screen.getByRole('dialog')));
    await waitFor(() => expect(leave.decide).toHaveBeenCalledWith('r-pending', 'rejected', null));
  });

  it('cancels approved leave', async () => {
    const leave = renderTab();
    fireEvent.click(button('Cancel leave', rowWith('17 Nov – 19 Nov 2026')));
    await waitFor(() => expect(leave.decide).toHaveBeenCalledWith('r-today', 'cancelled'));
  });

  it('deletes a request only after a confirmation', async () => {
    const leave = renderTab();
    fireEvent.click(button('Delete leave for Bob', rowWith('23 Nov – 25 Nov 2026')));
    expect(leave.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByText(/23 Nov – 25 Nov 2026/)).toBeTruthy();
    fireEvent.click(button('Delete', confirm));
    await waitFor(() => expect(leave.remove).toHaveBeenCalledWith('r-pending'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Leave deleted'));
  });

  it('says what went wrong when a change cannot be saved', async () => {
    const leave = renderTab({ decide: vi.fn().mockRejectedValue(new Error('No permission')) });
    fireEvent.click(button('Approve', rowWith('23 Nov – 25 Nov 2026')));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No permission'));
    expect(leave.decide).toHaveBeenCalledTimes(1);
  });

  it('filters the list by status', () => {
    renderTab();
    choose('Status', 'Rejected');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('3 Aug – 4 Aug 2026')).toBeTruthy();
    choose('Status', 'Cancelled');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No cancelled requests.')).toBeTruthy();
  });

  it('shows an empty state when nobody has any leave', () => {
    renderTab({ requests: [] });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No leave requests yet.')).toBeTruthy();
  });

  it('still lists leave of someone who has left the team', () => {
    renderTab({
      requests: [request({ id: 'gone', userId: 'zed', startDate: '2026-11-02', endDate: '2026-11-02' })],
    });
    expect(within(rowWith('2 Nov 2026')).getByText('Former member')).toBeTruthy();
  });
});

describe('HR leave tab: adding leave', () => {
  const openDialog = () => {
    fireEvent.click(button('Add leave'));
    return screen.getByRole('dialog');
  };

  it('needs a person before it can be saved', () => {
    renderTab();
    const dialog = openDialog();
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-11-18');
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-11-18');
    expect(button('Save', dialog).disabled).toBe(true);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('counts working days, shows what is left and saves approved leave', async () => {
    const leave = renderTab();
    const dialog = openDialog();
    choose('Employee', 'Bob');
    setValue('Start date', '2026-12-07');
    expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-12-07');
    expect(within(dialog).getByText('1 working day')).toBeTruthy();
    setValue('End date', '2026-12-11');
    expect(within(dialog).getByText('5 working days')).toBeTruthy();
    // Bob: 20 allowed, 1 approved day used so far this year.
    expect(within(dialog).getByText('Remaining after this: 14 days')).toBeTruthy();
    setValue('Reason', 'Winter break');
    fireEvent.click(button('Save', dialog));
    await waitFor(() =>
      expect(leave.create).toHaveBeenCalledWith({
        userId: 'bob',
        leaveType: 'annual',
        startDate: '2026-12-07',
        endDate: '2026-12-11',
        days: 5,
        halfDay: false,
        reason: 'Winter break',
        status: 'approved',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Leave added for Bob');
  });

  it('leaves public holidays out of the count', () => {
    renderTab();
    const dialog = openDialog();
    choose('Employee', 'Ana');
    setValue('Start date', '2026-12-24');
    setValue('End date', '2026-12-28');
    expect(within(dialog).getByText('2 working days')).toBeTruthy();
  });

  it('blocks dates that clash with leave the person already has', () => {
    const leave = renderTab();
    const dialog = openDialog();
    choose('Employee', 'Bob');
    setValue('Start date', '2026-11-24');
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toContain('Bob already has leave on these dates');
    expect(alert.textContent).toContain('23 Nov – 25 Nov 2026');
    expect(button('Save', dialog).disabled).toBe(true);
    fireEvent.click(button('Save', dialog));
    expect(leave.create).not.toHaveBeenCalled();
    // Ana is free on that day.
    choose('Employee', 'Ana');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(button('Save', dialog).disabled).toBe(false);
  });

  it('blocks a weekend or a public holiday', () => {
    renderTab();
    const dialog = openDialog();
    choose('Employee', 'Bob');
    setValue('Start date', '2026-11-21');
    expect(within(dialog).getByRole('alert').textContent).toBe('These dates fall on a weekend or public holiday.');
    expect(button('Save', dialog).disabled).toBe(true);
    setValue('Start date', '2026-12-25');
    expect(within(dialog).getByRole('alert').textContent).toBe('These dates fall on a weekend or public holiday.');
  });

  it('records a pending half day of sick leave', async () => {
    const leave = renderTab();
    const dialog = openDialog();
    choose('Employee', 'Bob');
    choose('Type', 'Sick leave');
    setValue('Start date', '2026-12-08');
    const half = screen.getByLabelText('Half day') as HTMLInputElement;
    expect(half.disabled).toBe(false);
    fireEvent.click(half);
    expect(within(dialog).getByText('0.5 working days')).toBeTruthy();
    // Bob: 10 sick days allowed, 2 used.
    expect(within(dialog).getByText('Remaining after this: 7.5 days')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Approve now' }));
    fireEvent.click(button('Save', dialog));
    await waitFor(() =>
      expect(leave.create).toHaveBeenCalledWith({
        userId: 'bob',
        leaveType: 'sick',
        startDate: '2026-12-08',
        endDate: '2026-12-08',
        days: 0.5,
        halfDay: true,
        reason: null,
        status: 'pending',
      }),
    );
  });

  it('only allows a half day for a single day', () => {
    renderTab();
    openDialog();
    choose('Employee', 'Bob');
    setValue('Start date', '2026-12-08');
    fireEvent.click(screen.getByLabelText('Half day'));
    setValue('End date', '2026-12-09');
    const half = screen.getByLabelText('Half day') as HTMLInputElement;
    expect(half.disabled).toBe(true);
    expect(half.checked).toBe(false);
  });

  it('warns in red, without blocking, when the allowance is used up', () => {
    renderTab({ allowanceFor: (userId: string) => ({ userId, annualDays: 2, sickDays: 10 }) });
    const dialog = openDialog();
    choose('Employee', 'Bob');
    setValue('Start date', '2026-12-07');
    setValue('End date', '2026-12-09');
    const left = within(dialog).getByText('Remaining after this: -2 days');
    expect(left.className).toContain('text-destructive');
    expect(button('Save', dialog).disabled).toBe(false);
  });

  it('does not show a balance for unpaid leave', () => {
    renderTab();
    const dialog = openDialog();
    choose('Employee', 'Bob');
    choose('Type', 'Unpaid leave');
    expect(within(dialog).queryByText(/Remaining after this/)).toBeNull();
  });

  it('picks the only person on the team for you', () => {
    renderTab({ requests: [] }, [people[0]]);
    const dialog = openDialog();
    expect(screen.getByRole('combobox', { name: 'Employee' }).textContent).toContain('Ana');
    expect(button('Save', dialog).disabled).toBe(false);
  });

  it('keeps the dialog open and says why when saving fails', async () => {
    renderTab({ create: vi.fn().mockRejectedValue(new Error('Offline')) });
    const dialog = openDialog();
    choose('Employee', 'Bob');
    setValue('Start date', '2026-12-07');
    fireEvent.click(button('Save', dialog));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Offline'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('HR leave tab: balances', () => {
  /** Annual allowance, used, pending, remaining, sick allowance, sick used. */
  const numbersOf = (name: string) =>
    within(rowWith(name))
      .getAllByRole('cell')
      .slice(1, 7)
      .map((c) => c.textContent);

  it('shows what each person has used and has left this year', () => {
    renderTab();
    openSection(/Balances/);
    expect(screen.getByRole('combobox', { name: 'Year' }).textContent).toContain('2026');
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'Employee',
      'Annual allowance',
      'Used',
      'Pending',
      'Remaining',
      'Sick allowance',
      'Sick used',
      'Actions',
    ]);
    expect(numbersOf('Ana')).toEqual(['20', '3.5', '0', '16.5', '10', '0']);
    expect(numbersOf('Bob')).toEqual(['20', '1', '3', '19', '10', '2']);
  });

  it('marks a negative balance in red', () => {
    renderTab({ allowanceFor: (userId: string) => ({ userId, annualDays: 2, sickDays: 10 }) });
    openSection(/Balances/);
    const remaining = within(rowWith('Ana')).getAllByRole('cell')[4];
    expect(remaining.textContent).toBe('-1.5');
    expect(remaining.className).toContain('text-destructive');
    expect(within(rowWith('Bob')).getAllByRole('cell')[4].className).not.toContain('text-destructive');
  });

  it('offers every year that has leave or holidays and shows the one chosen', () => {
    renderTab();
    openSection(/Balances/);
    fireEvent.click(screen.getByRole('combobox', { name: 'Year' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['2027', '2026']);
    fireEvent.click(screen.getByRole('option', { name: '2027' }));
    expect(numbersOf('Ana')).toEqual(['20', '0', '0', '20', '10', '0']);
  });

  it('saves a new yearly allowance', async () => {
    const leave = renderTab();
    openSection(/Balances/);
    fireEvent.click(button('Edit allowance for Bob'));
    const dialog = screen.getByRole('dialog');
    const annual = within(dialog).getByLabelText('Annual days') as HTMLInputElement;
    const sick = within(dialog).getByLabelText('Sick days') as HTMLInputElement;
    expect(annual.value).toBe('20');
    expect(sick.value).toBe('10');
    expect(annual.step).toBe('0.5');
    expect(annual.min).toBe('0');
    fireEvent.change(annual, { target: { value: '25.5' } });
    fireEvent.click(button('Save', dialog));
    await waitFor(() =>
      expect(leave.saveAllowance).toHaveBeenCalledWith({ userId: 'bob', annualDays: 25.5, sickDays: 10 }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Allowance saved for Bob');
  });

  it('does not save an empty or negative allowance', () => {
    const leave = renderTab();
    openSection(/Balances/);
    fireEvent.click(button('Edit allowance for Bob'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Annual days'), { target: { value: '-1' } });
    expect(button('Save', dialog).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Annual days'), { target: { value: '' } });
    expect(button('Save', dialog).disabled).toBe(true);
    expect(leave.saveAllowance).not.toHaveBeenCalled();
  });
});

describe('HR leave tab: public holidays', () => {
  it('lists this year’s holidays in date order', () => {
    renderTab();
    openSection(/Public holidays/);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Thu 1 Jan 2026New Year’s Day',
      'Fri 25 Dec 2026Christmas Day',
    ]);
  });

  it('removes a holiday', async () => {
    const leave = renderTab();
    openSection(/Public holidays/);
    fireEvent.click(button('Remove Christmas Day'));
    await waitFor(() => expect(leave.removeHoliday).toHaveBeenCalledWith('h-xmas'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Christmas Day removed'));
  });

  it('adds a holiday from the page header', async () => {
    const leave = renderTab();
    fireEvent.click(button('Add holiday'));
    const dialog = screen.getByRole('dialog');
    expect(button('Add holiday', dialog).disabled).toBe(true);
    setValue('Date', '2026-12-28');
    expect(button('Add holiday', dialog).disabled).toBe(true);
    setValue('Name', '  Boxing Day (observed) ');
    fireEvent.click(button('Add holiday', dialog));
    await waitFor(() => expect(leave.addHoliday).toHaveBeenCalledWith('2026-12-28', 'Boxing Day (observed)'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Boxing Day (observed) added');
  });

  it('refuses a date that is already a holiday', () => {
    const leave = renderTab();
    fireEvent.click(button('Add holiday'));
    const dialog = screen.getByRole('dialog');
    setValue('Date', '2026-12-25');
    setValue('Name', 'Christmas again');
    expect(within(dialog).getByRole('alert').textContent).toContain('25 Dec 2026 is already a public holiday');
    expect(within(dialog).getByRole('alert').textContent).toContain('Christmas Day');
    expect(button('Add holiday', dialog).disabled).toBe(true);
    expect(leave.addHoliday).not.toHaveBeenCalled();
  });

  it('offers to add one when the year has no holidays', () => {
    renderTab({ holidays: [] });
    openSection(/Public holidays/);
    expect(screen.getByText('No public holidays in 2026.')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
    const panel = screen.getByRole('tabpanel');
    fireEvent.click(button('Add holiday', panel));
    expect(within(screen.getByRole('dialog')).getByLabelText('Date')).toBeTruthy();
  });
});
