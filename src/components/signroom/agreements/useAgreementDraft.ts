import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import type { SignroomClient } from '@/services/signroom/client';
import { savePayload } from '@/lib/signroom/agreementFields';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { messageOf } from './files';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'offline';

export const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Save failed. Retry or reload.',
  offline: 'Offline. Changes are unsaved.',
};

/** How long after the last change the draft saves itself. */
export const AUTOSAVE_MS = 1100;

export interface AgreementDraft {
  draft: Agreement;
  saveState: SaveState;
  /** Changes the draft in the browser and schedules a save. */
  update: (patch: Partial<Agreement>) => void;
  /** Saves now if anything changed. Resolves to the saved draft, or null when the save did not happen. */
  save: () => Promise<Agreement | null>;
  /** Takes a draft the server just returned (after preparing or uploading the PDF) as the saved state. */
  adopt: (agreement: Agreement) => void;
  /** The latest draft, for code that runs after an await. */
  latest: () => Agreement;
  /**
   * Set before a change that removes placed fields, once the person has agreed
   * to it: the server refuses such a change without it. Cleared by the next save.
   */
  clearApproved: MutableRefObject<boolean>;
}

/**
 * A draft agreement being edited: every change is kept in the browser at once
 * and saved to the documents server shortly after the person stops, with the
 * revision the server expects. Leaving the page with unsaved changes asks first.
 */
export function useAgreementDraft(initial: Agreement, client: SignroomClient): AgreementDraft {
  const [draft, setDraft] = useState(initial);
  const [changeNumber, setChangeNumber] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const current = useRef(initial);
  const sequence = useRef(0);
  const savedSequence = useRef(0);
  const saving = useRef(false);
  const clearApproved = useRef(false);

  const update = useCallback((patch: Partial<Agreement>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setDraft(next);
    sequence.current += 1;
    setChangeNumber(sequence.current);
    setSaveState('unsaved');
  }, []);

  const save = useCallback(async (): Promise<Agreement | null> => {
    if (saving.current) {
      toast.message('A save is in progress. Please wait a moment.');
      return null;
    }
    if (sequence.current === savedSequence.current) return current.current;
    saving.current = true;
    setSaveState('saving');
    const seq = sequence.current;
    try {
      const response = await client.call<Agreement>(
        `agreements/${current.current.id}/save`,
        savePayload(current.current, clearApproved.current),
      );
      savedSequence.current = seq;
      clearApproved.current = false;
      if (sequence.current === seq) {
        current.current = response;
        setDraft(response);
        setSaveState('saved');
      } else {
        // More was typed while saving: keep it, and carry the new revision so the next save is accepted.
        current.current = { ...current.current, revision: response.revision };
        setDraft(current.current);
        setChangeNumber((n) => n + 1);
        setSaveState('unsaved');
      }
      return response;
    } catch (e) {
      setSaveState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'failed');
      toast.error(messageOf(e, 'Could not save the draft.'));
      return null;
    } finally {
      saving.current = false;
    }
  }, [client]);

  const adopt = useCallback((agreement: Agreement) => {
    current.current = agreement;
    setDraft(agreement);
    savedSequence.current = sequence.current;
    setSaveState('saved');
  }, []);

  const latest = useCallback(() => current.current, []);

  useEffect(() => {
    if (changeNumber === 0) return;
    const timer = setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [changeNumber, save]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (sequence.current !== savedSequence.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  return { draft, saveState, update, save, adopt, latest, clearApproved };
}
