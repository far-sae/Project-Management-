// Project chat box: links in messages are clickable, and consecutive messages
// from the same person are grouped (Teams style) instead of repeating the
// avatar + name on every line.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatBubble, ProjectChatMessage } from '@/components/project/ProjectChatMessage';

afterEach(cleanup);

const at = new Date(2026, 10, 16, 9, 30);

describe('Project chat message', () => {
  it('turns a web address in a message into a link that opens in a new tab', () => {
    render(<ChatBubble text="spec is at https://example.com/spec ok" mine={false} />);
    const link = screen.getByRole('link', { name: 'https://example.com/spec' });
    expect(link.getAttribute('href')).toBe('https://example.com/spec');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('makes links in my own messages clickable too', () => {
    render(<ChatBubble text="www.taskcalendar.co.uk" mine />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://www.taskcalendar.co.uk');
  });

  it('shows the sender’s name and avatar on the first message of a group', () => {
    render(
      <ProjectChatMessage
        mine={false}
        grouped={false}
        authorLabel="Alice Smith"
        createdAt={at}
        content={<ChatBubble text="hello" mine={false} />}
      />,
    );
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    expect(screen.getByTestId('chat-avatar')).toBeTruthy();
  });

  it('hides the name and avatar on follow-up messages in the same group', () => {
    render(
      <ProjectChatMessage
        mine={false}
        grouped
        authorLabel="Alice Smith"
        createdAt={at}
        content={<ChatBubble text="again" mine={false} />}
      />,
    );
    expect(screen.queryByText('Alice Smith')).toBeNull();
    expect(screen.queryByTestId('chat-avatar')).toBeNull();
    expect(screen.getByText('again')).toBeTruthy();
  });

  it('never shows an avatar for my own messages', () => {
    render(
      <ProjectChatMessage
        mine
        grouped={false}
        authorLabel="You"
        createdAt={at}
        content={<ChatBubble text="mine" mine />}
      />,
    );
    expect(screen.queryByTestId('chat-avatar')).toBeNull();
  });
});
