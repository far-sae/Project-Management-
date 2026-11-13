import { describe, expect, it, vi } from 'vitest';
import { runCallCheck, type CallCheckDeps, type CallCheckResult } from '@/services/calling/callCheck';

const track = () => ({ stop: vi.fn(), label: 'Built-in device' });
const stream = () => {
  const t = track();
  return { getTracks: () => [t], t };
};
const domError = (name: string, message = '') => Object.assign(new Error(message), { name });

function deps(over: Partial<CallCheckDeps> = {}): CallCheckDeps {
  return {
    browserSupported: () => true,
    getUserMedia: vi.fn(async () => stream() as unknown as MediaStream),
    checkServer: vi.fn(async () => ({ websocket: true, webrtc: true })),
    checkRinging: vi.fn(async () => true),
    ...over,
  };
}

async function run(d: CallCheckDeps) {
  const updates: CallCheckResult[][] = [];
  const final = await runCallCheck(d, (r) => updates.push(r));
  return { final, updates };
}

const byId = (r: CallCheckResult[], id: string) => r.find((x) => x.id === id)!;

describe('runCallCheck', () => {
  it('passes every step on a healthy machine and releases the devices', async () => {
    const d = deps();
    const { final } = await run(d);
    expect(final.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(final.map((r) => r.id)).toEqual(['browser', 'microphone', 'camera', 'server', 'ringing']);
    expect(d.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('reports a blocked camera in plain words but keeps checking the rest', async () => {
    const d = deps({
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) => {
        if (c.video) throw domError('NotReadableError', 'Could not start video source');
        return stream() as unknown as MediaStream;
      }),
    });
    const { final } = await run(d);
    expect(byId(final, 'camera').status).toBe('fail');
    expect(byId(final, 'camera').detail).toMatch(/another app/);
    expect(byId(final, 'microphone').status).toBe('ok');
    expect(byId(final, 'server').status).toBe('ok');
  });

  it('a missing camera is a warning, not a failure (audio calls still work)', async () => {
    const d = deps({
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) => {
        if (c.video) throw domError('NotFoundError');
        return stream() as unknown as MediaStream;
      }),
    });
    const { final } = await run(d);
    expect(byId(final, 'camera').status).toBe('warn');
  });

  it('tells apart an unreachable server and blocked audio/video', async () => {
    const noWs = await run(deps({ checkServer: vi.fn(async () => ({ websocket: false, webrtc: false })) }));
    expect(byId(noWs.final, 'server').status).toBe('fail');
    expect(byId(noWs.final, 'server').detail).toMatch(/call server/);

    const noRtc = await run(deps({ checkServer: vi.fn(async () => ({ websocket: true, webrtc: false })) }));
    expect(byId(noRtc.final, 'server').detail).toMatch(/firewall|VPN/);
  });

  it('reports server errors such as a failed sign-in token', async () => {
    const { final } = await run(deps({ checkServer: vi.fn(async () => { throw new Error('Not signed in'); }) }));
    expect(byId(final, 'server').status).toBe('fail');
    expect(byId(final, 'server').detail).toContain('Not signed in');
  });

  it('fails the ringing step when incoming calls cannot reach the browser', async () => {
    const { final } = await run(deps({ checkRinging: vi.fn(async () => false) }));
    expect(byId(final, 'ringing').status).toBe('fail');
  });

  it('stops early when the browser cannot make calls at all', async () => {
    const d = deps({ browserSupported: () => false });
    const { final } = await run(d);
    expect(byId(final, 'browser').status).toBe('fail');
    expect(d.getUserMedia).not.toHaveBeenCalled();
    expect(final.filter((r) => r.status === 'skipped')).toHaveLength(4);
  });

  it('streams progress so the page can show each step as it runs', async () => {
    const { updates } = await run(deps());
    expect(updates.length).toBeGreaterThan(5);
    expect(updates[0].some((r) => r.status === 'running')).toBe(true);
  });
});
