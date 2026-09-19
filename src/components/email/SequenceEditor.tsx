import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Save, Info, ArrowLeft, Plus, Trash2, Lock, Play, PauseCircle, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  contactsForCampaign, parsePastedRecipients, parseRecipientsCsv,
} from '@/services/supabase/email';
import type { Recipient } from '@/services/supabase/email';
import {
  getSequence, saveStep, deleteStep, updateSequence, countStepMessages,
  enroll, listEnrollments, stopEnrollment,
} from '@/services/supabase/emailSequences';
import type {
  EmailEnrollment, EmailSequence, EmailSequenceStep, SequenceStatus,
} from '@/lib/email/types';
import { RecipientPicker, recipientKey, type RecipientMode } from './RecipientPicker';
import { EnrollmentTable } from './EnrollmentTable';

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

const DEFAULT_DELAY_HOURS = '72';

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

export const SequenceEditor: React.FC<SequenceEditorProps> = ({
  sequenceId, orgId, workspaceId, onBack,
}) => {
  const [sequence, setSequence] = useState<EmailSequence | null>(null);
  const [savedSteps, setSavedSteps] = useState<EmailSequenceStep[]>([]);
  const [forms, setForms] = useState<StepForm[]>([]);
  /** How many messages each step's hidden campaign has already produced.
   *  Keyed by campaign id; a step with any is frozen. */
  const [sentCounts, setSentCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingStepIndex, setSavingStepIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const [enrollments, setEnrollments] = useState<EmailEnrollment[]>([]);
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(true);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  const [mode, setMode] = useState<RecipientMode>('contacts');
  const [contacts, setContacts] = useState<Recipient[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContactKeys, setSelectedContactKeys] = useState<Set<string>>(new Set());
  const [pasteText, setPasteText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvText, setCsvText] = useState('');

  const loadSequence = useCallback(async () => {
    const { sequence: loaded, steps } = await getSequence(sequenceId);
    setSequence(loaded);
    setName(loaded.name);
    setSavedSteps(steps);
    setForms(steps.map(toForm));
    const counts = await countStepMessages(
      steps.map((s) => s.campaignId).filter((id): id is string => id !== null),
    );
    setSentCounts(counts);
  }, [sequenceId]);

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

  useEffect(() => {
    if (mode !== 'contacts' || contactsLoaded || !orgId) return;
    setContactsLoading(true);
    contactsForCampaign(orgId, workspaceId)
      .then((list) => {
        setContacts(list);
        setSelectedContactKeys(new Set(list.map(recipientKey)));
        setContactsLoaded(true);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load contacts'))
      .finally(() => setContactsLoading(false));
  }, [mode, contactsLoaded, orgId, workspaceId]);

  const pastedParsed = useMemo(() => parsePastedRecipients(pasteText), [pasteText]);
  const csvParsed = useMemo(
    () => (csvText ? parseRecipientsCsv(csvText) : { recipients: [] as Recipient[], errors: [] as string[] }),
    [csvText],
  );
  const csvColumns = useMemo(() => {
    const cols = new Set<string>();
    csvParsed.recipients.forEach((r) => Object.keys(r.mergeData).forEach((k) => cols.add(k)));
    return Array.from(cols);
  }, [csvParsed.recipients]);

  const activeRecipients = useMemo<Recipient[]>(() => {
    if (mode === 'contacts') return contacts.filter((c) => selectedContactKeys.has(recipientKey(c)));
    if (mode === 'paste') return pastedParsed.recipients;
    return csvParsed.recipients;
  }, [mode, contacts, selectedContactKeys, pastedParsed, csvParsed]);

  const mergeFields = useMemo(() => {
    const base = ['first_name', 'last_name', 'full_name', 'email'];
    if (mode !== 'csv') return base;
    return [...base, ...csvColumns.filter((c) => !base.includes(c))];
  }, [mode, csvColumns]);

  /** A step already sent to somebody. Its wording is fixed — including the
   *  subject people have already received — so nothing here edits it. */
  const isFrozen = (form: StepForm): boolean =>
    !!form.campaignId && (sentCounts[form.campaignId] ?? 0) > 0;

  const isDirty = (form: StepForm): boolean => {
    const saved = savedSteps.find((s) => s.stepIndex === form.stepIndex);
    if (!saved) return true;
    return saved.subject !== form.subject
      || saved.bodyHtml !== form.bodyHtml
      || String(saved.delayHours) !== form.delayHours;
  };

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

  const handleRemoveLastStep = async () => {
    const last = forms[forms.length - 1];
    if (!last || forms.length <= 1) return;
    if (!last.id) { setForms((prev) => prev.slice(0, -1)); return; }
    if (!window.confirm(`Remove step ${last.stepIndex + 1}? Its wording is deleted.`)) return;
    setRemoving(true);
    try {
      await deleteStep(last.id, last.campaignId);
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
  const activationProblem = (): string | null => {
    const stepZero = savedSteps.find((s) => s.stepIndex === 0);
    if (!stepZero) return 'Write the first step before activating this sequence.';
    if (stepZero.subject.trim() === '') return 'Step 1 needs a subject before this sequence can go out.';
    if (!savedSteps.some((s) => s.bodyHtml.trim() !== '')) {
      return 'At least one step needs a body before this sequence can go out.';
    }
    const unsaved = forms.find(isDirty);
    if (unsaved) return `Save your changes to step ${unsaved.stepIndex + 1} first.`;
    return null;
  };

  const handleStatus = async (status: SequenceStatus) => {
    if (!sequence) return;
    if (status === 'active') {
      const problem = activationProblem();
      if (problem) { toast.error(problem); return; }
    }
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
    if (activeRecipients.length === 0) return;
    setEnrolling(true);
    try {
      const { added, skipped } = await enroll(sequenceId, orgId, activeRecipients);
      toast.success(
        `${added} added${skipped ? `, ${skipped} already enrolled` : ''}`,
      );
      setPasteText('');
      setCsvFileName('');
      setCsvText('');
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

  const toggleContact = (key: string) => {
    setSelectedContactKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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

  const lastForm = forms[forms.length - 1];
  const canRemoveLast = forms.length > 1 && !!lastForm && !isFrozen(lastForm);

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
          <div className="flex items-center gap-2 shrink-0">
            {sequence.status === 'active' ? (
              <Button variant="outline" disabled={changingStatus} onClick={() => handleStatus('paused')}>
                {changingStatus ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PauseCircle className="w-4 h-4 mr-2" />}
                Pause
              </Button>
            ) : (
              <Button disabled={changingStatus} onClick={() => handleStatus('active')}>
                {changingStatus ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                Activate
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="seq-name">Sequence name</Label>
            <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            A sequence sends nothing until it is active. Pausing holds every enrollment where it
            stands, so resuming continues rather than starts again.
          </p>
          <div className="flex justify-end">
            <Button onClick={handleSaveName} disabled={savingName || !name.trim() || name.trim() === sequence.name}>
              {savingName ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save name
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Steps</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              The first message and the follow-ups after it, in order.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canRemoveLast && (
              <Button variant="outline" size="sm" disabled={removing} onClick={handleRemoveLastStep}>
                {removing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Remove last step
              </Button>
            )}
            <Button size="sm" onClick={handleAddStep}>
              <Plus className="w-4 h-4 mr-2" />Add step
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {forms.map((form) => {
            const frozen = isFrozen(form);
            const sent = form.campaignId ? (sentCounts[form.campaignId] ?? 0) : 0;
            return (
              <div key={form.stepIndex} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between gap-4 p-4 bg-secondary/40">
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
                    {!form.id && <Badge variant="secondary">Not saved yet</Badge>}
                    {form.id && !form.campaignId && (
                      <Badge variant="destructive">Will not send</Badge>
                    )}
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
                    <Label htmlFor={`step-${form.stepIndex}-body`}>Body (HTML allowed)</Label>
                    <Textarea
                      id={`step-${form.stepIndex}-body`}
                      value={form.bodyHtml}
                      disabled={frozen}
                      className="min-h-[180px] font-mono text-xs"
                      onChange={(e) => setForm(form.stepIndex, (f) => ({ ...f, bodyHtml: e.target.value }))}
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

      <Card>
        <CardHeader><CardTitle>Enroll people</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <RecipientPicker
            mode={mode} onModeChange={setMode}
            contacts={contacts} contactsLoading={contactsLoading}
            selectedContactKeys={selectedContactKeys} onToggleContact={toggleContact}
            onSelectAllContacts={() => setSelectedContactKeys(new Set(contacts.map(recipientKey)))}
            onSelectNoneContacts={() => setSelectedContactKeys(new Set())}
            pasteText={pasteText} onPasteTextChange={setPasteText}
            pastedRecipients={pastedParsed.recipients} pastedErrors={pastedParsed.errors}
            csvFileName={csvFileName}
            onCsvFile={(file) => { file.text().then((t) => { setCsvFileName(file.name); setCsvText(t); }); }}
            csvRecipients={csvParsed.recipients} csvErrors={csvParsed.errors} csvColumns={csvColumns}
          />
          <p className="text-sm font-medium text-foreground">
            {activeRecipients.length} recipient{activeRecipients.length === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-muted-foreground">
            Everyone starts at the first step, due straight away. Somebody already walking this
            sequence is skipped rather than started again, and a suppressed address is stopped by
            the sender with the reason recorded.
          </p>
          <div className="flex justify-end">
            <Button disabled={enrolling || activeRecipients.length === 0} onClick={handleEnroll}>
              {enrolling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Enroll
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
            stoppingId={stoppingId}
            onStop={handleStop}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default SequenceEditor;
