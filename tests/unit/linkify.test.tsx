import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { splitLinks } from '@/lib/linkify';
import { LinkifiedText } from '@/components/ui/LinkifiedText';

afterEach(cleanup);

const links = (text: string) => splitLinks(text).filter((s) => s.type === 'link');

describe('splitLinks', () => {
  it('finds http(s) links and keeps the text around them', () => {
    expect(splitLinks('See https://figma.com/file/abc for the design')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', value: 'https://figma.com/file/abc', href: 'https://figma.com/file/abc' },
      { type: 'text', value: ' for the design' },
    ]);
  });

  it('turns www. addresses into https links', () => {
    expect(links('go to www.example.com/docs')).toEqual([
      { type: 'link', value: 'www.example.com/docs', href: 'https://www.example.com/docs' },
    ]);
  });

  it('makes email addresses mailto links', () => {
    expect(links('mail sam@client.co.uk today')).toEqual([
      { type: 'link', value: 'sam@client.co.uk', href: 'mailto:sam@client.co.uk' },
    ]);
  });

  it('leaves trailing punctuation and closing brackets out of the link', () => {
    expect(links('Docs: https://a.io/x. Also (https://b.io/y), ok!')).toEqual([
      { type: 'link', value: 'https://a.io/x', href: 'https://a.io/x' },
      { type: 'link', value: 'https://b.io/y', href: 'https://b.io/y' },
    ]);
    // brackets that belong to the URL stay
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')[0].value).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    );
  });

  it('never links unsafe schemes', () => {
    expect(links('javascript:alert(1) data:text/html,x')).toEqual([]);
  });

  it('handles several links and line breaks', () => {
    expect(links('a https://x.io\nb https://y.io')).toHaveLength(2);
    expect(splitLinks('')).toEqual([]);
    expect(splitLinks('no links here')).toEqual([{ type: 'text', value: 'no links here' }]);
  });
});

describe('LinkifiedText', () => {
  it('renders links that open in a new tab safely, without triggering the parent click', () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <LinkifiedText text="Brief: https://docs.google.com/d/1 thanks" />
      </div>,
    );
    const a = screen.getByRole('link', { name: 'https://docs.google.com/d/1' });
    expect(a.getAttribute('href')).toBe('https://docs.google.com/d/1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(a);
    expect(onParentClick).not.toHaveBeenCalled();
    expect(screen.getByText(/Brief:/)).toBeTruthy();
  });

  it('mailto links open in place', () => {
    render(<LinkifiedText text="ping sam@x.io" />);
    expect(screen.getByRole('link').getAttribute('target')).toBeNull();
  });
});
