// Server-side provider configuration registry.
// Each provider lists its OAuth endpoints, env-var names for client_id/secret,
// and the set of scopes that Phase 1 of the framework registers for.
// Concrete actions (send-email, create-meet, slack-post) are added to this
// registry by the per-integration plans that follow.

export type ProviderId = 'google' | 'gmail' | 'slack';

export interface ProviderConfig {
  id: ProviderId;
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
  // org-level providers store one row per org, not per user
  orgLevel: boolean;
}

export const providers: Record<ProviderId, ProviderConfig> = {
  google: {
    id: 'google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    // Google Meet: create Calendar events with attached Meet conference links.
    // openid/email/profile identify the connected account in the Settings UI.
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    orgLevel: false,
  },
  gmail: {
    id: 'gmail',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    // gmail.send only — we never request gmail.readonly / gmail.modify so no
    // CASA audit is required. openid/email/profile identify the connected
    // account label in Settings.
    scopes: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    orgLevel: false,
  },
  slack: {
    id: 'slack',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    // Bot scopes for the v2 OAuth flow:
    //   chat:write          — post messages to channels the bot is in
    //   chat:write.public   — post in public channels without joining first
    //   channels:read       — list public channels for the channel picker UI
    //   groups:read         — list private channels for the channel picker
    //   users:read          — resolve user ids to display names in messages
    // `commands` is intentionally omitted until slash-command handlers exist.
    scopes: [
      'chat:write',
      'chat:write.public',
      'channels:read',
      'groups:read',
      'users:read',
    ],
    orgLevel: true,
  },
};

export function getProvider(id: string): ProviderConfig {
  if (!(id in providers)) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return providers[id as ProviderId];
}
