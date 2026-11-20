// The pure helpers behind the assistant and agents screens: editing a draft, converting, and the wording rules.
import { describe, expect, it } from 'vitest';
import {
  agentInputOf, approvalReading, askFirstSentence, assumptionsHeading, automationInputOf, draftAfterSave, draftAgentOf,
  draftFromAutomation, moveDraftStep, moveItem, oneLine, positionInWords, ranThisMonth, removeDraftStep,
  renameDraft, sameAgentInput, setDraftStepStart, setSkipImports, startInWords, startOfKind, startPhrase,
  stepsWithAgent, stepsWithout, toggleRight,
} from '@/lib/automation/draft';
import { allAgents, automation, draft, qualifier, researcher, writer } from './fixtures';

const names = (d: { steps: Array<{ agent: { name: string } }> }) => d.steps.map((s) => s.agent.name);

describe('editing a draft', () => {
  it('moves a step up or down and leaves the original alone', () => {
    const d = draft();
    expect(names(moveDraftStep(d, 1, -1))).toEqual(['Qualifier', 'Researcher', 'Writer', 'Chaser']);
    expect(names(moveDraftStep(d, 1, 1))).toEqual(['Researcher', 'Writer', 'Qualifier', 'Chaser']);
    expect(names(d)).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
  });

  it('does nothing when the step is already at that end, or is not there', () => {
    const d = draft();
    expect(moveDraftStep(d, 0, -1)).toBe(d);
    expect(moveDraftStep(d, 3, 1)).toBe(d);
    expect(moveDraftStep(d, 9, 1)).toBe(d);
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
  });

  it('removes a step', () => {
    const d = draft();
    expect(names(removeDraftStep(d, 2))).toEqual(['Researcher', 'Qualifier', 'Chaser']);
    expect(removeDraftStep(d, 9)).toBe(d);
    expect(d.steps).toHaveLength(4);
  });

  it('changes when one step starts', () => {
    const d = draft();
    const next = setDraftStepStart(d, 1, { type: 'on_reply' });
    expect(next.steps[1].starts).toEqual({ type: 'on_reply' });
    expect(next.steps[0]).toBe(d.steps[0]);
    expect(d.steps[1].starts).toEqual({ type: 'after_previous' });
  });

  it('renames it and sets whether imports are skipped', () => {
    const d = draft();
    expect(renameDraft(d, 'Leads').name).toBe('Leads');
    expect(setSkipImports(d, true).trigger).toEqual({ type: 'lead_created', skipImports: true });
    expect(d.trigger.skipImports).toBe(false);
  });
});

describe('when a step starts', () => {
  it('is said in words', () => {
    expect(startInWords({ type: 'after_previous' }, true)).toBe('Starts as soon as the lead is added');
    expect(startInWords({ type: 'after_previous' }, false)).toBe('Starts straight away');
    expect(startInWords({ type: 'no_reply_days', days: 3 }, false)).toBe('Starts after 3 days with no reply');
    expect(startInWords({ type: 'no_reply_days', days: 1 }, false)).toBe('Starts after 1 day with no reply');
    expect(startInWords({ type: 'on_reply' }, false)).toBe('Starts when the lead replies');
    expect(startInWords({ type: 'on_deal_won' }, false)).toBe('Starts when the deal is won');
    expect(startPhrase({ type: 'on_deal_won' }, false)).toBe('when the deal is won');
  });

  it('is built from the kind the person picked, keeping the days they had', () => {
    expect(startOfKind('after_previous')).toEqual({ type: 'after_previous' });
    expect(startOfKind('on_reply')).toEqual({ type: 'on_reply' });
    expect(startOfKind('on_deal_won')).toEqual({ type: 'on_deal_won' });
    expect(startOfKind('no_reply_days')).toEqual({ type: 'no_reply_days', days: 3 });
    expect(startOfKind('no_reply_days', 5)).toEqual({ type: 'no_reply_days', days: 5 });
  });

  it('keeps the days a whole number between 1 and 60', () => {
    expect(startOfKind('no_reply_days', 0)).toEqual({ type: 'no_reply_days', days: 1 });
    expect(startOfKind('no_reply_days', 400)).toEqual({ type: 'no_reply_days', days: 60 });
    expect(startOfKind('no_reply_days', 2.6)).toEqual({ type: 'no_reply_days', days: 3 });
    expect(startOfKind('no_reply_days', Number.NaN)).toEqual({ type: 'no_reply_days', days: 3 });
  });
});

describe('whether a step waits for a person', () => {
  it('always needs approval when the agent asks first', () => {
    expect(approvalReading({ rights: [], askFirst: true }).label).toBe('Needs approval');
    expect(approvalReading({ rights: ['send_email'], askFirst: true }, 'full').label).toBe('Needs approval');
  });

  it('is automatic for an agent that sends nothing and changes no deal', () => {
    expect(approvalReading({ rights: ['add_notes_followups', 'change_lead_step', 'look_up_web'], askFirst: false }).label).toBe('Automatic');
    expect(approvalReading({ rights: [], askFirst: false }, 'ask_external').label).toBe('Automatic');
  });

  it('says "may" when it depends on rules that are not known', () => {
    expect(approvalReading({ rights: ['send_email'], askFirst: false }).label).toBe('May need approval');
    expect(approvalReading({ rights: ['change_deals_projects'], askFirst: false }, null).label).toBe('May need approval');
  });

  it('follows the workspace rules once they are known', () => {
    const emails = { rights: ['send_email' as const], askFirst: false };
    const deals = { rights: ['change_deals_projects' as const], askFirst: false };
    const notes = { rights: ['add_notes_followups' as const], askFirst: false };
    expect(approvalReading(notes, 'suggest').label).toBe('Needs approval');
    expect(approvalReading(emails, 'full').label).toBe('Automatic');
    expect(approvalReading(deals, 'full').label).toBe('Automatic');
    expect(approvalReading(emails, 'ask_external').label).toBe('Needs approval');
    // Opening and moving a deal is automatic there; only marking it won or lost waits.
    expect(approvalReading(deals, 'ask_external').label).toBe('May need approval');
    expect(approvalReading(notes, 'ask_external').label).toBe('Automatic');
  });

  it('gives the reason in a sentence', () => {
    expect(approvalReading({ rights: [], askFirst: true }).why).toMatch(/waits for a person/);
    expect(approvalReading({ rights: ['send_email'], askFirst: false }).why).toMatch(/workspace rules/);
  });
});

describe('converting a saved automation', () => {
  it('makes a draft from an automation and its agents', () => {
    const d = draftFromAutomation(automation(), allAgents());
    expect(d.name).toBe('New lead to project');
    expect(d.trigger).toEqual({ type: 'lead_created', skipImports: false });
    expect(names(d)).toEqual(['Researcher', 'Qualifier', 'Writer', 'Chaser']);
    expect(d.steps[0].agent).toEqual({
      id: 'ag1', name: 'Researcher', job: researcher.job, rights: ['add_notes_followups', 'look_up_web'], askFirst: false,
    });
    expect(d.steps[0].does).toBe('Look up the lead and their company.');
    expect(d.steps[0].gives).toBe('');
    expect(d.steps[3].starts).toEqual({ type: 'no_reply_days', days: 3 });
  });

  it('uses the one-line descriptions it is given', () => {
    const d = draftFromAutomation(automation(), allAgents(), { ag2: 'Decides good fit or not' });
    expect(d.steps[1].does).toBe('Decides good fit or not');
  });

  it('keeps a step whose agent is gone, by its id', () => {
    const d = draftFromAutomation(automation(), allAgents().filter((a) => a.id !== 'ag3'));
    expect(d.steps[2].agent).toEqual({ id: 'ag3', name: 'Removed agent', job: '', rights: [], askFirst: false });
  });

  it('does not share the agent’s own list of rights', () => {
    const copy = draftAgentOf(writer);
    copy.rights.push('look_up_web');
    expect(writer.rights).toEqual(['send_email']);
  });

  it('gives a saved draft the ids of the agents the server made, keeping its wording', () => {
    const local = draft();
    const saved = automation({ name: 'New lead to project', steps: automation().steps.slice(0, 3) });
    const next = draftAfterSave({ ...local, steps: local.steps.slice(0, 2) }, saved);
    expect(next.steps.map((s) => s.agent.id)).toEqual(['ag1', 'ag2', 'ag3']);
    expect(next.steps[0].agent.name).toBe('Researcher');
    expect(next.steps[0].gives).toBe('the summary');
    expect(next.steps[2].agent.name).toBe('Agent');
    expect(local.steps[0].agent.id).toBeNull();
  });

  it('gives what a chain is saved with', () => {
    const a = automation();
    expect(automationInputOf(a)).toEqual({ name: a.name, trigger: a.trigger, steps: a.steps });
    expect(automationInputOf(a, a.steps.slice(0, 1)).steps).toEqual([a.steps[0]]);
  });

  it('removes one step, and adds an agent at the end', () => {
    const a = automation();
    expect(stepsWithout(a.steps, 's2').map((s) => s.id)).toEqual(['s1', 's3', 's4']);
    const added = stepsWithAgent(a.steps, 'ag9', { type: 'on_deal_won' }, 'new-id');
    expect(added).toHaveLength(5);
    expect(added[4]).toEqual({ id: 'new-id', agentId: 'ag9', starts: { type: 'on_deal_won' } });
    expect(a.steps).toHaveLength(4);
  });
});

describe('an agent’s form', () => {
  it('is what the agent is saved with', () => {
    expect(agentInputOf(qualifier)).toEqual({
      name: 'Qualifier', job: qualifier.job, rights: ['change_lead_step', 'add_notes_followups'], askFirst: false,
    });
  });

  it('is unchanged whatever order the rights are in, and changed by anything else', () => {
    const base = agentInputOf(qualifier);
    expect(sameAgentInput(base, { ...base, rights: ['add_notes_followups', 'change_lead_step'] })).toBe(true);
    expect(sameAgentInput(base, { ...base, rights: ['change_lead_step'] })).toBe(false);
    expect(sameAgentInput(base, { ...base, name: 'Q' })).toBe(false);
    expect(sameAgentInput(base, { ...base, job: 'x' })).toBe(false);
    expect(sameAgentInput(base, { ...base, askFirst: true })).toBe(false);
  });

  it('switches one right on or off, in the list’s own order', () => {
    expect(toggleRight(['send_email'], 'change_lead_step', true)).toEqual(['change_lead_step', 'send_email']);
    expect(toggleRight(['change_lead_step', 'send_email'], 'send_email', false)).toEqual(['change_lead_step']);
    expect(toggleRight(['send_email'], 'send_email', true)).toEqual(['send_email']);
  });

  it('says what "Ask me before it acts" means for this agent', () => {
    expect(askFirstSentence('Writer', ['send_email'], true)).toBe('On: everything Writer wants to do waits for a person to approve it.');
    expect(askFirstSentence('Qualifier', ['change_lead_step', 'add_notes_followups'], false))
      .toBe('Off for this agent: it only changes the lead’s step and adds notes and follow-ups, which can be undone.');
    expect(askFirstSentence('Writer', ['send_email'], false))
      .toBe('Off: it acts alone where the workspace rules allow it. Sending an email or marking a deal won or lost still waits for a person when the rules say so.');
    expect(askFirstSentence('Reader', [], false)).toBe('Off: this agent can only read, so there is nothing to approve.');
    expect(askFirstSentence('', [], true)).toBe('On: everything this agent wants to do waits for a person to approve it.');
  });
});

describe('wording', () => {
  it('cuts a job down to its first sentence', () => {
    expect(oneLine('Decide the fit.  Give a score.')).toBe('Decide the fit.');
    expect(oneLine('  No full stop here  ')).toBe('No full stop here');
    expect(oneLine('a'.repeat(200))).toHaveLength(110);
    expect(oneLine('a'.repeat(200)).endsWith('…')).toBe(true);
    expect(oneLine('')).toBe('');
  });

  it('counts the assumptions in words', () => {
    expect(assumptionsHeading(1)).toBe('One thing I assumed, change it if it is wrong:');
    expect(assumptionsHeading(2)).toBe('Two things I assumed, change them if they are wrong:');
    expect(assumptionsHeading(4)).toBe('Four things I assumed, change them if they are wrong:');
    expect(assumptionsHeading(12)).toBe('12 things I assumed, change them if they are wrong:');
  });

  it('says where an agent is in the chain and how often it ran', () => {
    expect(positionInWords(1)).toBe('First in the chain');
    expect(positionInWords(3)).toBe('Third in the chain');
    expect(positionInWords(14)).toBe('Number 14 in the chain');
    expect(ranThisMonth(0)).toBe('has not run this month');
    expect(ranThisMonth(1)).toBe('ran once this month');
    expect(ranThisMonth(31)).toBe('ran 31 times this month');
  });
});
