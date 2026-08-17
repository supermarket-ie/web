import { supabaseAdmin } from '@/lib/supabase';

export type TescoEgressLease = {
  egressKey: string;
  label: string;
};

export async function claimTescoEgress(leaseSeconds = 900): Promise<TescoEgressLease | null> {
  const { data, error } = await supabaseAdmin.rpc('claim_tesco_egress', {
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`Failed claiming Tesco egress: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.egress_key) return null;
  return { egressKey: row.egress_key, label: row.label || row.egress_key };
}

export async function markTescoEgressSuccess(egressKey: string) {
  const { error } = await supabaseAdmin.rpc('mark_tesco_egress_success', {
    p_egress_key: egressKey,
  });
  if (error) throw new Error(`Failed marking Tesco egress success: ${error.message}`);
}

export async function markTescoEgressBlocked(egressKey: string, cooldownHours = 48) {
  const { error } = await supabaseAdmin.rpc('mark_tesco_egress_blocked', {
    p_egress_key: egressKey,
    p_cooldown_hours: cooldownHours,
  });
  if (error) throw new Error(`Failed quarantining Tesco egress: ${error.message}`);
}

export async function releaseTescoEgress(egressKey: string) {
  const { error } = await supabaseAdmin.rpc('release_tesco_egress', {
    p_egress_key: egressKey,
  });
  if (error) throw new Error(`Failed releasing Tesco egress: ${error.message}`);
}
