import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2, Save, Info, ArrowLeft, Plus, Trash2, Lock, Play, PauseCircle, UserPlus,
  FileText, Eye, Copy, AlertTriangle, CheckCircle2, CircleSlash, Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { listAccounts, listMailboxStatus, listSuppressions } from '@/services/supabase/email';
import { readiness, sendingConnected, type Readiness } from '@/lib/email/readiness';
import { buildMessage } from '@/lib/email/message';
import { applySignature } from '@/lib/email/signature';
import { placeholdersUsed } from '@/lib/email/richText';
import { followUpSubject } from '@/lib/email/sequence';
import {
  getSequence, saveStep, deleteStep, updateSequence, countStepMessages,
  listStepOpenCounts, enroll, listEnrollments, stopEnrollment,
} from '@/services/supabase/emailSequences';
import type {
  EmailAccount, EmailEnrollment, EmailSequence, EmailSequenceStep, EmailSuppression,
  SequenceStatus,
} from '@/lib/email/types';
import { AudiencePicker, type AudienceSelection } from './AudiencePicker';
import { RichTextEditor } from './RichTextEditor';
import { EnrollmentTable, stopReasonLabel } from './EnrollmentTable';
import { TemplatePickerDialog } from './TemplatePickerDialog';

interface SequenceEditorProps {
  sequenceId: string;
  orgId: string;
  workspaceId: string | null;
  /** Back to the list. The list reloads its counts when this runs. */
  onBack: () => void;
}

/** One step as the form holds it — numbers as strings, the way every other
 *  form on this page holds them, so a half-typed delay is not a NaN. */
interface StepForm {
  /** Null on a step added here and not saved yet. */
  id: string | null;
  campaignId: string | null;
  stepIndex: number;
  delayHours: string;
  subject: string;
  bodyHtml: string;
}

/**
 * The four questions this screen answers, each on its own.
 *
 * It used to be one column of stacked cards where writing a step, saving it,
 * enrolling people and switching the whole thing on all sat within a scroll of
 * each other — four different decisions with four different costs, reached in
 * whatever order the page happened to be built in.
 */
type EditorTab = 'steps' | 'people' | 'settings' | 'activity';

const DEFAULT_DELAY_HOURS = '72';

/** No audience until somebody picks one — see AudiencePicker on why. */
const EMPTY_AUDIENCE: AudienceSelection = {
  mode: 'contacts', recipients: [], sendableCount: 0, csvColumns: [],
};

const toForm = (step: EmailSequenceStep): StepForm => ({
  id: step.id,
  campaignId: step.campaignId,
  stepIndex: step.stepIndex,
  delayHours: String(step.delayHours),
  subject: step.subject,
  bodyHtml: step.bodyHtml,
});

const sequenceStatusBadge = (status: SequenceStatus) => {
  switch (status) {
    case 'active':
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><Play className="w-3 h-3 mr-1" />Active</Badge>;
    case 'paused':
      return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30"><PauseCircle className="w-3 h-3 mr-1" />Paused</Badge>;
    case 'archived':
      return <Badge variant="outline">Archived</Badge>;
    default:
      return <Badge variant="secondary">Draft</Badge>;
  }
};

/**
 * Whether the form has moved away from the step as it is stored.
 *
 * Module-level and pure because two things ask it: the per-step Save button,
 * and the activation review — which must refuse to go live on wording that
 * only exists in the browser, since a step's words only reach the hidden
 * campaign the worker sends from once it has been saved.
 */
const differsFromSaved = (saved: EmailSequenceStep | undefined, form: StepForm): boolean => {
  if (!saved) return true;
  return saved.subject !== form.subject
    || saved.bodyHtml !== form.bodyHtml
    || String(saved.delayHours) !== form.delayHours;
};

/** The delay in the words a person thinks in. Days where the hours divide
 *  evenly, hours otherwise — and step 0 has no delay at all: it goes out when
 *  the person is enrolled, which is what the column's comment says too. */
const delayLabel = (hours: number): string => {
  if (!Number.isFinite(hours) || hours <= 0) return 'Sent as soon as someone is enrolled.';
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'} after the previous step is actually sent.`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'} after the previous step is actually sent.`;
};

/* ------------------------------------------------------------ step preview */

interface StepPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 1-based, because that is how every other label on this screen counts. */
  stepNumber: number;
  subject: string;
  /** Step 1's subject, which a follow-up left blank inherits. */
  firstSubject: string;
  bodyHtml: string;
  /** The mailbox whose signature stands in, or null when none is connected. */
  signingAccount: EmailAccount | null;
  /** Somebody actually walking this sequence, for their merge data. */
  person: EmailEnrollment | null;
}

/**
 * One step as the person receiving it will see it.
 *
 * Built with `applySignature` and `buildMessage` — the two functions the
 * worker itself sends through — rather than an approximation, because a
 * preview that is merely similar to the real message is worse than none: it is
 * trusted and wrong. `followUpSubject` is the third, and it belongs here for
 * the same reason: a follow-up left blank goes out as "Re: " plus the first
 * step's subject, and `saveStep` resolves that when the step is SAVED, so a
 * preview that showed the blank field would be showing a subject nobody ever
 * receives.
 */
const StepPreviewDialog: React.FC<StepPreviewDialogProps> = ({
  open, onOpenChange, stepNumber, subject, firstSubject, bodyHtml, signingAccount, person,
}) => {
  const resolvedSubject = stepNumber === 1
    ? subject.trim()
    : followUpSubject(subject, firstSubject);

  const rendered = useMemo(() => {
    const withSignature = applySignature(bodyHtml, signingAccount?.signatureHtml ?? '');
    return buildMessage({
      // 'sequence' is the kind `saveStep` gives every step's hidden campaign,
      // and buildMessage reads it: a bulk campaign gets an unsubscribe footer
      // here and a sequence step does not. Passing 'bulk' would show a footer
      // that never arrives.
      kind: 'sequence',
      subject: resolvedSubject,
      bodyHtml: withSignature,
      mergeData: person?.mergeData ?? {},
      // Signed per message at send time; a preview has no message id yet, so
      // there is no link to show rather than one that would 404.
      unsubscribeUrl: undefined,
    });
  }, [bodyHtml, resolvedSubject, person, signingAccount]);

  // Placeholders this person has no value for. They substitute to nothing,
  // which is how a message goes out reading "Hi ," — visible here and nowhere
  // else.
  const missing = useMemo(() => {
    if (!person) return [];
    const used = placeholdersUsed(`${resolvedSubject} ${bodyHtml}`);
    return used.filter((name) => {
      const value = person.mergeData[name];
      return value === undefined || value === null || String(value).trim() === '';
    });
  }, [resolvedSubject, bodyHtml, person]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Step {stepNumber} as it arrives</DialogTitle>
          <DialogDescription>
            Rendered through the same signature and message builder the sender uses, so this is
            the message rather than a likeness of it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Mail className="h-4 w-4" />From
            </p>
            {signingAccount ? (
              <div className="space-y-1 text-sm">
                <p>
                  {signingAccount.fromName} &lt;{signingAccount.fromEmail}&gt;
                  {signingAccount.signatureHtml.trim() === '' && (
                    <Badge variant="outline" className="ml-2 text-amber-700 dark:text-amber-400">
                      no signature
                    </Badge>
                  )}
                </p>
                {/* A sequence sends from the whole pool and the mailbox is
                    picked at send time, so no one signature is knowable here.
                    Saying which one is standing in is the difference between a
                    preview and a claim. */}
                <p className="text-xs text-muted-foreground">
                  A sequence rotates across the pool and each mailbox signs with its own, so the
                  preview below shows {signingAccount.fromEmail}&rsquo;s signature.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No verified mailbox, so this is shown unsigned — add one under Accounts.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              Message
              <span className="text-xs font-normal text-muted-foreground">
                {person
                  ? `as ${person.toEmail} will see it`
                  : 'nobody is enrolled yet, so every placeholder is shown empty'}
              </span>
            </p>
            {missing.length > 0 && (
              <p className="mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  This person has nothing for {missing.map((m) => `{{${m}}}`).join(', ')} — those
                  will come out blank.
                </span>
              </p>
            )}
            <p className="text-sm font-medium">
              {rendered.subject || <span className="text-muted-foreground">(no subject)</span>}
            </p>
            {stepNumber > 1 && subject.trim() === '' && (
              <p className="mt-1 text-xs text-muted-foreground">
                Inherited from step 1, which is what keeps this in the same conversation.
              </p>
            )}
            <div
              className="prose prose-sm mt-2 max-h-72 max-w-none overflow-y-auto rounded border border-border bg-background p-3 dark:prose-invert"
              // The same HTML the send path builds. It is the message.
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Back to editing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------- activation review */

interface ActivationCheck {
  id: string;
  /** 'blocked' stops activation; 'warning' is a cost, said out loud and accepted. */
  state: 'done' | 'warning' | 'blocked';
  title: string;
  detail: string;
}

const checkIcon = (state: ActivationCheck['state']) => {
  switch (state) {
    case 'done':
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    case 'warning':
      return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />;
    default:
      return <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />;
  }
};

interface ActivationReviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checks: ActivationCheck[];
  activating: boolean;
  onConfirm: () => void;
}

/**
 * What is and is not ready, BEFORE the switch is thrown.
 *
 * This replaces a `window.confirm` that fired only when no mailbox could read
 * its inbox, and only at the moment of activation — so everything else it is
 * worth knowing (nobody enrolled, a step that cannot send at all) was silent,
 * and the one thing it did say arrived as a browser dialog with two buttons
 * and no way to go and look.
 *
 * Only an inability to send blocks. Plenty of people run sequences without
 * IMAP on purpose; what is unacceptable is doing it unknowingly.
 */
const ActivationReview: React.FC<ActivationReviewProps> = ({
  open, onOpenChange, checks, activating, onConfirm,
}) => {
  const blocked = checks.some((c) => c.state === 'blocked');
  const warnings = checks.filter((c) => c.state === 'warning').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review before activating</DialogTitle>
          <DialogDescription>
            {blocked
              ? 'Something here stops this sequence going live. Nothing is sent until it is fixed.'
              : warnings > 0
                ? 'This can go live. These are the things it is worth knowing first.'
                : 'Everything is ready. The first step goes out as soon as this is active.'}
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-3">
          {checks.map((check) => (
            <li key={check.id} className="flex items-start gap-2">
              {checkIcon(check.state)}
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{check.title}</p>
                <p className="text-xs text-muted-foreground">{check.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button type="button" disabled={blocked || activating} onClick={onConfirm}>
            {activating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------- the editor */

export const SequenceEditor: React.FC<SequenceEditorProps> = ({
  sequenceId, orgId, workspaceId, onBack,
}) => {
  const [sequence, setSequence] = useState<EmailSequence | null>(null);
  const [tab, setTab] = useState<EditorTab>('steps');
  /**
   * The step index currently choosing a template, or null.
   *
   * Per step rather than one picker for the whole sequence: the wording worth
   * reusing is usually a single follow-up, and a sequence-wide picker would
   * have to ask which step afterwards anyway.
   */
  const [templateForStep, setTemplateForStep] = useState<number | null>(null);
  /** The step index currently being previewed, or null. */
  const [previewStepIndex, setPreviewStepIndex] = useState<number | null>(null);
  const [savedSteps, setSavedSteps] = useState<EmailSequenceStep[]>([]);
  const [forms, setForms] = useState<StepForm[]>([]);
  /** How many messages each step's hidden campaign has already produced.
   *  Keyed by campaign id; a step with any is frozen. */
  const [sentCounts, setSentCounts] = useState<Record<string, number>>({});
  /**
   * Opens per step, keyed by the step's hidden campaign id. Two numbers: the
   * ones that looked like a person, and the ones that looked automatic.
   */
  const [openCounts, setOpenCounts] = useState<
    Record<string, { opened: number; prefetch: number }>
  >({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingStepIndex, setSavingStepIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const [enrollments, setEnrollments] = useState<EmailEnrollment[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(true);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  /**
   * Whether this organization can send at all, and hear back.
   *
   * Read here rather than passed in, because it is only consulted at the
   * moment of activation and a stale value would be worse than a fresh read:
   * somebody who connects IMAP and comes straight back should not be warned
   * about a state they have just fixed. Null when the read FAILED, which is
   * not the same as "not ready" — a check that could not run must not block
   * activation or invent a warning nobody can act on.
   */
  const [setup, setSetup] = useState<Readiness | null>(null);
  const [suppressions, setSuppressions] = useState<EmailSuppression[]>([]);
  const [audience, setAudience] = useState<AudienceSelection>(EMPTY_AUDIENCE);
  /**
   * Bumped after enrolling so the picker remounts and forgets what was chosen.
   * Leaving the last batch selected under an Enroll button is how the same
   * list gets enrolled twice — harmless, since the second is skipped, but it
   * reads as if nothing happened.
   */
  const [audienceKey, setAudienceKey] = useState(0);

  const loadSequence = useCallback(async () => {
    const { sequence: loaded, steps } = await getSequence(sequenceId);
    setSequence(loaded);
    setName(loaded.name);
    setSavedSteps(steps);
    setForms(steps.map(toForm));
    const campaignIds = steps
      .map((s) => s.campaignId)
      .filter((id): id is string => id !== null);
    const [counts, opens] = await Promise.all([
      countStepMessages(campaignIds),
      listStepOpenCounts(campaignIds),
    ]);
    setSentCounts(counts);
    setOpenCounts(opens);
  }, [sequenceId]);

  // Swallowed on failure: this decides which warnings the activation review
  // shows, and a warning shown because a health check failed is a warning
  // nobody can act on.
  useEffect(() => {
    if (!orgId) return;
    Promise.all([listAccounts(orgId, workspaceId), listMailboxStatus(orgId, workspaceId)])
      .then(([list, health]) => { setAccounts(list); setSetup(readiness(list, health)); })
      .catch(() => { setAccounts([]); setSetup(null); });
    // Whole rows, not just addresses: the picker has to say WHY each excluded
    // person is excluded, and the reason only exists on the row.
    listSuppressions(orgId)
      .then(setSuppressions)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load suppression list'));
  }, [orgId, workspaceId]);

  const loadEnrollments = useCallback(async () => {
    setEnrollmentsLoading(true);
    try {
      setEnrollments(await listEnrollments(sequenceId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load enrollments');
    } finally {
      setEnrollmentsLoading(false);
    }
  }, [sequenceId]);

  useEffect(() => {
    setLoading(true);
    loadSequence()
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load sequence'))
      .finally(() => setLoading(false));
  }, [loadSequence]);

  useEffect(() => { void loadEnrollments(); }, [loadEnrollments]);

  const mergeFields = useMemo(() => {
    // Exactly what the composer offers, because exactly the same three
    // loaders produce the people enrolled here: `contactsForCampaign` carries
    // the prospect's `pain_point` and their group's `angle`, and a pasted list
    // carries nothing but an address. Offering a placeholder that resolves to
    // nothing is how a message goes out with a gap where a sentence should be.
    const contactFields = [
      'first_name', 'last_name', 'full_name', 'email',
      'job_title', 'pain_point', 'angle', 'group_name',
    ];
    if (audience.mode === 'csv') {
      const base = ['first_name', 'last_name', 'full_name', 'email'];
      return [...base, ...audience.csvColumns.filter((c) => !base.includes(c))];
    }
    if (audience.mode === 'paste') return ['email'];
    return contactFields;
  }, [audience.mode, audience.csvColumns]);

  /** A step already sent to somebody. Its wording is fixed — including the
   *  subject people have already received — so nothing here edits it. */
  const isFrozen = (form: StepForm): boolean =>
    !!form.campaignId && (sentCounts[form.campaignId] ?? 0) > 0;

  const isDirty = (form: StepForm): boolean =>
    differsFromSaved(savedSteps.find((s) => s.stepIndex === form.stepIndex), form);

  const setForm = (stepIndex: number, updater: (f: StepForm) => StepForm) => {
    setForms((prev) => prev.map((f) => (f.stepIndex === stepIndex ? updater(f) : f)));
  };

  const handleSaveName = async () => {
    if (!sequence || !name.trim()) return;
    setSavingName(true);
    try {
      await updateSequence(sequence.id, { name: name.trim() });
      setSequence({ ...sequence, name: name.trim() });
      toast.success('Sequence renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename sequence');
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveStep = async (form: StepForm) => {
    setSavingStepIndex(form.stepIndex);
    try {
      await saveStep({
        sequenceId,
        stepIndex: form.stepIndex,
        delayHours: form.stepIndex === 0 ? 0 : Math.max(Number(form.delayHours) || 0, 0),
        subject: form.subject,
        bodyHtml: form.bodyHtml,
      });
      await loadSequence();
      toast.success(`Step ${form.stepIndex + 1} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save step');
    } finally {
      setSavingStepIndex(null);
    }
  };

  const handleAddStep = () => {
    setForms((prev) => [...prev, {
      id: null,
      campaignId: null,
      stepIndex: prev.length,
      delayHours: DEFAULT_DELAY_HOURS,
      subject: '',
      bodyHtml: '',
    }]);
  };

  /**
   * Copies a step's wording into a NEW step at the END, never beside it.
   *
   * `step_index` is the order, and it is also what an enrollment's
   * `current_step` points at: inserting in the middle would renumber every
   * step after it and move everybody mid-sequence onto wording they were not
   * walking towards. Appending cannot do that to anybody.
   */
  const handleDuplicateStep = (form: StepForm) => {
    setForms((prev) => [...prev, {
      id: null,
      campaignId: null,
      stepIndex: prev.length,
      delayHours: DEFAULT_DELAY_HOURS,
      subject: form.subject,
      bodyHtml: form.bodyHtml,
    }]);
    toast.success(`Step ${form.stepIndex + 1} copied to the end — save it to keep it`);
  };

  /**
   * Why this step cannot be removed, in one sentence, or null when it can.
   *
   * The same three reasons the button is disabled for, so the button can say
   * which one applies rather than simply refusing.
   */
  const removeBlockedBecause = (form: StepForm): string | null => {
    if (isFrozen(form)) {
      return 'This step has already been sent to somebody, so it stays as the record of what they received.';
    }
    if (forms.length <= 1) return 'A sequence needs at least one step.';
    if (form.stepIndex !== forms.length - 1) {
      return 'Only the last step can be removed: taking one out of the middle renumbers every step '
        + 'after it, and people part-way through are tracked by step number.';
    }
    return null;
  };

  const handleRemoveStep = async (form: StepForm) => {
    if (removeBlockedBecause(form) !== null) return;
    if (!form.id) { setForms((prev) => prev.slice(0, -1)); return; }
    if (!window.confirm(`Remove step ${form.stepIndex + 1}? Its wording is deleted.`)) return;
    setRemoving(true);
    try {
      await deleteStep(form.id, form.campaignId);
      await loadSequence();
      toast.success('Step removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove step');
    } finally {
      setRemoving(false);
    }
  };

  /**
   * What stops this sequence going live, in one sentence, or null. Read off
   * the SAVED steps, never the form: a step's wording only reaches the hidden
   * campaign the worker sends from once it has been saved.
   */
  const activationProblem = useMemo<string | null>(() => {
    const stepZero = savedSteps.find((s) => s.stepIndex === 0);
    if (!stepZero) return 'Write the first step before activating this sequence.';
    if (stepZero.subject.trim() === '') return 'Step 1 needs a subject before this sequence can go out.';
    if (!savedSteps.some((s) => s.bodyHtml.trim() !== '')) {
      return 'At least one step needs a body before this sequence can go out.';
    }
    const unsaved = forms.find(
      (f) => differsFromSaved(savedSteps.find((s) => s.stepIndex === f.stepIndex), f),
    );
    if (unsaved) return `Save your changes to step ${unsaved.stepIndex + 1} first.`;
    return null;
  }, [savedSteps, forms]);

  const waitingCount = useMemo(
    () => enrollments.filter((e) => e.status === 'active').length,
    [enrollments],
  );

  /** Saved steps with no hidden campaign behind them: the claim refuses those,
   *  so anybody who reaches one waits there indefinitely. */
  const brokenSteps = useMemo(
    () => savedSteps.filter((s) => s.campaignId === null),
    [savedSteps],
  );

  /**
   * Everything worth knowing before the switch is thrown, in the order the
   * cost of NOT knowing it runs: nothing leaves at all, nothing is ready to
   * leave, a step that swallows people, replies going unheard, and nobody
   * there to receive any of it.
   */
  const activationChecks = useMemo<ActivationCheck[]>(() => {
    const checks: ActivationCheck[] = [];
    const verified = accounts.filter(sendingConnected).length;

    if (!setup) {
      // A warning and not a block: a check that failed says nothing about the
      // mailboxes, and refusing to activate on it would turn a flaky read into
      // an outage of its own.
      checks.push({
        id: 'send',
        state: 'warning',
        title: 'Mailbox health could not be read',
        detail: 'The check did not run, so this cannot say whether mail will actually leave. '
          + 'Look at the Accounts tab if the first step does not go out.',
      });
    } else if (setup.canSend) {
      checks.push({
        id: 'send',
        state: 'done',
        title: 'A mailbox can send',
        detail: `${verified} verified mailbox${verified === 1 ? '' : 'es'}, at least one in rotation.`,
      });
    } else {
      checks.push({
        id: 'send',
        state: 'blocked',
        title: 'Nothing can be sent',
        detail: verified === 0
          ? 'No mailbox has proven it can send. Add one and verify it under Accounts.'
          : 'Every verified mailbox is paused or out of rotation, so nothing would go out. '
            + 'Fix one under Accounts.',
      });
    }

    const problem = activationProblem;
    checks.push(problem
      ? { id: 'steps', state: 'blocked', title: 'The steps are not ready', detail: problem }
      : {
        id: 'steps',
        state: 'done',
        title: 'The steps are saved and ready',
        detail: `${savedSteps.length} step${savedSteps.length === 1 ? '' : 's'}, with nothing unsaved.`,
      });

    if (brokenSteps.length > 0) {
      checks.push({
        id: 'broken',
        state: 'warning',
        title: `${brokenSteps.length} step${brokenSteps.length === 1 ? '' : 's'} cannot send`,
        detail: `Step ${brokenSteps.map((s) => s.stepIndex + 1).join(', ')} did not finish saving, `
          + 'so anybody who reaches it waits there rather than moving on. Save it again on the '
          + 'Steps tab — nobody is lost in the meantime.',
      });
    }

    if (setup) {
      checks.push(setup.canDetectReplies
        ? {
          id: 'replies',
          state: 'done',
          title: 'Replies and bounces will be seen',
          detail: setup.sendOnlyMailboxes.length > 0
            ? `${setup.sendOnlyMailboxes.join(', ')} cannot be read, so a reply that lands there is missed.`
            : 'Somebody who answers stops receiving follow-ups.',
        }
        : {
          // Stop-on-reply is the promise a sequence makes, and it is not one
          // you can half-keep. Said before activation rather than discovered
          // in somebody's inbox a week later.
          id: 'replies',
          state: 'warning',
          title: 'Replies will not be detected',
          detail: 'No sending mailbox can read its inbox, so the follow-ups will keep going to '
            + 'people who have already answered and a bounce will stop nothing. Connect the '
            + 'inbox under Accounts, or accept this deliberately.',
        });
    }

    checks.push(waitingCount > 0
      ? {
        id: 'people',
        state: 'done',
        title: `${waitingCount} ${waitingCount === 1 ? 'person is' : 'people are'} waiting`,
        detail: 'Their first step is due as soon as this is active.',
      }
      : {
        id: 'people',
        state: 'warning',
        title: 'Nobody is enrolled',
        detail: 'Activating sends nothing until somebody is. Add people on the People tab — '
          + 'they start at the first step, due straight away.',
      });

    return checks;
  }, [setup, accounts, activationProblem, savedSteps.length, brokenSteps, waitingCount]);

  const applyStatus = async (status: SequenceStatus) => {
    if (!sequence) return;
    setChangingStatus(true);
    try {
      await updateSequence(sequence.id, { status });
      setSequence({ ...sequence, status });
      toast.success(status === 'active' ? 'Sequence activated' : 'Sequence paused');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update sequence');
    } finally {
      setChangingStatus(false);
    }
  };

  const handleEnroll = async () => {
    // `audience.recipients` is de-duplicated but still carries the suppressed
    // addresses, and that is on purpose: `claim_sequence_enrollments()` stops
    // a suppressed enrollment itself with the reason recorded (migration 159),
    // so holding them back here would replace a readable record with an
    // enrollment that quietly never existed.
    if (audience.recipients.length === 0) return;
    setEnrolling(true);
    try {
      const { added, skipped } = await enroll(sequenceId, orgId, audience.recipients);
      toast.success(
        `${added} added${skipped ? `, ${skipped} already enrolled` : ''}`,
      );
      setAudienceKey((k) => k + 1);
      await loadEnrollments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enroll recipients');
    } finally {
      setEnrolling(false);
    }
  };

  const handleStop = async (enrollment: EmailEnrollment) => {
    if (!window.confirm(`Stop the sequence for ${enrollment.toEmail}? They get no further steps.`)) return;
    setStoppingId(enrollment.id);
    try {
      await stopEnrollment(enrollment.id);
      await loadEnrollments();
      toast.success('Enrollment stopped');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop enrollment');
    } finally {
      setStoppingId(null);
    }
  };

  /**
   * Every enrollment that ENDED, newest first.
   *
   * Sorted on `stoppedAt` rather than on creation, because this is a record of
   * what happened and when — the order somebody was enrolled says nothing
   * about the order they replied or bounced.
   */
  const stopped = useMemo(
    () => enrollments
      .filter((e) => e.status === 'stopped')
      .sort((a, b) => (b.stoppedAt?.getTime() ?? 0) - (a.stoppedAt?.getTime() ?? 0)),
    [enrollments],
  );

  /** The mailbox whose signature stands in for the pool in a preview. */
  const signingAccount = useMemo(
    () => accounts.find(sendingConnected) ?? accounts[0] ?? null,
    [accounts],
  );

  /** The person a preview is rendered for: somebody actually walking this
   *  sequence, preferring one who is still receiving it. */
  const previewPerson = useMemo(
    () => enrollments.find((e) => e.status === 'active') ?? enrollments[0] ?? null,
    [enrollments],
  );

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="text-center py-16 text-muted-foreground">
            <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
            <p>Loading sequence...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!sequence) return null;

  const previewForm = previewStepIndex === null
    ? null
    : forms.find((f) => f.stepIndex === previewStepIndex) ?? null;
  const firstSubject = forms.find((f) => f.stepIndex === 0)?.subject ?? '';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />Sequences
            </Button>
            <CardTitle className="truncate">{sequence.name}</CardTitle>
            {sequenceStatusBadge(sequence.status)}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <p className="hidden text-xs text-muted-foreground sm:block">
              {waitingCount} waiting · {savedSteps.length} step{savedSteps.length === 1 ? '' : 's'}
            </p>
            {/*
              In the header, not only under Settings. Giving the editor tabs
              was right and it put the page's PRIMARY action two clicks away
              on a tab named after configuration -- so a sequence somebody had
              finished writing looked finished, and the step that makes it
              actually send was somewhere they had no reason to open.

              It is the same control as the one on Settings, opening the same
              review; there is no second path and no second piece of state.
            */}
            {sequence.status === 'active' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={changingStatus}
                onClick={() => void applyStatus('paused')}
              >
                {changingStatus
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <PauseCircle className="w-4 h-4 mr-2" />}
                Pause
              </Button>
            ) : (
              <Button size="sm" onClick={() => setReviewing(true)}>
                <Play className="w-4 h-4 mr-2" />
                Review and activate
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as EditorTab)}>
        <TabsList>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* ── the wording ─────────────────────────────────────────── */}
        <TabsContent value="steps">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Steps</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  The first message and the follow-ups after it, in order. Only the last step can
                  be removed — taking one out of the middle renumbers the steps after it, and
                  people part-way through are tracked by step number.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" onClick={handleAddStep}>
                  <Plus className="w-4 h-4 mr-2" />Add step
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {forms.map((form) => {
                const frozen = isFrozen(form);
                const sent = form.campaignId ? (sentCounts[form.campaignId] ?? 0) : 0;
                const opens = form.campaignId ? openCounts[form.campaignId] : undefined;
                const cannotRemove = removeBlockedBecause(form);
                return (
                  <div key={form.stepIndex} className="border border-border rounded-lg overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-secondary/40">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <p className="font-medium text-foreground">Step {form.stepIndex + 1}</p>
                        {form.stepIndex === 0
                          ? <Badge variant="outline">First message</Badge>
                          : <Badge variant="outline">Follow-up</Badge>}
                        {frozen && (
                          <Badge variant="secondary">
                            <Lock className="w-3 h-3 mr-1" />Sent to {sent}
                          </Badge>
                        )}
                        {/* Per step, which is the only place this number earns its
                            keep: "which follow-up is being read" is a question
                            about step 2 against step 3. Shown only once the step
                            has actually gone to somebody, so a draft is not
                            decorated with a zero.

                            The automatic count rides alongside rather than being
                            folded in. Apple Mail loads every image in every
                            message, so a single merged figure would say a step was
                            read by people who never saw it. */}
                        {frozen && opens && (opens.opened > 0 || opens.prefetch > 0) && (
                          <Badge
                            variant="outline"
                            title={
                              opens.prefetch > 0
                                ? `A further ${opens.prefetch} were opened automatically by a mail ` +
                                  'client or scanner and are not counted here.'
                                : 'An estimate: clients that block images record nothing.'
                            }
                          >
                            Opened {opens.opened}
                            {opens.prefetch > 0 ? ` (+${opens.prefetch} auto)` : ''}
                          </Badge>
                        )}
                        {!form.id && <Badge variant="secondary">Not saved yet</Badge>}
                        {form.id && !form.campaignId && (
                          <Badge variant="destructive">Will not send</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewStepIndex(form.stepIndex)}
                        >
                          <Eye className="w-4 h-4 mr-1.5" />Preview
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDuplicateStep(form)}
                        >
                          <Copy className="w-4 h-4 mr-1.5" />Duplicate
                        </Button>
                        {/* The reason lives on a wrapping span rather than on
                            the button: a disabled button has pointer-events
                            switched off, so a title on it is never read out
                            and the refusal would be silent. */}
                        <span title={cannotRemove ?? undefined}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={cannotRemove !== null || removing}
                            aria-label={cannotRemove
                              ? `Remove step ${form.stepIndex + 1} — ${cannotRemove}`
                              : `Remove step ${form.stepIndex + 1}`}
                            onClick={() => handleRemoveStep(form)}
                          >
                            {removing
                              ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                              : <Trash2 className="w-4 h-4 mr-1.5" />}
                            Remove
                          </Button>
                        </span>
                      </div>
                    </div>
                    <div className="p-4 space-y-4">
                      {frozen && (
                        <p className="text-sm text-muted-foreground">
                          This step has already been sent, so its wording is fixed. Add a step after it
                          instead.
                        </p>
                      )}
                      {/*
                        A saved step with no campaign behind it cannot send: the
                        claim refuses it, and the people who reach it wait here
                        indefinitely rather than being skipped or dropped. It is
                        reachable only when a save failed part way through, which
                        is rare and self-inflicted by a dropped connection — but
                        invisible is the one thing it must not be, because the
                        sequence otherwise looks like it is running.
                      */}
                      {form.id && !form.campaignId && (
                        <p className="text-sm text-red-600 dark:text-red-400">
                          This step did not finish saving, so it will not be sent and anybody who
                          reaches it will wait here. Save it again to fix it — nobody is lost in the
                          meantime.
                        </p>
                      )}
                      {form.stepIndex > 0 && (
                        <div className="space-y-2">
                          <Label htmlFor={`step-${form.stepIndex}-delay`}>Delay (hours)</Label>
                          <Input
                            id={`step-${form.stepIndex}-delay`}
                            type="number"
                            min={0}
                            className="sm:max-w-[160px]"
                            value={form.delayHours}
                            disabled={frozen}
                            onChange={(e) => setForm(form.stepIndex, (f) => ({ ...f, delayHours: e.target.value }))}
                          />
                          <p className="text-xs text-muted-foreground">{delayLabel(Number(form.delayHours))}</p>
                        </div>
                      )}
                      {form.stepIndex === 0 && (
                        <p className="text-xs text-muted-foreground">{delayLabel(0)}</p>
                      )}
                      {/* Inside the step, not on some other screen. Reusing
                          wording is most valuable exactly here -- a follow-up is
                          the thing people rewrite from scratch every time -- and
                          until now the only route from a saved template to a
                          sequence step was copy and paste. */}
                      {!frozen && (
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setTemplateForStep(form.stepIndex)}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            Use a template
                          </Button>
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor={`step-${form.stepIndex}-subject`}>Subject</Label>
                        <Input
                          id={`step-${form.stepIndex}-subject`}
                          value={form.subject}
                          disabled={frozen}
                          placeholder={form.stepIndex === 0 ? '' : 'Leave blank to reply in the same thread'}
                          onChange={(e) => setForm(form.stepIndex, (f) => ({ ...f, subject: e.target.value }))}
                        />
                        {form.stepIndex > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Blank sends this as &ldquo;Re: &rdquo; plus the first step&rsquo;s subject, which is what
                            keeps it in the same conversation.
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Body</Label>
                        {/* The same editor the composer uses, for the same reason
                            it was built: a step body is an email somebody writes,
                            not markup they type. Source is still one click away
                            inside it for the steps that need hand-written HTML. */}
                        <RichTextEditor
                          value={form.bodyHtml}
                          mergeFields={mergeFields}
                          disabled={frozen}
                          placeholder="Write the message. Source shows the raw HTML."
                          onChange={(html) => setForm(form.stepIndex, (f) => ({ ...f, bodyHtml: html }))}
                        />
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          Personalize with {mergeFields.map((f) => `{{${f}}}`).join(', ')} in the subject or body.
                        </p>
                      </div>
                      {!frozen && (
                        <div className="flex justify-end">
                          <Button
                            onClick={() => handleSaveStep(form)}
                            disabled={savingStepIndex === form.stepIndex || !isDirty(form)}
                          >
                            {savingStepIndex === form.stepIndex
                              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              : <Save className="w-4 h-4 mr-2" />}
                            Save step
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── who walks it ────────────────────────────────────────── */}
        <TabsContent value="people">
          <div className="space-y-6">
            {/* The same picker Compose uses, rather than the older one this
                screen had to itself. Enrolling somebody into a sequence and
                choosing who a campaign goes to are the same act, and they were
                two different screens with two different ideas of what a
                selected audience is — one of which selected everybody by
                default. */}
            <AudiencePicker
              key={audienceKey}
              orgId={orgId}
              workspaceId={workspaceId}
              suppressions={suppressions}
              onChange={setAudience}
            />

            <Card>
              <CardHeader><CardTitle>Enroll</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Everyone starts at the first step, due straight away. Somebody already walking this
                  sequence is skipped rather than started again, and a suppressed address is stopped by
                  the sender with the reason recorded.
                </p>
                <div className="flex justify-end">
                  <Button disabled={enrolling || audience.recipients.length === 0} onClick={handleEnroll}>
                    {enrolling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                    Enroll {audience.recipients.length || ''}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Enrollments</CardTitle></CardHeader>
              <CardContent>
                <EnrollmentTable
                  enrollments={enrollments}
                  loading={enrollmentsLoading}
                  // Only an ACTIVE sequence is claimed from, so on a draft or a
                  // paused one these people are queued behind a switch nobody
                  // has thrown — and the table must not call that "Active".
                  sequenceIsSending={sequence.status === 'active'}
                  stoppingId={stoppingId}
                  onStop={handleStop}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── the name, and the switch ────────────────────────────── */}
        <TabsContent value="settings">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Name</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="seq-name">Sequence name</Label>
                  <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSaveName} disabled={savingName || !name.trim() || name.trim() === sequence.name}>
                    {savingName ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save name
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Status</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  A sequence sends nothing until it is active. Pausing holds every enrollment where it
                  stands, so resuming continues rather than starts again.
                </p>
                <div className="flex justify-end">
                  {sequence.status === 'active' ? (
                    <Button variant="outline" disabled={changingStatus} onClick={() => void applyStatus('paused')}>
                      {changingStatus ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PauseCircle className="w-4 h-4 mr-2" />}
                      Pause
                    </Button>
                  ) : (
                    // Opens the review; it is the review that activates. What
                    // was here before was an Activate button and a browser
                    // confirm that only appeared for one of the several things
                    // that can be wrong.
                    <Button onClick={() => setReviewing(true)}>
                      <Play className="w-4 h-4 mr-2" />
                      Review and activate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── what has happened ───────────────────────────────────── */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Everybody this sequence has stopped for, and why. A reply is the sequence working;
                a bounce or a failure is not.
              </p>
            </CardHeader>
            <CardContent>
              {enrollmentsLoading ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Loader2 className="w-6 h-6 mx-auto animate-spin" />
                </div>
              ) : stopped.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <CircleSlash className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
                  <p className="text-lg font-medium text-foreground">Nothing has stopped yet</p>
                  <p className="text-sm">
                    Replies, bounces, unsubscribes and hand-stops land here as they happen.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {stopped.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{e.toName || e.toEmail}</p>
                        {e.toName && (
                          <p className="text-xs text-muted-foreground truncate">{e.toEmail}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-muted-foreground hidden sm:inline">
                          {/* The step they had reached, which is what makes a
                              reason readable: "bounced at step 1" and
                              "replied at step 4" are different stories. */}
                          At step {e.currentStep + 1}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {/* Null is possible on a row stopped before migration
                              159 recorded reasons, and an unlabelled stop is
                              still a stop. */}
                          {e.stopReason ? stopReasonLabel(e.stopReason) : 'Stopped'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {e.stoppedAt ? format(e.stoppedAt, 'MMM d, yyyy HH:mm') : 'time not recorded'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {previewForm && (
        <StepPreviewDialog
          open
          onOpenChange={(open) => { if (!open) setPreviewStepIndex(null); }}
          stepNumber={previewForm.stepIndex + 1}
          subject={previewForm.subject}
          firstSubject={firstSubject}
          bodyHtml={previewForm.bodyHtml}
          signingAccount={signingAccount}
          person={previewPerson}
        />
      )}

      <ActivationReview
        open={reviewing}
        onOpenChange={setReviewing}
        checks={activationChecks}
        activating={changingStatus}
        onConfirm={() => { setReviewing(false); void applyStatus('active'); }}
      />

      <TemplatePickerDialog
        orgId={orgId}
        workspaceId={workspaceId}
        open={templateForStep !== null}
        onOpenChange={(open) => { if (!open) setTemplateForStep(null); }}
        onPick={(template) => {
          if (templateForStep === null) return;
          // COPIED, never linked -- the same rule a campaign follows. A
          // template edited six weeks from now must not rewrite a step people
          // are already receiving.
          //
          // The subject is only taken when the step has none: a follow-up
          // deliberately left blank replies in the same thread, and filling it
          // from a template would quietly start a new conversation instead.
          setForm(templateForStep, (f) => ({
            ...f,
            subject: f.subject.trim() === '' && templateForStep === 0 ? template.subject : f.subject,
            bodyHtml: template.bodyHtml,
          }));
          toast.success(`Copied "${template.name}" into step ${templateForStep + 1}`);
          setTemplateForStep(null);
        }}
      />
    </div>
  );
};

export default SequenceEditor;
