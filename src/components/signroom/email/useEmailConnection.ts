// The workspace's own-mailbox connection: what the server holds, and every change the owner can make to it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSignroom } from '@/hooks/useSignroom';
import {
  NOT_CHECKED_MESSAGE, PROVIDER_NAME, SIGN_IN_PAGE_MESSAGE, appBody, disconnectedSentence, safeSignInUrl, sentenceOf,
  smtpBody, statusOf,
  type AppForm, type AuthorizeReply, type DisconnectReply, type EmailConnectionView, type SaveReply, type SmtpForm,
  type TestReply, type VerifyReply,
} from '@/lib/signroom/emailConnection';

export type EmailAction = 'save' | 'test' | 'disconnect' | 'verify' | 'authorize' | 'confirm';

export interface EmailConnection {
  /** Null until the first answer arrives. */
  view: EmailConnectionView | null;
  /** Why the view could not be read, in the server's words. */
  loadError: string;
  /** The HTTP status that came with `loadError`. */
  loadStatus: number | null;
  /** The change in flight, if any. Only one runs at a time. */
  busy: EmailAction | null;
  /** The last refusal, and the last thing that worked. One of them at most. */
  error: string;
  notice: string;
  reload: () => Promise<void>;
  /** Shows a sentence in the panel without calling the server. */
  say: (notice: string) => void;
  refuse: (error: string) => void;
  /** Saves a password connection; the server signs in once to check it. True once it is verified. */
  saveSmtp: (form: SmtpForm) => Promise<SaveReply | null>;
  /** Saves the Google or Microsoft app details. True when saved. */
  saveApp: (form: AppForm) => Promise<boolean>;
  /** Sends the browser to the provider's sign-in page. */
  authorize: () => Promise<void>;
  sendTest: () => Promise<boolean>;
  verify: () => Promise<boolean>;
  confirm: (code: string) => Promise<boolean>;
  disconnect: () => Promise<boolean>;
}

/**
 * `readOnly` people only ever read the view: every change is refused here,
 * before it reaches the server.
 */
export function useEmailConnection(readOnly: boolean): EmailConnection {
  const { client, workspaceId } = useSignroom();
  const [view, setView] = useState<EmailConnectionView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState<EmailAction | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** Counts reads, so an answer that arrives after a newer one (or after a save) is dropped. */
  const latest = useRef(0);
  const running = useRef(false);

  /** `quiet` keeps whatever is on screen when the read fails: it is only a refresh. */
  const load = useCallback(async (quiet: boolean) => {
    if (!workspaceId) return;
    const mine = ++latest.current;
    if (!quiet) { setLoadError(''); setLoadStatus(null); }
    try {
      const next = await client.call<EmailConnectionView>('email-connection');
      if (mine !== latest.current) return;
      setView(next);
      setLoadError('');
      setLoadStatus(null);
    } catch (err) {
      if (mine !== latest.current || quiet) return;
      setLoadError(sentenceOf(err));
      setLoadStatus(statusOf(err));
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void load(false);
    return () => { latest.current += 1; };
  }, [load]);

  const adopt = (next: EmailConnectionView) => {
    latest.current += 1;
    setView(next);
  };
  const say = useCallback((sentence: string) => { setError(''); setNotice(sentence); }, []);
  const refuse = useCallback((sentence: string) => { setNotice(''); setError(sentence); }, []);
  const worked = (sentence: string) => { say(sentence); toast.success(sentence); };
  const failed = (sentence: string) => { refuse(sentence); toast.error(sentence); };

  /** One change. Null when it was refused: the sentence is then on screen, and the view is read again. */
  const run = async <T,>(action: EmailAction, body: unknown = {}): Promise<T | null> => {
    if (readOnly || !workspaceId || running.current) return null;
    running.current = true;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      return await client.call<T>(`email-connection/${action}`, body);
    } catch (err) {
      failed(sentenceOf(err));
      // A refusal often means the saved state moved on (settings changed, sign-in lapsed).
      await load(true);
      return null;
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const saveSmtp = async (form: SmtpForm) => {
    const body = smtpBody(form);
    const reply = await run<SaveReply>('save', body);
    if (!reply) return null;
    if (reply.view) adopt(reply.view); else await load(true);
    if (reply.verified) worked(`Connected. Emails are sent from ${body.email}.`);
    else failed(reply.error || NOT_CHECKED_MESSAGE);
    return reply;
  };

  const saveApp = async (form: AppForm) => {
    const reply = await run<SaveReply>('save', appBody(form));
    if (!reply) return false;
    if (reply.view) adopt(reply.view); else await load(true);
    worked(`App details saved. Next: sign in with ${PROVIDER_NAME[form.provider]}.`);
    return true;
  };

  const authorize = async () => {
    const reply = await run<AuthorizeReply>('authorize');
    if (!reply) return;
    const url = safeSignInUrl(reply.url);
    if (!url) { failed(SIGN_IN_PAGE_MESSAGE); return; }
    window.location.assign(url);
  };

  const sendTest = async () => {
    const withCode = view?.provider === 'google' || view?.provider === 'microsoft';
    const address = view?.email ?? 'your address';
    const reply = await run<TestReply>('test');
    if (!reply) return false;
    await load(true);
    worked(withCode
      ? `A test email with a code was sent to ${address}. Enter the code below.`
      : `A test email was sent to ${address}.`);
    return true;
  };

  const verify = async () => {
    const reply = await run<VerifyReply>('verify');
    if (!reply) return false;
    await load(true);
    if (reply.verified) worked('Checked. Your mailbox is working.');
    else failed(reply.error || NOT_CHECKED_MESSAGE);
    return reply.verified;
  };

  const confirm = async (code: string) => {
    const address = view?.email ?? 'your address';
    const reply = await run<Partial<EmailConnectionView>>('confirm', { code });
    if (!reply) return false;
    // The reply is the connection as it now stands; the full view (with what else is kept) is read after it.
    setView((old) => (old ? { ...old, ...reply } : old));
    await load(true);
    worked(`Connected. Emails are sent from ${address}.`);
    return true;
  };

  const disconnect = async () => {
    const sentence = view ? disconnectedSentence(view) : '';
    const reply = await run<DisconnectReply>('disconnect');
    if (!reply) return false;
    await load(true);
    worked(sentence);
    return true;
  };

  return {
    view, loadError, loadStatus, busy, error, notice,
    reload: () => load(false), say, refuse,
    saveSmtp, saveApp, authorize, sendTest, verify, confirm, disconnect,
  };
}
