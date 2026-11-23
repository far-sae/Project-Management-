// An open tab must not keep running an old version of the app after the site
// was updated: it notices, offers a reload, and takes the new version by
// itself at the next move to another page.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { RELOAD_GAP_MS, loadedMainScript, mainScriptOf, newVersionAvailable, reloadOnce, somethingIsOpen } from '@/lib/appVersion';
import { VERSION_CHECK_MS, useAppVersion } from '@/hooks/useAppVersion';

const page = (script: string) => `<!doctype html><html><head><script type="module" crossorigin src="${script}"></script></head><body><div id="root"></div></body></html>`;
const docWith = (script: string | null): Document => {
  const doc = document.implementation.createHTMLDocument('app');
  if (script) {
    const el = doc.createElement('script');
    el.setAttribute('src', script);
    doc.head.appendChild(el);
  }
  return doc;
};
const answering = (html: string, status = 200) => (async () => new Response(html, { status })) as unknown as typeof fetch;

describe('which version is which', () => {
  it('is told by the main script a page names', () => {
    expect(mainScriptOf(page('/assets/index-AAAA.js'))).toBe('/assets/index-AAAA.js');
    expect(mainScriptOf('<html><body>no script</body></html>')).toBeNull();
    expect(loadedMainScript(docWith('/assets/index-AAAA.js'))).toBe('/assets/index-AAAA.js');
    // In development the page is not a built one: there is nothing to compare.
    expect(loadedMainScript(docWith(null))).toBeNull();
  });

  it('says "new version" only when the server names another main script', async () => {
    const running = docWith('/assets/index-AAAA.js');
    expect(await newVersionAvailable(answering(page('/assets/index-BBBB.js')), running)).toBe(true);
    expect(await newVersionAvailable(answering(page('/assets/index-AAAA.js')), running)).toBe(false);
  });

  it('never bothers anybody when it cannot tell', async () => {
    const running = docWith('/assets/index-AAAA.js');
    expect(await newVersionAvailable(answering('Bad gateway', 502), running)).toBe(false);
    expect(await newVersionAvailable(answering('<html>maintenance</html>'), running)).toBe(false);
    expect(await newVersionAvailable((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, running)).toBe(false);
    // Not a built page: the server is not even asked.
    const asked = vi.fn();
    expect(await newVersionAvailable(asked as unknown as typeof fetch, docWith(null))).toBe(false);
    expect(asked).not.toHaveBeenCalled();
  });

  it('asks for the page fresh, never from a cache', async () => {
    const asked = vi.fn(async () => new Response(page('/assets/index-AAAA.js')));
    await newVersionAvailable(asked as unknown as typeof fetch, docWith('/assets/index-AAAA.js'));
    expect(asked).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
  });
});

describe('reloading', () => {
  const fakeWindow = () => {
    const store = new Map<string, string>();
    const reload = vi.fn();
    return {
      reload,
      win: {
        location: { reload } as unknown as Location,
        sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } as unknown as Storage,
      },
    };
  };

  it('happens once, and not again a moment later: a reload can never loop', () => {
    const { win, reload } = fakeWindow();
    expect(reloadOnce(1_000_000, win)).toBe(true);
    expect(reloadOnce(1_000_000 + 5_000, win)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(1_000_000 + RELOAD_GAP_MS + 1, win)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('is not done over an open window or a call', () => {
    const doc = document.implementation.createHTMLDocument('app');
    expect(somethingIsOpen(doc)).toBe(false);
    doc.body.innerHTML = '<div role="dialog" aria-label="Active call"></div>';
    expect(somethingIsOpen(doc)).toBe(true);
  });
});

describe('an open tab', () => {
  let go: (to: string) => void = () => {};
  const Probe: React.FC<{ check: () => Promise<boolean> }> = ({ check }) => {
    useAppVersion(check);
    go = useNavigate();
    return null;
  };
  const show = (check: () => Promise<boolean>) => render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes><Route path="*" element={<Probe check={check} />} /></Routes>
    </MemoryRouter>,
  );
  const reload = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    toast.mockClear();
    reload.mockClear();
    window.sessionStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('says nothing while the site has not changed', async () => {
    const check = vi.fn(async () => false);
    show(check);
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_CHECK_MS * 2 + 10); });
    expect(check).toHaveBeenCalledTimes(2);
    expect(toast).not.toHaveBeenCalled();
    act(() => go('/tasks'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('offers a reload once the site was updated, and asks no more after that', async () => {
    const check = vi.fn(async () => true);
    show(check);
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_CHECK_MS + 10); });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe('A new version of TaskCalendar is ready.');
    const options = toast.mock.calls[0][1] as { duration: number; action: { label: string; onClick: () => void } };
    expect(options.duration).toBe(Infinity);
    expect(options.action.label).toBe('Reload');
    options.action.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_CHECK_MS * 3); });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('looks again as soon as the tab is looked at again', async () => {
    const check = vi.fn(async () => true);
    show(check);
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    expect(check).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('takes the new version by itself at the next move to another page', async () => {
    show(async () => true);
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_CHECK_MS + 10); });
    expect(reload).not.toHaveBeenCalled();
    act(() => go('/crm/contacts'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload over an open window: nothing being typed is lost, no call is cut', async () => {
    show(async () => true);
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_CHECK_MS + 10); });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    try {
      act(() => go('/crm/contacts'));
      expect(reload).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
    act(() => go('/tasks'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once when a page’s file is gone from the server, instead of showing an error', () => {
    show(async () => false);
    const first = new Event('vite:preloadError', { cancelable: true });
    act(() => { window.dispatchEvent(first); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);
    // A second failure straight after is left to the error screen: no loop.
    const second = new Event('vite:preloadError', { cancelable: true });
    act(() => { window.dispatchEvent(second); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });
});
