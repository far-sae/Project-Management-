/**
 * Signroom types shared by the server (api/_signroom) and the browser. Pure:
 * no Node or browser-only imports. Names follow the Signroom app's domain.ts.
 */

import type { DocumentFont } from "./documentFonts.js";

export type LetterheadElement = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: DocumentFont;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  visible: boolean;
};

export type LetterheadTextBox = LetterheadElement & {
  id: string;
  text: string;
};

export type LetterheadDesign = {
  textBoxes?: LetterheadTextBox[];
  template?: string;
  version: 1;
  headerHeight: number;
  footerHeight: number;
  accent: boolean;
  elements: Record<
    "logo" | "companyName" | "address" | "identifiers" | "rule" | "footer" | "pageNumber",
    LetterheadElement
  >;
};

export type Branding = {
  secondaryColor?: string;
  backgroundTemplate?: { hash: string; name: string; workspaceId: string } | null;
  templateOverlay?: boolean;
  bodyBold?: boolean;
  bodyItalic?: boolean;
  fontFamily?: DocumentFont;
  design?: LetterheadDesign;
  companyName: string;
  logo?: string;
  address: string;
  companyNumber: string;
  taxNumber: string;
  color: string;
  fontSize: number;
  footer: string;
  layout: "letterhead" | "minimal";
  logoPosition: "left" | "right";
  paymentInstructions: string;
};

/** A letterhead PDF the workspace has uploaded; the bytes are the blob stored under `hash`. */
export type TemplateFile = { workspaceId: string; hash: string; name: string };

/** One workspace in a person's switcher: only what the switcher needs. */
export type WorkspaceChoice = { id: string; name: string; role: "Owner" | "Member" };

/** A person in a workspace (SR's shape). `verified` is always true: only confirmed accounts reach the tool. */
export type TeamMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: "Owner" | "Member";
  user: { id: string; name: string; email: string; verified: true };
};

/** An email-bound team invitation. The link itself is never stored, only its sha256. `expires` is epoch ms. */
export type TeamInvite = {
  id: string;
  workspaceId: string;
  email: string;
  invitedBy: string;
  expires: number;
  usedAt?: string;
  revoked: boolean;
  created: string;
};

export type Workspace = {
  branding?: Branding;
  templateFiles?: TemplateFile[];
  id: string;
  /** auth user id of the owner */
  owner: string;
  name: string;
  replyTo: string;
  senderName?: string;
  senderEmail?: string;
  logo?: string;
  retentionDays: number;
  suspended: boolean;
  created: string;
};

export type ClientAccountSettings = {
  currency: string;
  paymentTermsDays: number;
  reference: string;
  notes: string;
  revision: number;
};

export type Client = {
  account?: ClientAccountSettings;
  /** The CRM company this client stands for. Clients are made from CRM companies, never typed in twice. */
  crmCompanyId?: string | null;
  id: string;
  workspaceId: string;
  name: string;
  contactName: string;
  email: string;
  companyNumber: string;
  notes: string;
  billingAddress?: string;
  created: string;
  archived: boolean;
};

export type InvoiceLine = {
  billingType?: "One-off" | "Monthly" | "Quarterly" | "Yearly" | "Custom";
  billingLabel?: string;
  taxBps?: number;
  taxMinor?: number;
  description: string;
  quantityMilli: number;
  rateMinor: number;
  totalMinor: number;
};

export type Payment = {
  id: string;
  amountMinor: number;
  paidOn: string;
  reference: string;
  method: string;
  receiptNumber: string;
  /** "" until the receipt PDF has been hashed */
  receiptHash: string;
  recordedAt: string;
};

export type InvoiceEvent = { at: string; type: string; actor: string };

export type Invoice = {
  /** The CRM deal this invoice bills for, when it was raised from one. */
  dealId?: string | null;
  projectId?: string;
  receiptDraft?: {
    enabled: boolean;
    amount: string;
    paidOn: string;
    method: string;
    reference: string;
  };
  project?: string;
  id: string;
  workspaceId: string;
  clientId: string;
  createdBy: string;
  revision: number;
  status: "Draft" | "Issued" | "Part paid" | "Paid" | "Voided";
  number: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  taxBps: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  notes: string;
  created: string;
  updated: string;
  branding?: Branding;
  customer?: {
    name: string;
    contactName: string;
    email: string;
    companyNumber: string;
    billingAddress?: string;
  };
  invoiceHash?: string;
  issuedAt?: string;
  sentAt?: string;
  payments: Payment[];
  events: InvoiceEvent[];
};

export type Delivery = {
  id: string;
  workspaceId: string;
  invoiceId?: string;
  agreementId?: string;
  participantId?: string;
  /** The job that sent this agreement email (Ruling B2: a held job marks its row failed). */
  jobId?: string;
  recipient: string;
  subject: string;
  purpose: string;
  /** Unknown only on a held job's row written after its run died before sending. */
  route?: "mailbox" | "securovix";
  status: "sending" | "sent" | "failed";
  error?: string;
  created: string;
};

/** A private billing link. `expires` and the code times are epoch milliseconds. */
export type BillingToken = {
  id: string;
  digest: string;
  purpose: "billing";
  workspaceId: string;
  invoiceId?: string;
  paymentId?: string;
  artifactHash?: string;
  email: string;
  expires: number;
  revoked: boolean;
  codeDigest?: string;
  codeExpires?: number;
  codeSent?: number;
  attempts: number;
  codeSends: number;
  codeWindowStart?: number;
};

export type GuestSession = {
  digest: string;
  kind: "billing";
  tokenId?: string;
  workspaceId: string;
  invoiceId?: string;
  expires: number;
};

// ------------------------------------------------------------ agreements (Signroom domain.ts)

export const CONSENT = {
  version: "2026-11-v1",
  text: "I agree to use an electronic signature and intend to sign this agreement.",
};
export const TYPES = [
  "NDA",
  "Statement of work",
  "Service agreement",
  "Engagement letter",
  "Contract",
  "Agreement",
  "Other agreement",
] as const;
export const FIELD_TYPES = [
  "signature",
  "initials",
  "full_name",
  "company",
  "title",
  "date_signed",
  "text",
  "checkbox",
] as const;

export type FieldKind = (typeof FIELD_TYPES)[number];

export type Participant = {
  id: string;
  name: string;
  email: string;
  role: "signer" | "copy";
  order: number;
  progress: "waiting" | "invited" | "verified" | "viewed" | "signed" | "declined";
  version: number;
  signedAt?: string;
  signature?: string;
  drawing?: string;
  values?: Record<string, string | boolean>;
  submissionId?: string;
  verification?: string;
};

export type Field = {
  id: string;
  participantId: string;
  kind: FieldKind;
  label: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
};

export type PageInfo = { width: number; height: number };

export type EvidenceEvent = {
  seq: number;
  type: string;
  actor: string;
  at: string;
  detail: Record<string, unknown>;
};

export type AgreementDelivery = { id: string; participantId?: string; state: Delivery["status"]; at: string };

export type Agreement = {
  /** The CRM deal this agreement closes, when it was started from one. */
  dealId?: string | null;
  archivedAt?: string;
  trashedAt?: string;
  branding?: Branding;
  senderFirst?: boolean;
  senderReleasePending?: boolean;
  senderSignedHash?: string;
  id: string;
  workspaceId: string;
  senderId: string;
  clientId: string;
  type: string;
  title: string;
  status: "Draft" | "Awaiting signatures" | "Finalising" | "Completed" | "Declined" | "Cancelled" | "Expired";
  revision: number;
  content: string;
  sourceKind: "authored" | "upload";
  documentHash?: string;
  pages: PageInfo[];
  participants: Participant[];
  fields: Field[];
  sequential: boolean;
  /** "" or YYYY-MM-DD */
  deadline: string;
  reminderDays: number;
  subject: string;
  message: string;
  created: string;
  updated: string;
  sentAt?: string;
  completedAt?: string;
  sendKey?: string;
  frozen?: {
    sourceHash: string;
    branding?: Branding;
    snapshotHash: string;
    sender?: { name: string; email: string; workspaceName: string };
    consent: typeof CONSENT;
    revision: number;
    participants: Participant[];
    fields: Field[];
    settings: {
      sequential: boolean;
      deadline: string;
      reminderDays?: number;
      subject?: string;
      message?: string;
    };
  };
  events: EvidenceEvent[];
  /** Finished files by name (final PDF, certificate, evidence, export) to their blob hashes. Set once when finishing; never changed. */
  artifacts?: Record<string, string>;
  templateVersionId?: string;
  legalHold: boolean;
  /** When the sender last exported the evidence ZIP (ISO time). */
  exportedAt?: string;
  /** When retention ends and the agreement may be deleted (ISO time). */
  deletionAt?: string;
  lastReminderAt?: string;
  deliveries?: AgreementDelivery[];
  /** The evidence history frozen when finishing; set once and never changed. */
  finalSnapshot?: EvidenceEvent[];
  /** The checked origin the invitations were sent from; background links use it. */
  linkOrigin?: string;
};

export type AgreementSummary = Omit<Agreement, "content" | "events" | "branding" | "frozen" | "fields">;

export type AgreementTemplate = {
  branding?: Branding;
  documentHash?: string;
  pages?: PageInfo[];
  sourceKind?: "authored" | "upload";
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  version: number;
  content: string;
  roles: string[];
  fields: (Omit<Field, "participantId"> & { roleIndex: number })[];
  created: string;
};

export type AgreementTemplateSummary = Pick<AgreementTemplate, "id" | "name" | "type" | "version" | "created">;

/** A Draft with AI reply (Ruling C9): shown for review in the editor, never saved by the server. */
export type AiDraft = { content: string; model: string; reviewRequired: true };

/** An invitation link's stored side. Only the digest of the raw token is kept. `expires` is epoch milliseconds. */
export type SignToken = {
  id: string;
  digest: string;
  purpose: "sign" | "complete";
  workspaceId: string;
  agreementId: string;
  participantId: string;
  email: string;
  version: number;
  expires: number;
  revoked: boolean;
  codeDigest?: string;
  codeExpires?: number;
  codeSent?: number;
  attempts: number;
  codeSends: number;
  codeWindowStart?: number;
};

/** A guest's session after the emailed code is accepted. Only the cookie's digest is kept. `expires` is epoch milliseconds. */
export type SignSession = {
  digest: string;
  tokenId: string;
  workspaceId: string;
  agreementId: string;
  participantId: string;
  purpose: "sign" | "complete";
  version: number;
  expires: number;
};

/** Background work run by the server. Times in `available` and `leaseUntil` are epoch milliseconds. */
export type Job = {
  id: string;
  workspaceId: string;
  agreementId?: string;
  participantId?: string;
  kind: "mail" | "finalise" | "delete";
  purpose: string;
  dedupe: string;
  status: "queued" | "working" | "done" | "failed" | "suppressed";
  attempts: number;
  available: number;
  leaseUntil?: number;
  payload: string;
  error?: string;
  liveAttemptedAt?: string;
  manualReview: boolean;
  created: string;
};

export type NewJob = Pick<Job, "workspaceId" | "agreementId" | "participantId" | "kind" | "purpose" | "dedupe" | "payload"> & { available?: number };

/** A one-use right to upload one PDF to <workspaceId>/quarantine/<id>.pdf. */
export type UploadTicket = {
  id: string;
  workspaceId: string;
  agreementId: string;
  path: string;
  created: string;
  used?: string;
};

export type ClientProject = {
  monthlyEntries?: Record<
    string,
    {
      paidMinor: number;
      expectedMinor: number;
      notes: string;
      updated: string;
      updatedBy: string;
    }
  >;
  id: string;
  workspaceId: string;
  clientId: string;
  createdBy: string;
  name: string;
  billingType: "One-off" | "Monthly" | "Custom";
  billingLabel: string;
  currency: string;
  monthlyFeeMinor: number;
  contractValueMinor: number;
  annualTargetMinor: number;
  startMonth: string;
  endMonth: string;
  status: "Active" | "On hold" | "Completed";
  notes: string;
  archived: boolean;
  revision: number;
  created: string;
  updated: string;
};

export type ProjectYear = ClientProject & {
  months: number[];
  invoiceMonths: number[];
  expectedMonths: number[];
  upcomingMonths: number[];
  upcomingMinor: number;
  targetMinor: number;
  receivedMinor: number;
  invoicedMinor: number;
  outstandingMinor: number;
  remainingTargetMinor: number;
};

export type ProjectList = { year: number; clientName: string; projects: ProjectYear[] };

export type AccountEntry = {
  id: string;
  date: string;
  kind: "Invoice" | "Payment";
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  currency: string;
  chargeMinor: number;
  paymentMinor: number;
  balanceMinor: number;
};

export type AccountSummary = {
  currency: string;
  invoicedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  currentMinor: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
};

export type Statement = {
  asOf: string;
  summaries: AccountSummary[];
  entries: AccountEntry[];
  opening: Record<string, number>;
  closing: Record<string, number>;
};

export type ClientAccount = Statement & {
  settings: ClientAccountSettings;
  canManage: boolean;
};

export type OverviewRow = {
  id: string;
  clientId: string;
  clientName: string;
  archived: boolean;
  reference: string;
  source: "Project plan" | "Invoice";
  period: string;
  currency: string;
  paidMinor: number;
  remainingMinor: number;
  status: "paid" | "upcoming" | "overdue";
};

export type AccountsOverviewData = { year: number; today: string; rows: OverviewRow[] };

/** Sentences the server sends and the browser compares against (one source for both sides). */
export const INVITE_REFUSED_MESSAGE = "This invite is expired or belongs to another email address.";
export const CREATOR_ONLY_MESSAGE = "Only the person who created this workspace can change its email connection.";
