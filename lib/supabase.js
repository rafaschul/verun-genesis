// ─── Verun Genesis — Supabase Client ──────────────────────────
import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
  _client = createClient(url, key);
  return _client;
}

// ─── agents table ─────────────────────────────────────────────
// id            uuid primary key
// claim_id      text unique (vga-0001)
// claim_number  int unique (1)
// address       text unique
// address_type  text (stellar | evm | github | email)
// score         int
// tier          text (Genesis Founding | Genesis Extended | Genesis Open)
// status        text (invite_pending | provisional | verified)
// invite_code   text nullable
// stellar_tx    text nullable (tx hash from anchor)
// explorer_url  text nullable
// created_at    timestamptz

export async function getNextClaimNumber(supabase) {
  const { data, error } = await supabase
    .from('agents')
    .select('claim_number')
    .order('claim_number', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data?.claim_number ?? 0) + 1;
}

export async function getTotalRegistered(supabase) {
  const { count, error } = await supabase
    .from('agents')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function getAgentByAddress(supabase, address) {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('address', address.trim())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function insertAgent(supabase, agent) {
  const { data, error } = await supabase
    .from('agents')
    .insert(agent)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAgentTx(supabase, claimId, txHash, explorerUrl) {
  const { error } = await supabase
    .from('agents')
    .update({ stellar_tx: txHash, explorer_url: explorerUrl })
    .eq('claim_id', claimId);
  if (error) throw error;
}

// ─── invite_codes table ───────────────────────────────────────
// code          text primary key
// used_by       text nullable (address)
// created_at    timestamptz
// used_at       timestamptz nullable

export async function validateInviteCode(supabase, code) {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return { valid: false, reason: 'Invite code not found' };
  if (data.used_by) return { valid: false, reason: 'Invite code already used' };
  return { valid: true, code: data };
}

export async function markInviteCodeUsed(supabase, code, address) {
  const { error } = await supabase
    .from('invite_codes')
    .update({ used_by: address, used_at: new Date().toISOString() })
    .eq('code', code.trim().toUpperCase());
  if (error) throw error;
}

// ─── rate_limits table (simple IP tracking) ───────────────────
export async function checkRateLimit(supabase, ip) {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const oneHourAgo   = new Date(Date.now() - 3_600_000).toISOString();

  const { count: perMin } = await supabase
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', oneMinuteAgo);

  const { count: perHour } = await supabase
    .from('rate_limits')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', oneHourAgo);

  if (perMin >= 5)  return { allowed: false, reason: 'Rate limit: 5 per minute' };
  if (perHour >= 20) return { allowed: false, reason: 'Rate limit: 20 per hour' };

  await supabase.from('rate_limits').insert({ ip, created_at: new Date().toISOString() });
  return { allowed: true };
}
