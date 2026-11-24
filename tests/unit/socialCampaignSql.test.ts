// A social media campaign could not be saved: the check that guards both a
// campaign and a post read the post's own fields straight from the row, and the
// database stopped with: record "new" has no field "campaign_id".
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/206_social_campaign_can_be_made.sql'), 'utf8');
const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

describe('the check on a social campaign and a post', () => {
  it('never reads a field straight from the row that a campaign does not have', () => {
    expect(code).not.toMatch(/new\.campaign_id|new\.account_id/i);
  });

  it('still keeps a post to the campaigns and accounts of its own workspace', () => {
    expect(code).toContain('Campaign must belong to the same workspace');
    expect(code).toContain('Social account must belong to the same workspace');
    expect(code).toContain('Workspace does not belong to organization');
  });

  it('is in the set-up file, and can be run again', () => {
    expect(sql).toContain('Safe to run more than once.');
    expect(readFileSync(resolve(__dirname, '../../supabase/crm_setup.sql'), 'utf8')).toContain('206_social_campaign_can_be_made.sql');
  });
});
