import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/services/supabase/config', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  getInvitationEmailFailureHint,
  sendInvitationEmail,
  sendNotificationEmail,
} from '@/services/email/emailService';

function httpError(status: number, body: unknown) {
  return {
    message: `Edge Function returned a non-2xx status code`,
    context: new Response(JSON.stringify(body), { status }),
  };
}

describe('emailService (Resend via send-email)', () => {
  beforeEach(() => invoke.mockReset());

  it('sends invitations through the send-email function', async () => {
    invoke.mockResolvedValue({ data: { ok: true, id: 'e1' }, error: null });
    const res = await sendInvitationEmail({
      toEmail: ' jane@client.com ',
      inviterName: 'Sam',
      projectName: 'Website',
      inviteLink: 'https://taskcalendar.co.uk/accept-invite/t1',
      role: 'member',
    });
    expect(res).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('send-email', {
      body: {
        kind: 'invitation',
        toEmail: 'jane@client.com',
        inviterName: 'Sam',
        projectName: 'Website',
        inviteLink: 'https://taskcalendar.co.uk/accept-invite/t1',
        role: 'member',
      },
    });
  });

  it('reports a clear hint when Resend is not configured', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(503, { error: 'Email is not set up', code: 'MISSING_RESEND_KEY' }),
    });
    const res = await sendInvitationEmail({
      toEmail: 'jane@client.com',
      inviterName: 'Sam',
      projectName: 'Website',
      inviteLink: 'https://taskcalendar.co.uk/accept-invite/t1',
      role: 'member',
    });
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(getInvitationEmailFailureHint(res)).toMatch(/RESEND_API_KEY/);
  });

  it('passes Resend error messages through (e.g. unverified domain)', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(502, { error: 'The taskcalendar.co.uk domain is not verified.', code: 'RESEND_ERROR' }),
    });
    const res = await sendInvitationEmail({
      toEmail: 'jane@client.com',
      inviterName: 'Sam',
      projectName: 'Website',
      inviteLink: 'https://taskcalendar.co.uk/accept-invite/t1',
      role: 'member',
    });
    expect(getInvitationEmailFailureHint(res)).toBe('The taskcalendar.co.uk domain is not verified.');
  });

  it('sends notifications through the send-email function', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const res = await sendNotificationEmail({
      toEmail: 'jane@client.com',
      title: 'New comment',
      body: 'Looks good',
      actionUrl: 'https://taskcalendar.co.uk/project/p1',
    });
    expect(res.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('send-email', {
      body: {
        kind: 'notification',
        toEmail: 'jane@client.com',
        title: 'New comment',
        body: 'Looks good',
        actionUrl: 'https://taskcalendar.co.uk/project/p1',
      },
    });
  });

  it('skips obviously invalid recipients without calling the server', async () => {
    const res = await sendNotificationEmail({ toEmail: 'nope', title: 't', body: 'b' });
    expect(res.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
