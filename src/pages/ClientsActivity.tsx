// src/pages/ClientsActivity.tsx
//
// Standalone page wrapper for the Activities hub. The real UI lives in
// ActivitiesHubPanel so the same hub can also be embedded inside the
// CRM page's Tabs without nesting <main> elements.

import React from 'react';
import { ActivitiesHubPanel } from '@/components/activities/ActivitiesHubPanel';

export const ClientsActivity: React.FC = () => (
  <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">
    <ActivitiesHubPanel />
  </main>
);

export default ClientsActivity;
