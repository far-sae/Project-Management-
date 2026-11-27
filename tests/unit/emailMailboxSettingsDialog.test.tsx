// The settings window of a saved mailbox: its sign-in can be corrected there.
import React, { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MailboxLimitsDialog, type MailboxSettingsFormState } from '@/components/email/AccountFormDialog';

const start: MailboxSettingsFormState = {
  dailyLimit: '40', warmupEnabled: true, warmupStartVolume: '5', warmupIncrement: '3',
  imapHost: 'imap.ionos.co.uk', imapPort: '993', imapSecure: true, sentFolderEnabled: true,
  smtpHost: 'smtp.ionos.co.uk', smtpPort: '587', smtpUsername: 'sam@northwind.test', password: '',
};

function Harness({ onSubmit, error = null }: { onSubmit: (form: MailboxSettingsFormState) => void; error?: string | null }) {
  const [form, setForm] = useState(start);
  return (
    <MailboxLimitsDialog
      open onOpenChange={() => undefined} label="Sales" smtpHost={form.smtpHost} form={form} onFormChange={setForm}
      saving={false} error={error} onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
    />
  );
}

// The switches in the window measure themselves; the test browser has nothing to measure with.
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

describe('the settings window of a mailbox', () => {
  it('shows the sign-in that is saved, with an empty password box that means "keep it"', () => {
    render(<Harness onSubmit={vi.fn()} />);
    const signIn = screen.getByRole('group', { name: 'Sign-in' });
    expect((within(signIn).getByLabelText('Outgoing server (SMTP)') as HTMLInputElement).value).toBe('smtp.ionos.co.uk');
    expect((within(signIn).getByLabelText('Port') as HTMLInputElement).value).toBe('587');
    expect((within(signIn).getByLabelText('Username') as HTMLInputElement).value).toBe('sam@northwind.test');
    const password = within(signIn).getByLabelText('New password') as HTMLInputElement;
    expect(password.value).toBe('');
    expect(password.type).toBe('password');
    expect(password.placeholder).toBe('Leave empty to keep the saved password');
    expect(password.required).toBe(false);
  });

  it('hands over a corrected password and username when Save is pressed', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'the new one' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'hello@northwind.test' } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '46x5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ password: 'the new one', smtpUsername: 'hello@northwind.test', smtpPort: '465', smtpHost: 'smtp.ionos.co.uk', dailyLimit: '40' }));
  });

  it('keeps the reason on screen when the check failed', () => {
    render(<Harness onSubmit={vi.fn()} error="IONOS did not accept this email address and password. Check three things." />);
    expect(screen.getByText('IONOS did not accept this email address and password. Check three things.')).toBeTruthy();
  });
});
