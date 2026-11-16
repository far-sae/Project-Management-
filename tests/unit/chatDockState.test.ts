import { describe, expect, it } from 'vitest';
import {
  chatDockReducer,
  deserializeDock,
  serializeDock,
  type ChatDockState,
} from '@/components/messaging/chatDockState';

const p = (id: string) => ({ userId: id, displayName: id.toUpperCase(), organizationId: 'org1' });
const empty: ChatDockState = { chats: [] };
const ids = (s: ChatDockState) => s.chats.map((c) => `${c.recipient.userId}${c.minimized ? '-' : '+'}`);

describe('chatDockReducer', () => {
  it('opens a chat expanded, newest first', () => {
    let s = chatDockReducer(empty, { type: 'open', recipient: p('a'), maxExpanded: 3 });
    s = chatDockReducer(s, { type: 'open', recipient: p('b'), maxExpanded: 3 });
    expect(ids(s)).toEqual(['b+', 'a+']);
  });

  it('minimising keeps the chat as a bar instead of removing it', () => {
    let s = chatDockReducer(empty, { type: 'open', recipient: p('a'), maxExpanded: 3 });
    s = chatDockReducer(s, { type: 'minimize', userId: 'a' });
    expect(ids(s)).toEqual(['a-']);
  });

  it('re-opening a minimised chat expands it and brings it to the front', () => {
    let s = chatDockReducer(empty, { type: 'open', recipient: p('a'), maxExpanded: 3 });
    s = chatDockReducer(s, { type: 'open', recipient: p('b'), maxExpanded: 3 });
    s = chatDockReducer(s, { type: 'minimize', userId: 'a' });
    s = chatDockReducer(s, { type: 'open', recipient: p('a'), maxExpanded: 3 });
    expect(ids(s)).toEqual(['a+', 'b+']);
  });

  it('when too many are open, the oldest open one is minimised (not lost)', () => {
    let s = empty;
    for (const id of ['a', 'b', 'c']) s = chatDockReducer(s, { type: 'open', recipient: p(id), maxExpanded: 2 });
    expect(ids(s)).toEqual(['c+', 'b+', 'a-']);
  });

  it('close removes the chat completely', () => {
    let s = chatDockReducer(empty, { type: 'open', recipient: p('a'), maxExpanded: 3 });
    s = chatDockReducer(s, { type: 'close', userId: 'a' });
    expect(s.chats).toEqual([]);
  });

  it('an incoming message adds a minimised bar only if that chat is not already there', () => {
    let s = chatDockReducer(empty, { type: 'incoming', recipient: p('a') });
    expect(ids(s)).toEqual(['a-']);
    s = chatDockReducer(s, { type: 'open', recipient: p('a'), maxExpanded: 3 });
    s = chatDockReducer(s, { type: 'incoming', recipient: p('a') });
    expect(ids(s)).toEqual(['a+']);
  });

  it('keeps at most 8 chats, dropping the oldest', () => {
    let s = empty;
    for (let i = 0; i < 10; i++) s = chatDockReducer(s, { type: 'open', recipient: p(`u${i}`), maxExpanded: 3 });
    expect(s.chats).toHaveLength(8);
    expect(s.chats[0].recipient.userId).toBe('u9');
  });
});

describe('dock persistence', () => {
  it('round-trips and ignores junk', () => {
    let s = chatDockReducer(empty, { type: 'open', recipient: p('a'), maxExpanded: 3 });
    s = chatDockReducer(s, { type: 'minimize', userId: 'a' });
    expect(deserializeDock(serializeDock(s))).toEqual(s);
    expect(deserializeDock('not json')).toEqual(empty);
    expect(deserializeDock(JSON.stringify({ chats: [{ recipient: { nope: 1 } }] }))).toEqual(empty);
  });
});
