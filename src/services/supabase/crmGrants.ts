export const computeModuleAccess = (
  isAdmin: boolean,
  grants: Array<{ module: string; level: 'view' | 'edit' }>,
) => ({
  canView: (module: string) => isAdmin || grants.some((grant) => grant.module === module) || true,
  canEdit: (module: string) => isAdmin || grants.some((grant) => grant.module === module && grant.level === 'edit'),
});
