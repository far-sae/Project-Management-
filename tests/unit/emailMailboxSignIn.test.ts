// A mailbox's sign-in (server, port, username, password) can be corrected
// after the mailbox was added. Before, it was written once: a password typed
// again after a failed check was never saved, so the check failed for ever.
import { describe, expect, it, vi } from 'vitest';
import { saveSignIn, signInFrom, type SavedSignIn } from '@/components/email/mailboxSignIn';

const saved: SavedSignIn = { smtpHost: 'smtp.ionos.co.uk', smtpPort: 587, smtpSecure: false, smtpUsername: 'sam@northwind.test' };
const deps = () => ({ updateSmtp: vi.fn().mockResolvedValue(undefined), savePassword: vi.fn().mockResolvedValue(undefined) });

describe('correcting a mailbox\'s sign-in', () => {
  it('saves a password that was typed again, and nothing else when nothing else changed', async () => {
    const d = deps();
    const changed = await saveSignIn(d, 'acc-1', saved, { smtpHost: 'smtp.ionos.co.uk', smtpPort: '587', smtpUsername: 'sam@northwind.test', password: 'the new one' });
    expect(changed).toBe(true);
    expect(d.savePassword).toHaveBeenCalledWith('acc-1', 'the new one');
    expect(d.updateSmtp).not.toHaveBeenCalled();
  });

  it('keeps the saved password when the box is left empty', async () => {
    const d = deps();
    expect(await saveSignIn(d, 'acc-1', saved, { smtpHost: 'smtp.ionos.co.uk', smtpPort: '587', smtpUsername: 'sam@northwind.test', password: '' })).toBe(false);
    expect(d.savePassword).not.toHaveBeenCalled();
    expect(d.updateSmtp).not.toHaveBeenCalled();
  });

  it('saves a corrected server, port or username, with the encryption that fits the port', async () => {
    const d = deps();
    expect(await saveSignIn(d, 'acc-1', saved, { smtpHost: ' smtp.ionos.com ', smtpPort: '465', smtpUsername: ' sam@northwind.test', password: '' })).toBe(true);
    expect(d.updateSmtp).toHaveBeenCalledWith('acc-1', { smtpHost: 'smtp.ionos.com', smtpPort: 465, smtpSecure: true, smtpUsername: 'sam@northwind.test' });
    const e = deps();
    await saveSignIn(e, 'acc-1', { ...saved, smtpPort: 465, smtpSecure: true }, { smtpHost: 'smtp.ionos.co.uk', smtpPort: '587', smtpUsername: 'sam@northwind.test', password: '' });
    expect(e.updateSmtp).toHaveBeenCalledWith('acc-1', expect.objectContaining({ smtpPort: 587, smtpSecure: false }));
    // A port of the person's own keeps the encryption that was saved.
    const f = deps();
    await saveSignIn(f, 'acc-1', { ...saved, smtpSecure: true }, { smtpHost: 'smtp.ionos.co.uk', smtpPort: '2525', smtpUsername: 'sam@northwind.test', password: '' });
    expect(f.updateSmtp).toHaveBeenCalledWith('acc-1', expect.objectContaining({ smtpPort: 2525, smtpSecure: true }));
  });

  it('writes everything when what is saved is not known (a retry right after adding)', async () => {
    const d = deps();
    expect(await saveSignIn(d, 'acc-1', null, { smtpHost: 'smtp.ionos.co.uk', smtpPort: '587', smtpUsername: 'sam@northwind.test', password: 'p' })).toBe(true);
    expect(d.updateSmtp).toHaveBeenCalledWith('acc-1', { smtpHost: 'smtp.ionos.co.uk', smtpPort: 587, smtpSecure: false, smtpUsername: 'sam@northwind.test' });
    expect(d.savePassword).toHaveBeenCalledWith('acc-1', 'p');
  });

  it('refuses an empty server or username instead of saving a mailbox that cannot sign in', async () => {
    const d = deps();
    await expect(saveSignIn(d, 'acc-1', saved, { smtpHost: ' ', smtpPort: '587', smtpUsername: 'sam@northwind.test', password: '' })).rejects.toThrow('The outgoing server and the username cannot be empty.');
    await expect(saveSignIn(d, 'acc-1', saved, { smtpHost: 'smtp.ionos.co.uk', smtpPort: '587', smtpUsername: '', password: 'p' })).rejects.toThrow('cannot be empty');
    expect(d.updateSmtp).not.toHaveBeenCalled();
    expect(d.savePassword).not.toHaveBeenCalled();
  });

  it('never keeps a typed password in the form it opens with', () => {
    expect(signInFrom(saved)).toEqual({ smtpHost: 'smtp.ionos.co.uk', smtpPort: '587', smtpUsername: 'sam@northwind.test', password: '' });
    expect(signInFrom(undefined)).toEqual({ smtpHost: '', smtpPort: '587', smtpUsername: '', password: '' });
  });
});
