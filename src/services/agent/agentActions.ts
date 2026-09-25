type Permissions = {
  isAdmin: boolean;
  canEditModule: (module: 'deals' | 'leads') => boolean;
};

export const canRunAction = (action: string, permissions: Permissions): boolean => {
  if (['create_deal', 'update_deal', 'move_deal_stage'].includes(action)) {
    return permissions.canEditModule('deals');
  }
  if (['create_lead', 'update_lead_status'].includes(action)) {
    return permissions.canEditModule('leads');
  }
  return permissions.isAdmin;
};
