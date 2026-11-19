// HR follows the selected workspace: who is in scope for a selection, who has
// no workspace yet, and the short lines that say whose data is showing.
import { describe, expect, it } from 'vitest';
import { ALL_WORKSPACES_ID, UNASSIGNED_WORKSPACE_ID } from '@/lib/workspaceScope';
import {
  hrFigureNote,
  hrScopeLabel,
  hrScopedUserIds,
  hrUnassignedNotice,
  hrUnassignedPeople,
  isInHrScope,
  toHrAssignments,
} from '@/lib/hrWorkspace';

const STUDIO = 'ws-studio';
const AGENCY = 'ws-agency';

const MEMBERS = [
  { userId: 'sam', displayName: 'Sam', status: 'active' },
  { userId: 'priya', displayName: 'Priya Nair', status: 'active' },
  { userId: 'tom', displayName: 'Tom Okafor', status: 'active' },
  { userId: 'lee', displayName: 'Lee', status: 'invited' },
];

// Sam and Priya are in Studio, Tom is in Agency, Lee has no workspace.
const ASSIGNED = new Map([
  ['sam', STUDIO],
  ['priya', STUDIO],
  ['tom', AGENCY],
]);

const ids = (set: Set<string> | null) => (set ? [...set].sort() : null);

describe('toHrAssignments', () => {
  it('turns the saved rows into a person → workspace map', () => {
    const map = toHrAssignments([
      { userId: 'sam', workspaceId: STUDIO },
      { userId: 'tom', workspaceId: AGENCY },
    ]);
    expect(map.get('sam')).toBe(STUDIO);
    expect(map.get('tom')).toBe(AGENCY);
    expect(map.size).toBe(2);
  });
});

describe('hrScopedUserIds', () => {
  it('a real workspace → the people assigned to it', () => {
    expect(ids(hrScopedUserIds(MEMBERS, ASSIGNED, STUDIO))).toEqual(['priya', 'sam']);
    expect(ids(hrScopedUserIds(MEMBERS, ASSIGNED, AGENCY))).toEqual(['tom']);
  });

  it('"Unassigned" → the people with no assignment', () => {
    expect(ids(hrScopedUserIds(MEMBERS, ASSIGNED, UNASSIGNED_WORKSPACE_ID))).toEqual(['lee']);
  });

  it('"All workspaces" → everyone (null means no filtering)', () => {
    expect(hrScopedUserIds(MEMBERS, ASSIGNED, ALL_WORKSPACES_ID)).toBeNull();
  });

  it('table missing → everyone, whatever is selected', () => {
    expect(hrScopedUserIds(MEMBERS, null, STUDIO)).toBeNull();
    expect(hrScopedUserIds(MEMBERS, null, UNASSIGNED_WORKSPACE_ID)).toBeNull();
    expect(hrScopedUserIds(MEMBERS, null, ALL_WORKSPACES_ID)).toBeNull();
  });

  it('a workspace nobody is assigned to → an empty set, not "everyone"', () => {
    const set = hrScopedUserIds(MEMBERS, new Map(), STUDIO);
    expect(set).not.toBeNull();
    expect(set?.size).toBe(0);
  });

  it('with nobody assigned yet, everyone is under "Unassigned"', () => {
    expect(ids(hrScopedUserIds(MEMBERS, new Map(), UNASSIGNED_WORKSPACE_ID))).toEqual([
      'lee',
      'priya',
      'sam',
      'tom',
    ]);
  });
});

describe('isInHrScope', () => {
  it('follows the same rule one person at a time', () => {
    expect(isInHrScope('sam', ASSIGNED, STUDIO)).toBe(true);
    expect(isInHrScope('tom', ASSIGNED, STUDIO)).toBe(false);
    expect(isInHrScope('lee', ASSIGNED, STUDIO)).toBe(false);
    expect(isInHrScope('lee', ASSIGNED, UNASSIGNED_WORKSPACE_ID)).toBe(true);
    expect(isInHrScope('sam', ASSIGNED, UNASSIGNED_WORKSPACE_ID)).toBe(false);
    expect(isInHrScope('tom', ASSIGNED, ALL_WORKSPACES_ID)).toBe(true);
  });

  it('table missing → always in scope', () => {
    expect(isInHrScope('tom', null, STUDIO)).toBe(true);
    expect(isInHrScope('sam', null, UNASSIGNED_WORKSPACE_ID)).toBe(true);
  });

  it('keeps the records of someone who has left the organization findable', () => {
    // "gone" is not a member any more. Their old payslip still belongs to
    // exactly one place: the workspace they were in, or "Unassigned".
    const withLeaver = new Map([...ASSIGNED, ['gone-studio', STUDIO]]);
    expect(isInHrScope('gone-studio', withLeaver, STUDIO)).toBe(true);
    expect(isInHrScope('gone-studio', withLeaver, UNASSIGNED_WORKSPACE_ID)).toBe(false);
    expect(isInHrScope('gone-nowhere', withLeaver, UNASSIGNED_WORKSPACE_ID)).toBe(true);
    expect(isInHrScope('gone-nowhere', withLeaver, STUDIO)).toBe(false);
  });

  it('every person is in exactly one of: a workspace, or "Unassigned"', () => {
    for (const m of MEMBERS) {
      const places = [STUDIO, AGENCY, UNASSIGNED_WORKSPACE_ID].filter((id) => isInHrScope(m.userId, ASSIGNED, id));
      expect(places).toHaveLength(1);
    }
  });
});

describe('hrUnassignedPeople', () => {
  it('lists the people with no workspace, in the order given', () => {
    expect(hrUnassignedPeople(MEMBERS, ASSIGNED).map((m) => m.userId)).toEqual(['lee']);
    expect(hrUnassignedPeople(MEMBERS, new Map()).map((m) => m.userId)).toEqual(['sam', 'priya', 'tom', 'lee']);
  });

  it('table missing → nobody is reported as unassigned', () => {
    expect(hrUnassignedPeople(MEMBERS, null)).toEqual([]);
  });

  it('leaves out people who were removed from the organization', () => {
    const members = [...MEMBERS, { userId: 'old', displayName: 'Old', status: 'removed' }];
    expect(hrUnassignedPeople(members, ASSIGNED).map((m) => m.userId)).toEqual(['lee']);
  });

  it('does not depend on which workspace is selected', () => {
    // The notice counts the same people whether Studio or Agency is open.
    expect(hrUnassignedPeople(MEMBERS, ASSIGNED)).toHaveLength(1);
  });
});

describe('hrScopeLabel', () => {
  it('names the workspace that is showing', () => {
    expect(hrScopeLabel(STUDIO, 'Studio')).toBe('Showing Studio');
  });
  it('says when it is the people with no workspace', () => {
    expect(hrScopeLabel(UNASSIGNED_WORKSPACE_ID)).toBe('Showing people with no workspace');
  });
  it('says when it is the whole company', () => {
    expect(hrScopeLabel(ALL_WORKSPACES_ID)).toBe('Showing the whole company');
  });
  it('still reads well while the workspace name is unknown', () => {
    expect(hrScopeLabel(STUDIO, null)).toBe('Showing this workspace');
    expect(hrScopeLabel(STUDIO, '  ')).toBe('Showing this workspace');
  });
});

describe('hrFigureNote', () => {
  it('marks a figure that covers only part of the company', () => {
    expect(hrFigureNote(STUDIO, 'Studio')).toBe('For Studio only');
    expect(hrFigureNote(STUDIO, null)).toBe('For this workspace only');
    expect(hrFigureNote(UNASSIGNED_WORKSPACE_ID)).toBe('For people with no workspace only');
  });
  it('says nothing when the figure is for the whole company', () => {
    expect(hrFigureNote(ALL_WORKSPACES_ID)).toBeNull();
  });
});

describe('hrUnassignedNotice', () => {
  it('counts the people who are not in a workspace yet', () => {
    expect(hrUnassignedNotice(3)).toBe('3 people are not in a workspace yet.');
    expect(hrUnassignedNotice(1)).toBe('1 person is not in a workspace yet.');
  });
});
