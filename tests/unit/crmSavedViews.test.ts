// Saved views of the Leads list: what is kept, and that bad storage never breaks the page.
import { describe, expect, it } from 'vitest';
import { MAX_VIEWS, readViews, sameView, viewsKey, withView, withoutView, writeViews, type LeadViewState } from '@/lib/crmSavedViews';

const state = (over: Partial<LeadViewState> = {}): LeadViewState => ({ search: '', step: 'all', category: 'all', owner: 'all', sort: null, ...over });

describe('saved views', () => {
  it('adds a view, and replaces one with the same name whatever the capitals', () => {
    const one = withView([], ' Hot leads ', state({ step: 'qualified', search: ' leeds ' }), 'v1');
    expect(one).toEqual([{ id: 'v1', name: 'Hot leads', state: state({ step: 'qualified', search: 'leeds' }) }]);
    const two = withView(one, 'hot LEADS', state({ owner: 'mine' }), 'v2');
    expect(two).toEqual([{ id: 'v1', name: 'hot LEADS', state: state({ owner: 'mine' }) }]);
    expect(withView(two, '   ', state(), 'v3')).toBe(two);
  });

  it('keeps the newest twenty', () => {
    let views = [] as ReturnType<typeof withView>;
    for (let i = 0; i < MAX_VIEWS + 3; i += 1) views = withView(views, `View ${i}`, state(), `v${i}`);
    expect(views).toHaveLength(MAX_VIEWS);
    expect(views[0].name).toBe('View 3');
  });

  it('removes one view', () => {
    const views = withView(withView([], 'A', state(), 'a'), 'B', state(), 'b');
    expect(withoutView(views, 'a').map((v) => v.name)).toEqual(['B']);
  });

  it('knows when two views show the same list', () => {
    expect(sameView(state({ search: 'leeds ' }), state({ search: 'leeds' }))).toBe(true);
    expect(sameView(state({ sort: { key: 'name', direction: 'asc' } }), state({ sort: { key: 'name', direction: 'desc' } }))).toBe(false);
    expect(sameView(state({ owner: 'mine' }), state())).toBe(false);
  });

  it('keeps each person and each workspace apart', () => {
    expect(viewsKey('u1', 'w1')).not.toBe(viewsKey('u2', 'w1'));
    expect(viewsKey('u1', 'w1')).not.toBe(viewsKey('u1', 'w2'));
  });
});

describe('reading and writing them in the browser', () => {
  const store = (initial: Record<string, string> = {}) => {
    const data = { ...initial };
    return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
  };

  it('gives back what was written', () => {
    const s = store();
    const views = withView([], 'Mine', state({ owner: 'mine', sort: { key: 'added', direction: 'desc' } }), 'v1');
    expect(writeViews(s, 'k', views)).toBe(true);
    expect(readViews(s, 'k')).toEqual(views);
  });

  it('is empty, not broken, when storage holds something else or cannot be used', () => {
    expect(readViews(store({ k: 'not json' }), 'k')).toEqual([]);
    expect(readViews(store({ k: '{"a":1}' }), 'k')).toEqual([]);
    expect(readViews(null, 'k')).toEqual([]);
    expect(readViews({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined }, 'k')).toEqual([]);
    expect(writeViews({ getItem: () => null, setItem: () => { throw new Error('full'); } }, 'k', [])).toBe(false);
    expect(writeViews(null, 'k', [])).toBe(false);
  });

  it('repairs a view whose saved filters are damaged', () => {
    const s = store({ k: JSON.stringify([{ id: 'v1', name: 'Odd', state: { owner: 'everyone', sort: { key: 'shoe', direction: 'up' }, search: 5 } }, { id: 7, name: 'x' }, { id: 'v3', name: ' ' }]) });
    expect(readViews(s, 'k')).toEqual([{ id: 'v1', name: 'Odd', state: state() }]);
  });
});
