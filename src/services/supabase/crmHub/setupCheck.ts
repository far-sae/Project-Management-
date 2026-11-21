import { publicMessage } from '@/lib/publicError';
import { supabase } from '../config';
import { SETUP_PARTS, probeState } from '@/lib/crmSetup';
import type { Probe, SetupState } from '@/lib/crmSetup';

type Answer = { error: { code?: string; message?: string } | null };

/** Asks the database the one small question of a probe. Reads at most one row and changes nothing. */
async function ask(probe: Probe): Promise<Answer> {
  try {
    if (probe.kind === 'table') return await supabase.from(probe.table).select('*').limit(1);
    if (probe.kind === 'column') return await supabase.from(probe.table).select(probe.column).limit(1);
    if (probe.kind === 'function') return await supabase.rpc(probe.name, probe.args);
    return { error: null };
  } catch (err) {
    return { error: { message: publicMessage(err, 'The request failed.') } };
  }
}

/** Which parts of the CRM have their database file run, by part id. */
export async function runSetupCheck(): Promise<Record<string, SetupState>> {
  const states = await Promise.all(
    SETUP_PARTS.map(async (part) => {
      if (part.probe.kind === 'none') return [part.id, 'unknown'] as const;
      const answer = await ask(part.probe);
      return [part.id, probeState(part.probe, answer.error)] as const;
    }),
  );
  return Object.fromEntries(states);
}
