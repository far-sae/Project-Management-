/**
 * Finding leads in Apollo: what the server and the page say to each other.
 * Nothing here holds the Apollo key.
 */

/** Whether leads can be found from this workspace. `problem` names what is missing, for the people who run the site. */
export type ProspectSetup = { configured: boolean; ready: boolean; problem: string | null };

/** What to search by. Every list is "any of these". */
export type ProspectFilters = {
  titles: string[];
  /** Where the person lives: a city, a region or a country. */
  locations: string[];
  keywords: string;
  /** Company websites, as bare domains. */
  domains: string[];
  /** Company sizes as Apollo writes them: "11,50". */
  sizes: string[];
  seniorities: string[];
  /** Only people whose email Apollo has verified. */
  verifiedOnly: boolean;
};

/** A person in the search results. The search is free, so it carries no email and only part of the last name. */
export type FoundPerson = {
  id: string;
  firstName: string;
  lastNameHidden: string;
  title: string;
  company: string;
  hasEmail: boolean;
};

export type ProspectSearch = { total: number; page: number; perPage: number; people: FoundPerson[] };

export type RevealedCompany = {
  name: string;
  website: string;
  industry: string;
  size: number | null;
  city: string;
  state: string;
  country: string;
  phone: string;
};

/** A person whose details were bought with a credit. */
export type RevealedPerson = {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  emailStatus: string;
  linkedinUrl: string;
  city: string;
  state: string;
  country: string;
  company: RevealedCompany | null;
};

export type ProspectReveal = {
  people: RevealedPerson[];
  /** Apollo credits this used. */
  credits: number;
  /** People Apollo could not match (no credit is charged for those). */
  notFound: number;
  /** People left out because their email is missing or not verified. */
  unverified: number;
  /** Set when it stopped part-way: why. The people before that are still returned. */
  stopped?: string;
  /**
   * When phone numbers were asked for: the requests to come back for. Apollo
   * finds phone numbers after it has answered, so they are fetched later.
   */
  phoneRequests: string[];
};

/** How a person's number is reached: their mobile, their own line at work, or another number of theirs. */
export type PhoneType = "mobile" | "direct" | "other";

export type ProspectPhones = {
  /** One number a person: the best one Apollo marks as valid. */
  phones: Array<{ id: string; number: string; type: PhoneType }>;
  /** Apollo credits the numbers used (8 for each person a mobile number was found for). */
  credits: number;
  /** Requests Apollo has not finished. Ask again after `retryAfter` seconds. */
  pending: string[];
  retryAfter: number;
};
