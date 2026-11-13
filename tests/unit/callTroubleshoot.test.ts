import { describe, expect, it } from 'vitest';
import { explainConnectError, explainMediaError } from '@/lib/callTroubleshoot';

const domError = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('explainMediaError', () => {
  it('tells people how to allow a blocked camera/mic in the browser', () => {
    const msg = explainMediaError(domError('NotAllowedError', 'Permission denied'), 'camera');
    expect(msg).toMatch(/camera/i);
    expect(msg).toMatch(/lock icon/i);
  });

  it('points at Windows privacy settings when the system blocked it', () => {
    const msg = explainMediaError(domError('NotAllowedError', 'Permission denied by system'), 'microphone');
    expect(msg).toMatch(/Windows/);
    expect(msg).toMatch(/Privacy/);
    expect(msg).toMatch(/microphone/i);
  });

  it('explains a missing device (camera key off, no webcam)', () => {
    expect(explainMediaError(domError('NotFoundError'), 'camera')).toMatch(/No camera found/);
    expect(explainMediaError(domError('OverconstrainedError'), 'camera')).toMatch(/No camera found/);
  });

  it('explains a device busy in another app', () => {
    expect(explainMediaError(domError('NotReadableError', 'Could not start video source'), 'camera')).toMatch(
      /another app/,
    );
    expect(explainMediaError(new Error('Could not start audio source'), 'microphone')).toMatch(/another app/);
  });

  it('falls back to the raw message for anything else', () => {
    expect(explainMediaError(new Error('Something odd'), 'camera')).toContain('Something odd');
    expect(explainMediaError('nope', 'camera')).toMatch(/camera/i);
  });
});

describe('explainConnectError', () => {
  it('explains when the call server cannot be reached', () => {
    expect(explainConnectError(new Error('could not establish signal connection'))).toMatch(/call server/);
    expect(explainConnectError(new Error('Failed to fetch'))).toMatch(/call server/);
  });

  it('explains when audio/video is blocked by a firewall or VPN', () => {
    const msg = explainConnectError(new Error('could not establish pc connection'));
    expect(msg).toMatch(/firewall|VPN/);
  });

  it('keeps access errors from the server as they are', () => {
    expect(explainConnectError(new Error("You're not part of this call"))).toBe("You're not part of this call");
  });

  it('has a fallback for unknown values', () => {
    expect(explainConnectError(undefined)).toMatch(/call server/);
  });
});
