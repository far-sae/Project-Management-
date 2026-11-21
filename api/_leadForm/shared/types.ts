/**
 * Web forms that create leads: what the form page, the CRM and the server say
 * to each other.
 */

/** What a visitor's browser is given about a form: its wording and which questions it asks. Nothing else. */
export type PublicForm = {
  heading: string;
  intro: string;
  askPhone: boolean;
  askCompany: boolean;
  askMessage: boolean;
  buttonLabel: string;
  thankYou: string;
};

/** What a visitor sends. `website` is a trap for robots: a person never sees or fills it. */
export type FormSubmission = {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message?: string;
  website?: string;
};

export type SubmitReply = { ok: true; thankYou: string };

export const NAME_MAX = 120;
export const EMAIL_MAX = 200;
export const PHONE_MAX = 40;
export const COMPANY_MAX = 160;
export const MESSAGE_MAX = 2000;

export const FORM_GONE_MESSAGE = "This form is no longer available.";
export const NAME_MESSAGE = "Please enter your name.";
export const EMAIL_MESSAGE = "Please enter a valid email address.";
export const TOO_LONG_MESSAGE = "One of the answers is too long. Please shorten it.";
export const TOO_MANY_MESSAGE = "Too many messages were sent from here. Please try again later.";
export const FORM_FAILED_MESSAGE = "Your message could not be sent. Please try again.";

/** The address of a form's own page. */
export const formPath = (formId: string): string => `/f/${formId}`;

/** The snippet a website owner pastes into their page to show the form. */
export const embedCode = (origin: string, formId: string): string =>
  `<iframe src="${origin}${formPath(formId)}" title="Contact form" style="width:100%;max-width:560px;height:640px;border:0" loading="lazy"></iframe>`;
