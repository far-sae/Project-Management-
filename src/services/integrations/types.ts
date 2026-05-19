export type ProviderId = 'google' | 'gmail' | 'slack' | 'telegram' | 'whatsapp';

export type IntegrationStatus = 'active' | 'revoked' | 'error' | 'pending' | 'not_connected';

export interface IntegrationRow {
  id: string;
  provider: ProviderId;
  status: IntegrationStatus;
  scopes: string[];
  connected_at: string;
  metadata: Record<string, unknown>;
}

export interface ProviderDisplay {
  id: ProviderId;
  label: string;
  description: string;
  /** Lucide icon name, resolved at render time */
  iconName: 'Video' | 'Mail' | 'MessageSquare' | 'MessageCircle';
  /** Brand color used as the card accent (Tailwind class fragment) */
  accent: string;
  /** Whether this provider is org-level (admin-only) */
  orgLevel: boolean;
}
