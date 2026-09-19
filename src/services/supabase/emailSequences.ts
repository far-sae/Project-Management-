import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { dedupeRecipients, normalizeEmail } from "@/lib/email/suppression";
import { followUpSubject } from "@/lib/email/sequence";
import { createCampaign, setCampaignStatus, type Recipient } from "./email";
import type {
  EmailEnrollment,
  EmailSequence,
  EmailSequenceStep,
  EnrollmentStatus,
  SequenceStatus,
  StopReason,
} from "@/lib/email/types";

/** Raw shape of an `email_sequences` row (migration 158a). */
interface EmailSequenceRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  created_by: string | null;
  name: string;
  status: SequenceStatus;
  created_at: string;
  updated_at: string;
}

/** Raw shape of an `email_sequence_steps` row (migration 158b). */
interface EmailSequenceStepRow {
  id: string;
  sequence_id: string;
  step_index: number;
  delay_hours: number;
  subject: string;
  body_html: string;
  campaign_id: string | null;
  created_at: string;
}

/** Raw shape of an `email_sequence_enrollments` row (migration 158c). */
interface EmailEnrollmentRow {
  id: string;
  sequence_id: string;
  organization_id: string;
  contact_id: string | null;
  to_email: string;
  to_name: string | null;
  merge_data: Record<string, unknown> | null;
  account_id: string | null;
  current_step: number;
  next_due_at: string | null;
  last_message_id: string | null;
  status: EnrollmentStatus;
  stop_reason: StopReason | null;
  stopped_at: string | null;
  created_at: string;
}

export interface CreateSequenceInput {
  organizationId: string;
  workspaceId?: string | null;
  createdBy?: string | null;
  name: string;
}

/** Partial update — the editor only sends the field it changed. */
export interface UpdateSequenceInput {
  name?: string;
  status?: SequenceStatus;
}

export interface SaveStepInput {
  sequenceId: string;
  stepIndex: number;
  delayHours: number;
  subject: string;
  bodyHtml: string;
}

/**
 * The four numbers the Sequences list shows per sequence. `replied` is the
 * subset of stopped enrollments whose reason is 'replied' and `stopped` is
 * every other stopped reason, so the four add up to the enrollment total
 * rather than counting a reply twice.
 */
export interface SequenceCounts {
  active: number;
  replied: number;
  stopped: number;
  completed: number;
}

/**
 * What `enroll` did. `skipped` is not a failure: the partial unique index
 * `email_enrollments_one_active` (migration 158c) exists precisely so the same
 * address cannot be walked through one sequence twice, and re-enrolling a list
 * that overlaps an earlier one is an ordinary thing to do.
 */
export interface EnrollResult {
  added: number;
  skipped: number;
}

export const mapSequenceRow = (row: EmailSequenceRow): EmailSequence => ({
  id: row.id,
  organizationId: row.organization_id,
  workspaceId: row.workspace_id,
  createdBy: row.created_by,
  name: row.name,
  status: row.status,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const mapStepRow = (row: EmailSequenceStepRow): EmailSequenceStep => ({
  id: row.id,
  sequenceId: row.sequence_id,
  stepIndex: row.step_index,
  delayHours: row.delay_hours,
  subject: row.subject,
  bodyHtml: row.body_html,
  // Passed through as-is: null means the step has no wording stored yet and
  // claim_sequence_enrollments() will not claim it, which every screen that
  // reads this has to be able to see.
  campaignId: row.campaign_id,
  createdAt: new Date(row.created_at),
});

export const mapEnrollmentRow = (row: EmailEnrollmentRow): EmailEnrollment => ({
  id: row.id,
  sequenceId: row.sequence_id,
  organizationId: row.organization_id,
  contactId: row.contact_id,
  toEmail: row.to_email,
  toName: row.to_name,
  mergeData: row.merge_data ?? {},
  accountId: row.account_id,
  currentStep: row.current_step,
  nextDueAt: row.next_due_at ? new Date(row.next_due_at) : null,
  lastMessageId: row.last_message_id,
  status: row.status,
  stopReason: row.stop_reason,
  stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
  createdAt: new Date(row.created_at),
});

// ── Sequences ─────────────────────────────────────────────────────────

/**
 * `workspaceId` is optional and defaults to "every workspace", which is what
 * the Email page passes when the workspace switcher is on All — the same
 * filter `listCampaigns` applies, and the same default the brief's
 * single-argument signature implies.
 */
export const listSequences = async (
  orgId: string,
  workspaceId: string | null = null,
): Promise<EmailSequence[]> => {
  let query = supabase.from("email_sequences").select("*").eq("organization_id", orgId);
  if (workspaceId !== null) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list email sequences:", error);
    throw error;
  }

  return ((data ?? []) as EmailSequenceRow[]).map(mapSequenceRow);
};

/**
 * The enrollment counts for a whole page of sequences in one read, keyed by
 * sequence id. One query for the list rather than one per row: the list is
 * the only caller and it needs all of them at once.
 */
export const listEnrollmentCounts = async (
  sequenceIds: string[],
): Promise<Record<string, SequenceCounts>> => {
  const counts: Record<string, SequenceCounts> = {};
  if (sequenceIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("email_sequence_enrollments")
    .select("sequence_id, status, stop_reason")
    .in("sequence_id", sequenceIds);

  if (error) {
    logger.error("Failed to count sequence enrollments:", error);
    throw error;
  }

  const rows = (data ?? []) as Pick<EmailEnrollmentRow, "sequence_id" | "status" | "stop_reason">[];
  for (const row of rows) {
    const bucket = counts[row.sequence_id] ?? { active: 0, replied: 0, stopped: 0, completed: 0 };
    if (row.status === "active") bucket.active += 1;
    else if (row.status === "completed") bucket.completed += 1;
    else if (row.stop_reason === "replied") bucket.replied += 1;
    else bucket.stopped += 1;
    counts[row.sequence_id] = bucket;
  }

  return counts;
};

/**
 * How many steps each of these sequences has, keyed by sequence id — the
 * "3 steps" on each row of the list, read once for the whole page rather than
 * per row. Only the `sequence_id` column is selected: the list does not need
 * the wording, and the wording is the big part of a step.
 */
export const listStepCounts = async (
  sequenceIds: string[],
): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  if (sequenceIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("email_sequence_steps")
    .select("sequence_id")
    .in("sequence_id", sequenceIds);

  if (error) {
    logger.error("Failed to count sequence steps:", error);
    throw error;
  }

  for (const row of (data ?? []) as { sequence_id: string }[]) {
    counts[row.sequence_id] = (counts[row.sequence_id] ?? 0) + 1;
  }

  return counts;
};

export const getSequence = async (
  id: string,
): Promise<{ sequence: EmailSequence; steps: EmailSequenceStep[] }> => {
  const { data, error } = await supabase
    .from("email_sequences")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    logger.error("Failed to load email sequence:", error);
    throw error;
  }

  return { sequence: mapSequenceRow(data as EmailSequenceRow), steps: await listSteps(id) };
};

export const listSteps = async (sequenceId: string): Promise<EmailSequenceStep[]> => {
  const { data, error } = await supabase
    .from("email_sequence_steps")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("step_index", { ascending: true });

  if (error) {
    logger.error("Failed to list sequence steps:", error);
    throw error;
  }

  return ((data ?? []) as EmailSequenceStepRow[]).map(mapStepRow);
};

/**
 * Creates the sequence and its first step in one go.
 *
 * The step is inserted blank and, deliberately, WITHOUT a hidden campaign: a
 * campaign is what makes a step sendable, and a step nobody has written yet
 * must not be. `saveStep` creates it the first time the step is saved with
 * wording, which is also the only moment there is a subject and a body to put
 * in it. Until then `claim_sequence_enrollments()` leaves the enrollment where
 * it stands rather than advancing past the step, which is exactly right.
 */
export const createSequence = async (input: CreateSequenceInput): Promise<EmailSequence> => {
  const { data, error } = await supabase
    .from("email_sequences")
    .insert({
      organization_id: input.organizationId,
      workspace_id: input.workspaceId ?? null,
      created_by: input.createdBy ?? null,
      name: input.name,
    })
    .select()
    .single();

  if (error) {
    logger.error("Failed to create email sequence:", error);
    throw error;
  }

  const sequence = mapSequenceRow(data as EmailSequenceRow);

  const { error: stepError } = await supabase.from("email_sequence_steps").insert({
    sequence_id: sequence.id,
    step_index: 0,
    // Step 0 is sent on enrollment, so its delay is ignored — stored as 0
    // rather than the column default of 72 so nothing on screen claims a wait
    // that will not happen.
    delay_hours: 0,
    subject: "",
    body_html: "",
  });

  if (stepError) {
    logger.error("Failed to create the sequence's first step:", stepError);
    throw stepError;
  }

  return sequence;
};

export const updateSequence = async (id: string, input: UpdateSequenceInput): Promise<void> => {
  const row: Record<string, unknown> = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("email_sequences").update(row).eq("id", id);

  if (error) {
    logger.error("Failed to update email sequence:", error);
    throw error;
  }
};

// ── Steps and their hidden campaigns ──────────────────────────────────

/**
 * How many `email_messages` rows each of these step campaigns has, keyed by
 * campaign id. A count, never the rows: the only question the editor asks is
 * "has this step gone to anybody", and a step sent to ten thousand people must
 * not pull ten thousand rows into the browser to answer it.
 */
export const countStepMessages = async (
  campaignIds: string[],
): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  const ids = campaignIds.filter((id): id is string => !!id);
  if (ids.length === 0) return counts;

  await Promise.all(
    ids.map(async (campaignId) => {
      const { count, error } = await supabase
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId);

      if (error) {
        logger.error("Failed to count messages for a sequence step:", error);
        throw error;
      }

      counts[campaignId] = count ?? 0;
    }),
  );

  return counts;
};

/** Updates the wording on a step's hidden campaign. */
const updateStepCampaign = async (
  campaignId: string,
  fields: { name?: string; subject?: string; bodyHtml?: string },
): Promise<void> => {
  const row: Record<string, unknown> = {
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.subject !== undefined ? { subject: fields.subject } : {}),
    ...(fields.bodyHtml !== undefined ? { body_html: fields.bodyHtml } : {}),
  };

  const { error } = await supabase.from("email_campaigns").update(row).eq("id", campaignId);

  if (error) {
    logger.error("Failed to update a sequence step's campaign:", error);
    throw error;
  }
};

/** The name a step's hidden campaign carries. Never shown on the Campaigns
 *  list — that list excludes `kind = 'sequence'` — but it is what an admin
 *  reading the database sees, so it says which step of which sequence. */
const stepCampaignName = (sequenceName: string, stepIndex: number): string =>
  `${sequenceName} — step ${stepIndex + 1}`;

/**
 * Saves one step and the hidden campaign that carries its wording.
 *
 * The campaign is not optional. `email_messages` has no subject and no body
 * column: every step's words live on an `email_campaigns` row of kind
 * 'sequence', and `claim_sequence_enrollments()` refuses a step whose
 * `campaign_id` is null, so a step saved without one would silently never
 * send. `account_id` stays null on purpose — the step's campaign is shared by
 * every enrollment at that step, so pinning it would route all of them through
 * one mailbox and undo the pool; the per-enrollment pin lives on
 * `email_messages.pinned_account_id` and the worker writes it (migration 158d).
 *
 * The follow-up subject is resolved HERE, at save time, because that is where
 * the campaign is written. So saving step 0 also re-resolves the campaigns of
 * the later steps that inherit its subject — except a step already sent to
 * somebody, whose wording is fixed, including the subject people have already
 * received.
 */
export const saveStep = async (input: SaveStepInput): Promise<EmailSequenceStep> => {
  const { sequence, steps } = await getSequence(input.sequenceId);
  const stepZeroSubject =
    input.stepIndex === 0
      ? input.subject.trim()
      : (steps.find((s) => s.stepIndex === 0)?.subject ?? "").trim();

  // Step 0 starts the thread and carries its own subject; a later step with a
  // blank subject inherits `Re: ` + step 0's, which is what keeps the
  // follow-up in the same conversation.
  const resolvedSubject =
    input.stepIndex === 0
      ? input.subject.trim()
      : followUpSubject(input.subject, stepZeroSubject);

  const { data, error } = await supabase
    .from("email_sequence_steps")
    .upsert(
      {
        sequence_id: input.sequenceId,
        step_index: input.stepIndex,
        delay_hours: input.delayHours,
        subject: input.subject,
        body_html: input.bodyHtml,
      },
      { onConflict: "sequence_id,step_index" },
    )
    .select()
    .single();

  if (error) {
    logger.error("Failed to save sequence step:", error);
    throw error;
  }

  let step = mapStepRow(data as EmailSequenceStepRow);

  if (step.campaignId) {
    await updateStepCampaign(step.campaignId, {
      name: stepCampaignName(sequence.name, step.stepIndex),
      subject: resolvedSubject,
      bodyHtml: input.bodyHtml,
    });
  } else {
    const campaign = await createCampaign({
      organizationId: sequence.organizationId,
      workspaceId: sequence.workspaceId,
      createdBy: sequence.createdBy,
      // The whole pool. See the doc comment above.
      accountId: null,
      kind: "sequence",
      name: stepCampaignName(sequence.name, step.stepIndex),
      subject: resolvedSubject,
      bodyHtml: input.bodyHtml,
    });
    // createCampaign inserts at the table's default 'draft', and
    // claim_email_batch() only claims messages whose campaign is 'sending' or
    // 'scheduled' — a step campaign left at draft would queue rows that are
    // never sent.
    await setCampaignStatus(campaign.id, "sending");

    const { error: linkError } = await supabase
      .from("email_sequence_steps")
      .update({ campaign_id: campaign.id })
      .eq("id", step.id);

    if (linkError) {
      logger.error("Failed to link a sequence step to its campaign:", linkError);
      throw linkError;
    }

    step = { ...step, campaignId: campaign.id };
  }

  if (input.stepIndex === 0) {
    await reresolveInheritedSubjects(steps, resolvedSubject);
  }

  return step;
};

/**
 * Re-writes the subject on every later step that inherits step 0's — skipping
 * any step already sent to somebody, whose wording is fixed.
 *
 * `steps` is the list as it was BEFORE this save, which is what says which
 * steps had a blank subject of their own.
 */
const reresolveInheritedSubjects = async (
  steps: EmailSequenceStep[],
  stepZeroSubject: string,
): Promise<void> => {
  const inheriting = steps.filter(
    (s) => s.stepIndex > 0 && s.subject.trim() === "" && s.campaignId !== null,
  );
  if (inheriting.length === 0) return;

  const counts = await countStepMessages(inheriting.map((s) => s.campaignId as string));

  const inherited = followUpSubject("", stepZeroSubject);
  for (const s of inheriting) {
    const campaignId = s.campaignId as string;
    if ((counts[campaignId] ?? 0) > 0) continue;
    await updateStepCampaign(campaignId, { subject: inherited });
  }
};

/**
 * Removes a step. Its hidden campaign goes with it only when nothing was ever
 * sent from it: a campaign with messages is the record of what went to whom,
 * and deleting it would take that history with it.
 */
export const deleteStep = async (stepId: string, campaignId: string | null): Promise<void> => {
  const { error } = await supabase.from("email_sequence_steps").delete().eq("id", stepId);

  if (error) {
    logger.error("Failed to delete sequence step:", error);
    throw error;
  }

  if (!campaignId) return;

  const counts = await countStepMessages([campaignId]);
  if ((counts[campaignId] ?? 0) > 0) return;

  const { error: campaignError } = await supabase
    .from("email_campaigns")
    .delete()
    .eq("id", campaignId);

  if (campaignError) {
    // The step is already gone and the leftover campaign is invisible — it is
    // excluded from the Campaigns list by kind — so this is reported and not
    // thrown: failing here would tell the user the removal failed when it did
    // not.
    logger.error("Failed to delete an unused sequence step campaign:", campaignError);
  }
};

// ── Enrollments ───────────────────────────────────────────────────────

const ENROLL_CHUNK_SIZE = 500;
/** PostgreSQL's unique_violation, which is what the one-active-enrollment
 *  index raises for an address already walking this sequence. */
const UNIQUE_VIOLATION = "23505";

/**
 * Enrolls people, starting them at step 0 due now.
 *
 * An address already active in this sequence is skipped and counted, never
 * surfaced as a failure: the partial unique index (migration 158c) is there so
 * nobody receives the same sequence twice, and re-enrolling a list that
 * overlaps an earlier one is an ordinary thing to do. Addresses already active
 * are filtered out before the insert; the per-row retry below is for the
 * narrower case of two people enrolling the same list at once.
 *
 * Suppressed addresses are deliberately NOT filtered here.
 * `claim_sequence_enrollments()` stops a suppressed enrollment itself
 * (migration 159), so the stop is recorded with a reason a person can read
 * instead of the enrollment quietly never existing.
 */
export const enroll = async (
  sequenceId: string,
  orgId: string,
  recipients: Recipient[],
): Promise<EnrollResult> => {
  const unique = dedupeRecipients(recipients);
  if (unique.length === 0) return { added: 0, skipped: 0 };

  const { data: activeRows, error: activeError } = await supabase
    .from("email_sequence_enrollments")
    .select("to_email")
    .eq("sequence_id", sequenceId)
    .eq("status", "active");

  if (activeError) {
    logger.error("Failed to load existing enrollments:", activeError);
    throw activeError;
  }

  const alreadyActive = new Set(
    ((activeRows ?? []) as { to_email: string }[]).map((r) => normalizeEmail(r.to_email)),
  );

  const fresh = unique.filter((r) => !alreadyActive.has(normalizeEmail(r.email)));
  let skipped = unique.length - fresh.length;
  let added = 0;

  const toRow = (r: Recipient) => ({
    sequence_id: sequenceId,
    organization_id: orgId,
    contact_id: r.contactId ?? null,
    to_email: r.email,
    to_name: r.name ?? null,
    merge_data: r.mergeData ?? {},
    current_step: 0,
    next_due_at: new Date().toISOString(),
  });

  for (let i = 0; i < fresh.length; i += ENROLL_CHUNK_SIZE) {
    const chunk = fresh.slice(i, i + ENROLL_CHUNK_SIZE);
    const { error } = await supabase.from("email_sequence_enrollments").insert(chunk.map(toRow));

    if (!error) {
      added += chunk.length;
      continue;
    }

    if (error.code !== UNIQUE_VIOLATION) {
      logger.error("Failed to enroll recipients:", error);
      throw error;
    }

    // One address in the chunk was enrolled between the read above and this
    // insert, and the whole statement was rejected with it. Retry the chunk a
    // row at a time so the rest still go in.
    for (const recipient of chunk) {
      const { error: rowError } = await supabase
        .from("email_sequence_enrollments")
        .insert(toRow(recipient));

      if (!rowError) added += 1;
      else if (rowError.code === UNIQUE_VIOLATION) skipped += 1;
      else {
        logger.error("Failed to enroll a recipient:", rowError);
        throw rowError;
      }
    }
  }

  return { added, skipped };
};

export const listEnrollments = async (sequenceId: string): Promise<EmailEnrollment[]> => {
  const { data, error } = await supabase
    .from("email_sequence_enrollments")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to list sequence enrollments:", error);
    throw error;
  }

  return ((data ?? []) as EmailEnrollmentRow[]).map(mapEnrollmentRow);
};

/**
 * Stops one enrollment by hand. An UPDATE, not a DELETE: migration 158c grants
 * no delete on this table deliberately — an enrollment is the record of what
 * was sent to somebody and why it stopped, which is what a complaint is
 * answered with. `next_due_at` is cleared so the materializer's
 * `next_due_at <= now()` claim can never pick it up again.
 */
export const stopEnrollment = async (id: string): Promise<void> => {
  const { error } = await supabase
    .from("email_sequence_enrollments")
    .update({
      status: "stopped",
      stop_reason: "manual",
      stopped_at: new Date().toISOString(),
      next_due_at: null,
    })
    .eq("id", id)
    .eq("status", "active");

  if (error) {
    logger.error("Failed to stop enrollment:", error);
    throw error;
  }
};
