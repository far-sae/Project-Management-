const HEADER_ALIASES: Record<string, string> = {
  orgname: 'name',
  orgwebsite: 'website',
  orgsize: 'employee_count',
  orgcountry: 'country',
  fullname: 'primary_contact_name',
  position: 'primary_contact_title',
  linkedinurl: 'linkedin_url',
  seniority: 'lead_seniority',
  functional: 'lead_function',
};

export const normalizeClientCsvHeader = (header: string): string =>
  HEADER_ALIASES[header.trim().toLowerCase()] ?? header;

export const isApolloStyleClientCsv = (headers: string[]): boolean =>
  headers.some((header) => HEADER_ALIASES[header.trim().toLowerCase()] !== undefined);

export const getClientCsvHeaderMappings = (headers: string[]) =>
  headers.map((source) => {
    const target = normalizeClientCsvHeader(source);
    const recognized = target !== source;
    return { source, target, mapped: recognized, recognized };
  });
