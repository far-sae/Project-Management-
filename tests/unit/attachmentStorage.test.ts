import { beforeEach, describe, expect, it, vi } from 'vitest';

// Record which Storage bucket each call targets. The production project has
// no `attachments` bucket (removed with the CRM), so every comment/chat
// upload must go to a bucket that actually exists.
const bucketsUsed: string[] = [];
vi.mock('@/services/supabase/config', () => {
  const storageApi = {
    upload: vi.fn(async () => ({ error: null })),
    getPublicUrl: vi.fn((p: string) => ({ data: { publicUrl: `https://x/${p}` } })),
    remove: vi.fn(async () => ({ error: null })),
  };
  return {
    supabase: {
      storage: {
        from: vi.fn((bucket: string) => {
          bucketsUsed.push(bucket);
          return storageApi;
        }),
      },
      from: vi.fn(() => ({
        insert: vi.fn(() => Promise.resolve({ error: null })),
      })),
    },
  };
});

import {
  ATTACHMENTS_BUCKET,
  uploadChatAttachment,
  uploadCommentAttachment,
} from '@/services/supabase/storage';

const file = () => new File(['hello'], 'notes.txt', { type: 'text/plain' });

describe('attachment uploads', () => {
  beforeEach(() => {
    bucketsUsed.length = 0;
  });

  it('uses the existing public project-files bucket', () => {
    expect(ATTACHMENTS_BUCKET).toBe('project-files');
  });

  it('task comment attachments never touch the deleted attachments bucket', async () => {
    const res = await uploadCommentAttachment(file(), 'task-1', 'org-1', {
      projectId: 'proj-1',
      userId: 'u1',
      userName: 'U',
    });
    expect(bucketsUsed.length).toBeGreaterThan(0);
    expect(bucketsUsed.every((b) => b === 'project-files')).toBe(true);
    expect(res.fileUrl).toContain('org-1/tasks/task-1/');
  });

  it('chat attachments never touch the deleted attachments bucket', async () => {
    await uploadChatAttachment(file(), { kind: 'dm', threadKey: 'a__b' });
    expect(bucketsUsed.every((b) => b === 'project-files')).toBe(true);
  });
});
