// ─── GET /api/stats ───────────────────────────────────────────
// Public stats for landing page + SDF reporting
import { getSupabase, getTotalRegistered } from '../lib/supabase.js';
import { CONFIG } from '../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const supabase = getSupabase();
    const total    = await getTotalRegistered(supabase);

    // Breakdown by address type
    const { data: breakdown } = await supabase
      .from('agents')
      .select('address_type')
      .then(({ data }) => ({
        data: (data || []).reduce((acc, r) => {
          acc[r.address_type] = (acc[r.address_type] || 0) + 1;
          return acc;
        }, {}),
      }));

    // Breakdown by tier
    const { data: tierData } = await supabase
      .from('agents')
      .select('score')
      .then(({ data }) => ({
        data: {
          verified:    (data || []).filter(r => r.score >= 350).length,
          provisional: (data || []).filter(r => r.score < 350).length,
        },
      }));

    return res.status(200).json({
      genesis: {
        total_registered: total,
        spots_remaining:  Math.max(0, CONFIG.GENESIS_CAP - total),
        cap:              CONFIG.GENESIS_CAP,
        percent_claimed:  Math.round((total / CONFIG.GENESIS_CAP) * 100),
      },
      breakdown,
      tiers: tierData,
      network: {
        chain:    'stellar:testnet',
        phase:    'Genesis Beta',
        go_live:  '2026-06-01',
        sbt_mint: '2026-04-01',
      },
      as_of: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
