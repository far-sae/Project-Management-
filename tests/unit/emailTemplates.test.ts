import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  isAllowedLink,
  isValidEmail,
  renderInvitationEmail,
  renderNotificationEmail,
} from '@/supabase-functions/_shared/emailTemplates.ts';

const ORIGINS = ['https://taskcalendar.co.uk'];

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe(
      '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;',
    );
  });
});

describe('isAllowedLink', () => {
  it('accepts links on the app origin', () => {
    expect(isAllowedLink('https://taskcalendar.co.uk/accept-invite/abc', ORIGINS)).toBe(true);
  });
  it('rejects other sites, look-alike hosts and non-http schemes', () => {
    expect(isAllowedLink('https://evil.example/accept-invite/abc', ORIGINS)).toBe(false);
    expect(isAllowedLink('https://taskcalendar.co.uk.evil.example/x', ORIGINS)).toBe(false);
    expect(isAllowedLink('javascript:alert(1)', ORIGINS)).toBe(false);
    expect(isAllowedLink('not a url', ORIGINS)).toBe(false);
  });
  it('rejects everything when no origins are configured', () => {
    expect(isAllowedLink('https://taskcalendar.co.uk/x', [])).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts a normal address and rejects junk or header injection', () => {
    expect(isValidEmail('jane@client.com')).toBe(true);
    expect(isValidEmail('jane')).toBe(false);
    expect(isValidEmail('jane@client.com\nBcc: x@y.z')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@x.com`)).toBe(false);
  });
});

describe('renderInvitationEmail', () => {
  const email = renderInvitationEmail({
    toEmail: 'jane@client.com',
    inviterName: 'Sam <script>',
    projectName: 'Website & App',
    inviteLink: 'https://taskcalendar.co.uk/accept-invite/tok123',
    role: 'member',
  });

  it('has a clear subject', () => {
    expect(email.subject).toBe('Invitation to join Website & App');
  });
  it('includes the accept link and expiry in both HTML and text', () => {
    expect(email.html).toContain('href="https://taskcalendar.co.uk/accept-invite/tok123"');
    expect(email.text).toContain('https://taskcalendar.co.uk/accept-invite/tok123');
    expect(email.text).toContain('This invitation expires in 7 days.');
    expect(email.html).toContain('Accept invitation');
  });
  it('escapes user-supplied names in the HTML', () => {
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('Sam &lt;script&gt;');
    expect(email.html).toContain('Website &amp; App');
  });
});

describe('renderNotificationEmail', () => {
  it('renders title, body and an optional button, escaped', () => {
    const email = renderNotificationEmail({
      title: 'New comment on <Task>',
      body: 'Looks good\nship it',
      actionUrl: 'https://taskcalendar.co.uk/project/p1',
    });
    expect(email.subject).toBe('New comment on <Task>');
    expect(email.html).toContain('New comment on &lt;Task&gt;');
    expect(email.html).toContain('Looks good<br>ship it');
    expect(email.html).toContain('href="https://taskcalendar.co.uk/project/p1"');
    expect(email.text).toContain('Looks good\nship it');
  });
  it('omits the button when there is no link', () => {
    const email = renderNotificationEmail({ title: 'Hi', body: 'x' });
    expect(email.html).not.toContain('href=');
  });
});
