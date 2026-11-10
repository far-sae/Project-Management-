import { describe, expect, it } from 'vitest';
import { projectRoomName, taskMeetingRoomName } from '@/services/livekit/fetchLiveKitToken';

describe('taskMeetingRoomName', () => {
  it('gives each task its own room inside the project', () => {
    expect(taskMeetingRoomName('p1', 't1')).toBe('project:p1:task:t1');
    expect(taskMeetingRoomName('p1', 't1')).not.toBe(projectRoomName('p1'));
    expect(taskMeetingRoomName('p1', 't2')).not.toBe(taskMeetingRoomName('p1', 't1'));
  });
});
