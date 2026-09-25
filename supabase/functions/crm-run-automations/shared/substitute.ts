const getPath = (ctx: any, path: string) => {
  if (path.startsWith('ai.')) {
    const key = `ai_${path.slice(3).replace(/\./g, '_')}`;
    return ctx.aiOutputs?.[key];
  }
  return path.split('.').reduce((value, key) => value?.[key], ctx);
};

export function substitute(template: string, ctx: any): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, path: string) => {
    const value = getPath(ctx, path.trim());
    return value == null ? match : String(value);
  });
}
