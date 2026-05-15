import type { ProviderDisplay, ProviderId } from './types';

export const providerDisplay: Record<ProviderId, ProviderDisplay> = {
  google: {
    id: 'google',
    label: 'Google Meet',
    description: 'Add Google Meet links to tasks with a due date and time.',
    iconName: 'Video',
    accent: 'text-emerald-600',
    orgLevel: false,
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail',
    description: 'Send task notifications from your own Gmail address.',
    iconName: 'Mail',
    accent: 'text-rose-600',
    orgLevel: false,
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    description: 'Post project activity to a Slack channel and create tasks from messages.',
    iconName: 'MessageSquare',
    accent: 'text-violet-600',
    orgLevel: true,
  },
};

export const providerOrder: ProviderId[] = ['google', 'gmail', 'slack'];
