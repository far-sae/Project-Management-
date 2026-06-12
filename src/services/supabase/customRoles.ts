// src/services/supabase/customRoles.ts
//
// CRUD for owner-defined roles (custom_roles, migration 135). A role is a name
// + a per-page permission map ({ pageKey: 'view' | 'edit' }). Members are
// assigned a role via `customRoleId` on organizations.members (handled by the
// Team page through updateOrganization), not here.

import { supabase } from './config';
import type { RolePermissionMap } from '@/lib/pagePermissions';

export interface CustomRole {
  roleId: string;
  organizationId: string;
  name: string;
  description: string | null;
  permissions: RolePermissionMap;
  createdAt: Date;
  updatedAt: Date;
}

const mapRole = (r: Record<string, unknown>): CustomRole => ({
  roleId: r.role_id as string,
  organizationId: r.organization_id as string,
  name: r.name as string,
  description: (r.description as string) ?? null,
  permissions: (r.permissions as RolePermissionMap) ?? {},
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

/** All custom roles in an org (for the Team editor + resolving member access). */
export const listCustomRoles = async (orgId: string): Promise<CustomRole[]> => {
  const { data, error } = await supabase
    .from('custom_roles')
    .select('*')
    .eq('organization_id', orgId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapRole);
};

export interface CustomRoleInput {
  name: string;
  description?: string | null;
  permissions: RolePermissionMap;
}

export const createCustomRole = async (
  orgId: string,
  createdBy: string | null,
  input: CustomRoleInput,
): Promise<CustomRole> => {
  const name = input.name.trim();
  if (!name) throw new Error('Role name is required');
  const { data, error } = await supabase
    .from('custom_roles')
    .insert({
      organization_id: orgId,
      name,
      description: input.description?.trim() || null,
      permissions: input.permissions ?? {},
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('A role with that name already exists.');
    }
    throw error;
  }
  return mapRole(data as Record<string, unknown>);
};

export const updateCustomRole = async (
  orgId: string,
  roleId: string,
  patch: Partial<CustomRoleInput>,
): Promise<CustomRole> => {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('Role name cannot be empty');
    update.name = name;
  }
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
  if (patch.permissions !== undefined) update.permissions = patch.permissions;
  const { data, error } = await supabase
    .from('custom_roles')
    .update(update)
    .eq('organization_id', orgId)
    .eq('role_id', roleId)
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('A role with that name already exists.');
    }
    throw error;
  }
  return mapRole(data as Record<string, unknown>);
};

export const deleteCustomRole = async (orgId: string, roleId: string): Promise<void> => {
  const { error } = await supabase
    .from('custom_roles')
    .delete()
    .eq('organization_id', orgId)
    .eq('role_id', roleId);
  if (error) throw error;
};
