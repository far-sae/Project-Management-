const getPath = (source: any, path: string) =>
  path.split('.').reduce((value, key) => value?.[key], source);

export function evaluateConditions(conditions: any[], _event: any, ctx: any): boolean {
  return conditions.every((condition) => {
    const actual = getPath(ctx, condition.field);
    switch (condition.operator) {
      case 'eq':
        return actual === condition.value;
      case 'gte':
        return Number(actual) >= Number(condition.value);
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(actual);
      case 'contains':
        return Array.isArray(actual) && actual.includes(condition.value);
      default:
        return false;
    }
  });
}
