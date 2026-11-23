// Finding leads in Apollo: the rules the page uses.
import { describe, expect, it } from 'vitest';
import {
  APOLLO_ID_FIELD, addedSentence, hiddenName, knownApolloIds, leadFromPerson, mergePendingPhones, phonePatch, phonesSentence,
  readPendingPhones, savePendingPhones, splitList, splitNewLeads,
} from '@/lib/crmProspects';
import type { RevealedPerson } from '../../api/_prospect/shared/types';

const person = (over: Partial<RevealedPerson> = {}): RevealedPerson => ({
  id: 'p1', firstName: 'Elena', lastName: 'Rossi', title: 'Head of Operations', email: 'elena@northwind.example', emailStatus: 'verified',
  linkedinUrl: 'http://www.linkedin.com/in/elena-rossi', city: 'Leeds', state: 'England', country: 'United Kingdom',
  company: { name: 'Northwind Studio', website: 'http://www.northwind.example', industry: 'design', size: 40, city: 'Leeds', state: '', country: 'United Kingdom', phone: '' },
  ...over,
});

describe('what is typed into a filter', () => {
  it('is split on commas, semicolons and new lines, without repeats', () => {
    expect(splitList(' CEO, Founder;Head of  Sales\nceo\n\n')).toEqual(['CEO', 'Founder', 'Head of Sales']);
    expect(splitList('')).toEqual([]);
  });
});

describe('who is a lead already', () => {
  it('is known from the id kept on the lead, so nobody is paid for twice', () => {
    const ids = knownApolloIds([
      { customFields: { [APOLLO_ID_FIELD]: 'p1' } }, { customFields: { Other: 'x' } }, { customFields: null }, {},
    ]);
    expect([...ids]).toEqual(['p1']);
  });

  it('is checked again by email once the email is known', () => {
    const leads = [person(), person({ id: 'p2', email: 'PRIYA@fieldway.example' }), person({ id: 'p3', email: 'priya@fieldway.example' }), person({ id: 'p4', email: 'tom@harbour.example' })].map(leadFromPerson);
    const { fresh, already } = splitNewLeads(leads, ['Elena@Northwind.example']);
    expect(fresh.map((l) => l.apolloId)).toEqual(['p2', 'p4']);
    // Elena is in the CRM; the second Priya repeats the first.
    expect(already.map((l) => l.apolloId)).toEqual(['p1', 'p3']);
  });
});

describe('a person becomes a lead', () => {
  it('with their job, where they are, their profile and their company', () => {
    expect(leadFromPerson(person())).toEqual({
      apolloId: 'p1', firstName: 'Elena', lastName: 'Rossi', email: 'elena@northwind.example', phone: null, jobTitle: 'Head of Operations',
      customFields: {
        'Apollo ID': 'p1', LinkedIn: 'http://www.linkedin.com/in/elena-rossi', Location: 'Leeds, England, United Kingdom', 'Email status': 'verified',
      },
      company: { name: 'Northwind Studio', website: 'http://www.northwind.example', industry: 'design', city: 'Leeds', country: 'United Kingdom', company_size: '40' },
    });
  });

  it('with only what is known, and still a first name', () => {
    const lead = leadFromPerson(person({ firstName: '', lastName: '', title: '', linkedinUrl: '', city: '', state: '', country: '', company: null }));
    expect(lead).toMatchObject({ firstName: 'elena', lastName: null, jobTitle: null, company: null });
    expect(lead.customFields).toEqual({ 'Apollo ID': 'p1', 'Email status': 'verified' });
  });

  it('shows a found person’s name only as far as the free search gives it', () => {
    expect(hiddenName({ id: 'p', firstName: 'Elena', lastNameHidden: 'Ro***i', title: '', company: '', hasEmail: true })).toBe('Elena Ro***i');
    expect(hiddenName({ id: 'p', firstName: '', lastNameHidden: '', title: '', company: '', hasEmail: true })).toBe('Name not shown');
  });
});

describe('what is said afterwards', () => {
  it('is how many were added and what it cost', () => {
    expect(addedSentence({ added: 3, credits: 3, already: 0, unverified: 0, notFound: 0 })).toBe('Added 3 leads. 3 Apollo credits used.');
    expect(addedSentence({ added: 1, credits: 1, already: 0, unverified: 0, notFound: 0 })).toBe('Added 1 lead. 1 Apollo credit used.');
  });

  it('is also who was left out, and why', () => {
    expect(addedSentence({ added: 0, credits: 4, already: 2, unverified: 1, notFound: 1 }))
      .toBe('No leads were added. 4 Apollo credits used. 2 were already a lead. 1 had no verified email. 1 was not found.');
  });
});

describe('phone numbers', () => {
  it('start as the company’s number, and say whose number it is', () => {
    const lead = leadFromPerson(person({ company: { name: 'Northwind Studio', website: '', industry: '', size: null, city: '', state: '', country: '', phone: '+44 113 496 0000' } }));
    expect(lead.phone).toBe('+44 113 496 0000');
    expect(lead.customFields['Phone type']).toBe('Company');
    expect(leadFromPerson(person()).customFields['Phone type']).toBeUndefined();
  });

  it('become the person’s own number when it arrives, keeping what the lead already says', () => {
    expect(phonePatch({ 'Apollo ID': 'p1', 'Phone type': 'Company' }, { number: '+447700900123', type: 'mobile' }))
      .toEqual({ phone: '+447700900123', customFields: { 'Apollo ID': 'p1', 'Phone type': 'Mobile' } });
    expect(phonePatch({}, { number: '+1', type: 'direct' }).customFields['Phone type']).toBe('Direct line');
  });

  it('are summed up in one line', () => {
    expect(phonesSentence({ added: 2, credits: 16 })).toBe('Phone numbers added to 2 leads. 16 Apollo credits used.');
    expect(phonesSentence({ added: 0, credits: 0 })).toBe('Apollo found no valid phone number for these leads. 0 Apollo credits used.');
  });

  it('are remembered between visits while Apollo is still looking, and forgotten when done', () => {
    const waiting = { requestIds: ['9'], leads: { p1: { id: 'lead-1', customFields: {} } }, added: 0, credits: 0 };
    savePendingPhones('ws-1', waiting);
    expect(readPendingPhones('ws-1')).toEqual(waiting);
    expect(readPendingPhones('ws-2')).toBeNull();
    savePendingPhones('ws-1', null);
    expect(readPendingPhones('ws-1')).toBeNull();
    window.localStorage.setItem('crm.findLeads.pendingPhones.ws-1', 'not json');
    expect(readPendingPhones('ws-1')).toBeNull();
  });

  it('join a second batch to one that is still waiting', () => {
    const first = { requestIds: ['1'], leads: { p1: { id: 'a', customFields: {} } }, added: 1, credits: 8 };
    const second = { requestIds: ['2'], leads: { p2: { id: 'b', customFields: {} } }, added: 0, credits: 0 };
    expect(mergePendingPhones(first, second)).toEqual({ requestIds: ['1', '2'], leads: { p1: { id: 'a', customFields: {} }, p2: { id: 'b', customFields: {} } }, added: 1, credits: 8 });
    expect(mergePendingPhones(null, second)).toBe(second);
  });
});
