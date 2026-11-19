// Sample templates for the templates screen tests. Every name here is made up.
import type { AgreementTemplate, AgreementTemplateSummary } from '../../../../api/_signroom/shared/types';

export const templateRows: AgreementTemplateSummary[] = [
  { id: 't1', name: 'Standard NDA', type: 'NDA', version: 1, created: '2026-10-01T00:00:00.000Z' },
  { id: 't2', name: 'Standard NDA', type: 'NDA', version: 2, created: '2026-10-05T00:00:00.000Z' },
  { id: 't3', name: 'Retainer', type: 'Service agreement', version: 1, created: '2026-10-06T00:00:00.000Z' },
];

const box = { page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.055, required: true };

export const fullTemplate = (over: Partial<AgreementTemplate> = {}): AgreementTemplate => ({
  ...templateRows[1],
  workspaceId: 'w',
  sourceKind: 'authored',
  content: '# Mutual NDA\n\nThis agreement is between us and {{client_name}}.',
  roles: ['Client', 'Company representative'],
  fields: [
    { id: 'f1', kind: 'signature', label: 'Signature', roleIndex: 0, ...box },
    { id: 'f2', kind: 'date_signed', label: 'Date signed', roleIndex: 0, ...box, y: 0.8 },
    { id: 'f3', kind: 'signature', label: 'Signature', roleIndex: 1, ...box, x: 0.55 },
  ],
  ...over,
});
