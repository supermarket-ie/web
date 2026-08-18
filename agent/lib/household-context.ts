import { agentSupabase } from './supabase';
import {
  normaliseHouseholdContext,
  type RawHouseholdContext,
} from '../../src/lib/shopping/household';

export async function loadHouseholdContext(subscriberId: string, familySize?: string | number | null) {
  const { data, error } = await agentSupabase
    .from('households')
    .select('weekly_budget, dietary, dislikes, preferred_stores, memory')
    .eq('subscriber_id', subscriberId)
    .maybeSingle();

  if (error) throw new Error(`Unable to load household context: ${error.message}`);

  return normaliseHouseholdContext({
    subscriber_id: subscriberId,
    family_size: familySize ?? null,
    weekly_budget: data?.weekly_budget == null ? null : Number(data.weekly_budget),
    dietary: data?.dietary ?? [],
    dislikes: data?.dislikes ?? null,
    preferred_stores: data?.preferred_stores ?? [],
    memory: (data?.memory ?? {}) as RawHouseholdContext['memory'],
  });
}
