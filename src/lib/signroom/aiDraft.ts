/**
 * Wording and small rules for Draft with AI in the agreement editor. Pure: no
 * React, no network. The limits mirror what the documents server enforces, so
 * the Draft button is only offered when the server would accept the text.
 */
import type { Workspace } from '../../../api/_signroom/shared/types';

export const AI_REQUIREMENTS_MIN = 20;
export const AI_REQUIREMENTS_MAX = 10_000;

/** Who writes the draft and from what. Shown before anything is sent. */
export const AI_WRITER_SENTENCE = 'Claude, Anthropic’s AI, writes the draft from what you enter here.';

/** The caution shown wherever an AI draft is: before asking, while reviewing, and in the editor afterwards. */
export const AI_REVIEW_SENTENCE =
  'AI drafts need human review. Check every clause and fill all placeholders before preparing the PDF. Nothing is sent automatically.';

/** Asked before a draft replaces text that is already in the document. */
export const AI_REPLACE_SENTENCE =
  'Replace the current document text? This clears the prepared PDF and all field placements. Review and prepare the new PDF before sending.';

/** One-line reminders of what a useful description covers. */
export const AI_REQUIREMENT_PROMPTS = [
  'What each party must do, and what is delivered.',
  'Fees, payment terms, start date and how long it runs.',
  'Notice to end it, confidentiality and governing law.',
] as const;

const number = (value: number): string => value.toLocaleString('en-GB');

/** Why the requirements cannot be sent yet, or null when they can. The space around the text does not count. */
export function requirementsProblem(requirements: string): string | null {
  const length = requirements.trim().length;
  if (length < AI_REQUIREMENTS_MIN) return `Write at least ${AI_REQUIREMENTS_MIN} characters.`;
  if (length > AI_REQUIREMENTS_MAX) return `Keep the requirements to ${number(AI_REQUIREMENTS_MAX)} characters or fewer.`;
  return null;
}

/** "1,234 / 10,000": how much of the limit is used. */
export const requirementsCount = (requirements: string): string =>
  `${number(requirements.trim().length)} / ${number(AI_REQUIREMENTS_MAX)}`;

/** The company name the server puts in the draft: the one on the workspace's documents, else the workspace's name. */
export const senderNameOf = (workspace: { name: string; branding?: Pick<NonNullable<Workspace['branding']>, 'companyName'> }): string =>
  workspace.branding?.companyName?.trim() || workspace.name;
