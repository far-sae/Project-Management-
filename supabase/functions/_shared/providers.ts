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
    // Filled in by the Google Meet plan; framework registers an empty scope set
    // and the per-provider plans add to it.
    scopes: [],
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
    scopes: [],
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    orgLevel: false,
  },
  slack: {
    id: 'slack',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    scopes: [],
    orgLevel: true,
  },
};

export function getProvider(id: string): ProviderConfig {
  if (!(id in providers)) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return providers[id as ProviderId];
}
