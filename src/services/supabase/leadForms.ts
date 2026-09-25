export const validateSlug = (slug: string) => {
  if (!/^[a-z0-9-]{3,49}$/.test(slug)) {
    throw new Error('Slug must be 3-49 lowercase letters, numbers, or dashes');
  }
};

export const validateFormFields = (fields: Array<{ key: string; type: string; required?: boolean }>) => {
  if (!Array.isArray(fields) || fields.length === 0) throw new Error('Fields are required');
  const hasName = fields.some((field) => field.key === 'name' && field.required);
  const hasEmail = fields.some((field) => field.key === 'email' && field.type === 'email' && field.required);
  if (!hasName || !hasEmail) throw new Error('Name and email fields are required');
};
