export const normalizeEmail = (value: string | null | undefined): string | null => {
  const email = value?.trim().toLowerCase();
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local.split('+')[0]}@${domain}`;
};

export const normalizeCompanyName = (value: string | null | undefined): string | null => {
  const name = value?.trim().toLowerCase();
  if (!name) return null;
  return name
    .replace(/[.,]/g, '')
    .replace(/\b(inc|incorporated|corp|corporation|llc|ltd|limited|co|company)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};
