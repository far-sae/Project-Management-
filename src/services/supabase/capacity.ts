import { supabase } from './config';
import type { UserCapacity } from '@/types/capacity';
import { logger } from '@/lib/logger';

interface UserCapacityRow {
  user_id: string;
  hours_per_week: number | string;
  updated_at: string;
}

const fromRow = (row: UserCapacityRow): UserCapacity => ({
  userId: row.user_id,
  hoursPerWeek: Number(row.hours_per_week),
  updatedAt: new Date(row.updated_at),
});

export const fetchUserCapacity = async (
  userId: string,
): Promise<UserCapacity | null> => {
  const { data, error } = await supabase
    .from('user_capacity')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.warn('Failed to fetch user_capacity', error.message);
    return null;
  }
  return data ? fromRow(data as UserCapacityRow) : null;
};

export const fetchUserCapacities = async (
  userIds: string[],
): Promise<Map<string, UserCapacity>> => {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('user_capacity')
    .select('*')
    .in('user_id', userIds);
  const map = new Map<string, UserCapacity>();
  if (error) {
    logger.warn('Failed to fetch user_capacities', error.message);
    return map;
  }
  for (const row of (data ?? []) as UserCapacityRow[]) {
    map.set(row.user_id, fromRow(row));
  }
  return map;
};

export const upsertUserCapacity = async (
  userId: string,
  hoursPerWeek: number,
): Promise<UserCapacity> => {
  const { data, error } = await supabase
    .from('user_capacity')
    .upsert(
      {
        user_id: userId,
        hours_per_week: hoursPerWeek,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select()
    .single();
  if (error) {
    logger.error('Failed to upsert user_capacity', error);
    throw error;
  }
  return fromRow(data as UserCapacityRow);
};

export const DEFAULT_HOURS_PER_WEEK = 40;
