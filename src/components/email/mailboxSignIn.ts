// A mailbox's sign-in: the outgoing server, its port, the username and the
// password. It used to be written once, when the mailbox was added. A password
// typed again after a failed check was shown in the form but never sent, so
// the check kept failing with the first password for ever, and a mailbox whose
// password was changed at the provider had to be deleted and added again.
//
// This is the one place that decides what of a typed sign-in is saved. No
// React and no database in here: AccountsTab gives it the two writers.

export interface SavedSignIn {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
}

/** The sign-in as a form holds it. `password` is empty unless a new one was typed. */
export interface SignInValues {
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  password: string;
}

export interface SignInWriters {
  updateSmtp: (accountId: string, settings: SavedSignIn) => Promise<void>;
  savePassword: (accountId: string, password: string) => Promise<void>;
}

export const SIGN_IN_EMPTY_MESSAGE = 'The outgoing server and the username cannot be empty.';

/** What a form opens with for a saved mailbox. The password is never read back: an empty box means "keep it". */
export const signInFrom = (saved: SavedSignIn | undefined | null): SignInValues => ({
  smtpHost: saved?.smtpHost ?? '',
  smtpPort: String(saved?.smtpPort ?? 587),
  smtpUsername: saved?.smtpUsername ?? '',
  password: '',
});

/** The encryption a port needs; for a port of the person's own, what was saved. */
const secureFor = (port: number, saved: boolean): boolean => (port === 465 ? true : port === 587 || port === 25 ? false : saved);

/**
 * Saves what is different from `saved` (everything, when `saved` is not
 * known), and a password when one was typed. Resolves to true when anything
 * was written, which is when the mailbox should be checked again.
 */
export async function saveSignIn(writers: SignInWriters, accountId: string, saved: SavedSignIn | null, typed: SignInValues): Promise<boolean> {
  const smtpHost = typed.smtpHost.trim();
  const smtpUsername = typed.smtpUsername.trim();
  if (!smtpHost || !smtpUsername) throw new Error(SIGN_IN_EMPTY_MESSAGE);
  const smtpPort = Number(typed.smtpPort) || 587;
  const next: SavedSignIn = { smtpHost, smtpPort, smtpSecure: secureFor(smtpPort, saved?.smtpSecure ?? false), smtpUsername };

  const settingsChanged = !saved || next.smtpHost !== saved.smtpHost || next.smtpPort !== saved.smtpPort || next.smtpUsername !== saved.smtpUsername || next.smtpSecure !== saved.smtpSecure;
  if (settingsChanged) await writers.updateSmtp(accountId, next);
  if (typed.password) await writers.savePassword(accountId, typed.password);
  return settingsChanged || typed.password !== '';
}
