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
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    description: 'Manage workspaces, projects, tasks, and clients by texting the bot.',
    iconName: 'MessageCircle',
    accent: 'text-sky-600',
    orgLevel: false,
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Same bot, on WhatsApp. Text it and it creates entries in your workspace.',
    iconName: 'MessageCircle',
    accent: 'text-emerald-600',
    orgLevel: false,
  },
};

export const providerOrder: ProviderId[] = ['google', 'gmail', 'slack'];

/** Filter the provider list by feature flags. Gmail is hidden unless enabled. */
export const visibleProviders = (
  order: ProviderId[],
  features: { gmail: boolean },
): ProviderId[] => order.filter((id) => id !== "gmail" || features.gmail);
