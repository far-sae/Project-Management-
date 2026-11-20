/**
 * The assistant's conversation, kept for the browser tab so a refresh does not
 * lose it. One conversation per workspace for a new automation, and one per
 * saved automation being changed. Storage can be missing or full (private
 * windows, blocked site data), so every read and write is guarded and the
 * page works without it.
 */
import type { AssistantMessage, AutomationDraft } from '../../../../api/_automation/shared/types';

/** One line of the conversation. Only `role` and `text` are sent to the server; the assumptions are shown under a reply. */
export type ChatEntry = AssistantMessage & { assumptions?: string[] };

export type StoredConversation = {
  /** The saved automation's revision when the draft was last read from it, or null for a new automation. */
  revision: number | null;
  messages: ChatEntry[];
  /** The draft, only while it has changes that are not saved. */
  draft: AutomationDraft | null;
};

/** `automationId` is null while the automation has not been saved yet. */
const keyOf = (workspaceId: string, automationId: string | null): string =>
  `crm-automation-assistant:${workspaceId}:${automationId ?? 'new'}`;

const isEntry = (value: unknown): value is ChatEntry => {
  const entry = value as ChatEntry | null;
  return Boolean(entry) && (entry!.role === 'user' || entry!.role === 'assistant') && typeof entry!.text === 'string';
};

const isDraft = (value: unknown): value is AutomationDraft => {
  const draft = value as AutomationDraft | null;
  return Boolean(draft) && typeof draft!.name === 'string' && Array.isArray(draft!.steps)
    && Boolean(draft!.trigger) && typeof draft!.trigger.skipImports === 'boolean'
    && draft!.steps.every((step) => Boolean(step?.agent) && typeof step.agent.name === 'string' && Array.isArray(step.agent.rights) && Boolean(step.starts));
};

export function readConversation(workspaceId: string, automationId: string | null): StoredConversation | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(workspaceId, automationId));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredConversation> | null;
    if (!data || !Array.isArray(data.messages)) return null;
    return {
      revision: typeof data.revision === 'number' ? data.revision : null,
      messages: data.messages.filter(isEntry).map((entry) => ({
        role: entry.role,
        text: entry.text,
        ...(Array.isArray(entry.assumptions) ? { assumptions: entry.assumptions.filter((a) => typeof a === 'string') } : {}),
      })),
      draft: isDraft(data.draft) ? data.draft : null,
    };
  } catch {
    return null;
  }
}

export function writeConversation(workspaceId: string, automationId: string | null, conversation: StoredConversation): void {
  try {
    window.sessionStorage.setItem(keyOf(workspaceId, automationId), JSON.stringify(conversation));
  } catch {
    // Without storage the conversation simply lives in the page until it is closed.
  }
}

export function clearConversation(workspaceId: string, automationId: string | null): void {
  try {
    window.sessionStorage.removeItem(keyOf(workspaceId, automationId));
  } catch {
    // Nothing to clear.
  }
}
