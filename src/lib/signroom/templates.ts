/**
 * Small rules for the agreement templates list and preview. Pure: no React, no
 * network.
 */
import {
  FIELD_TYPES, type AgreementTemplate, type AgreementTemplateSummary, type FieldKind,
} from '../../../api/_signroom/shared/types';
import { FIELD_LABELS } from './agreementFields';

/** Saving a template under a name that is already used makes a new version; the earlier ones stay. */
export const isOlderVersion = (
  template: Pick<AgreementTemplateSummary, 'name' | 'version'>,
  all: Pick<AgreementTemplateSummary, 'name' | 'version'>[],
): boolean => all.some((other) => other.name === template.name && other.version > template.version);

/** The templates whose name or type contains the search, by name, with the newest version of a name first. */
export function filterTemplates<T extends AgreementTemplateSummary>(list: T[], search: string): T[] {
  const wanted = search.trim().toLowerCase();
  return list
    .filter((t) => !wanted || `${t.name} ${t.type}`.toLowerCase().includes(wanted))
    .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
}

export interface RoleSummary {
  /** The signer role, such as "Client". */
  role: string;
  /** What that signer fills in, such as "Signature" or "Date signed × 2". */
  fields: string[];
}

/** Each signer role of a template with the fields placed for it, counted by kind. */
export function roleSummaries(template: {
  roles: AgreementTemplate['roles'];
  fields: { roleIndex: number; kind: FieldKind }[];
}): RoleSummary[] {
  return template.roles.map((role, index) => {
    const mine = template.fields.filter((f) => f.roleIndex === index);
    const fields = FIELD_TYPES.flatMap((kind) => {
      const count = mine.filter((f) => f.kind === kind).length;
      return count === 0 ? [] : [count === 1 ? FIELD_LABELS[kind] : `${FIELD_LABELS[kind]} × ${count}`];
    });
    return { role, fields };
  });
}
