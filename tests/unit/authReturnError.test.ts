// After Google / Supabase sign-in fails, the reason comes back in the page
// address. The app used to ignore it, so people just saw the login page again.
import { describe, expect, it } from 'vitest';
import { readAuthReturnError, stripAuthReturnError } from '@/lib/authReturnError';

describe('readAuthReturnError', () => {
  it('returns null when the address has no sign-in error', () => {
    expect(readAuthReturnError('', '')).toBeNull();
    expect(readAuthReturnError('?taskId=42', '#section')).toBeNull();
  });

  it('reads the description from the query string', () => {
    expect(
      readAuthReturnError(
        '?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+4%2F0Ab',
        '',
      ),
    ).toBe('Unable to exchange external code: 4/0Ab');
  });

  it('reads the description from the hash too', () => {
    expect(readAuthReturnError('', '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')).toBe(
      'Email link is invalid or has expired',
    );
  });

  it('falls back to the error code when there is no description', () => {
    expect(readAuthReturnError('?error=access_denied', '')).toBe('access_denied');
  });

  it('ignores an unrelated "error" value that is not a sign-in return', () => {
    // Our own Google callback page handles its own hash; only short codes count.
    expect(readAuthReturnError('?error=', '')).toBeNull();
  });
});

describe('stripAuthReturnError', () => {
  it('removes only the sign-in error parts and keeps everything else', () => {
    expect(stripAuthReturnError('/', '?error=server_error&error_description=x&taskId=42', '')).toBe('/?taskId=42');
    expect(stripAuthReturnError('/login', '?error=x&error_code=y&error_description=z', '')).toBe('/login');
    expect(stripAuthReturnError('/', '', '#error=access_denied&error_description=x')).toBe('/');
    expect(stripAuthReturnError('/project/1', '?taskId=42', '#top')).toBe('/project/1?taskId=42#top');
  });
});
