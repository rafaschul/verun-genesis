// ─── GET /api/score?address=GDRX... ───────────────────────────
// MCP-callable: returns KYA score for any agent address
import { getSupabase, getAgentByAddress } from '../lib/supabase.js';
import { getKickback, getPermissions, CONFIG } from '../lib/config.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { address, operation } = req.query;
  if (!address) return res.status(400).json({ error: 'address query parameter required' });

  try {
    const supabase = getSupabase();
    const agent    = await getAgentByAddress(supabase, address.trim());

    if (!agent) {
      // Unknown agent — score 0, blocked
      return res.status(200).json({
        address,
        score:     0,
        tier:      'UNREGISTERED',
        status:    'BLOCKED',
        permitted: false,
        kickback:  '0%',
        message:   'Agent not registered with Verun KYA. Register at verun.network/genesis',
        register:  'https://verun.network/genesis',
        // x402 compatible error
        kya_error: 'agent_not_registered',
      });
    }

    const kickback    = getKickback(agent.score);
    const permissions = getPermissions(agent.score);
    const permitted   = operation ? permissions[operation] ?? false : agent.score >= CONFIG.THRESHOLD_READ;

    // Score tier labels
    let scoreTier = 'PROVISIONAL';
    if (agent.score >= 800)       scoreTier = 'TRUSTED';
    else if (agent.score >= 600)  scoreTier = 'VERIFIED';
    else if (agent.score >= 300)  scoreTier = 'ACTIVE';

    return res.status(200).json({
      // Core fields (MCP-readable)
      address:    agent.address,
      score:      agent.score,
      tier:       scoreTier,
      status:     agent.status === 'verified' ? 'VERIFIED' : 'PROVISIONAL',
      permitted,
      kickback:   kickback.label,

      // Genesis identity
      genesis: {
        claim_id:     agent.claim_id,
        claim_number: agent.claim_number,
        genesis_tier: agent.tier,
        is_founding:  agent.claim_number <= 10000,
      },

      // Permissions map
      permissions: {
        read:     { required: 300, granted: permissions.read },
        mint:     { required: 500, granted: permissions.mint },
        transfer: { required: 500, granted: permissions.transfer },
        order:    { required: 600, granted: permissions.order },
      },

      // Economics
      economics: {
        current_kickback: kickback.label,
        kickback_at_500:  '5%',
        kickback_at_800:  '10%',
      },

      // On-chain anchor
      anchor: agent.stellar_tx
        ? {
            chain:       'stellar:testnet',
            tx_hash:     agent.stellar_tx,
            explorer_url: agent.explorer_url,
          }
        : null,

      // Validator info
      validator: {
        name:   'Verun Protocol (Founding Validator)',
        status: 'genesis_phase',
        note:   'Institutional 2-of-3 consensus activates June 2026',
      },

      // Score path
      score_path: {
        current:      agent.score,
        next_threshold: agent.score < 300 ? 300 : agent.score < 500 ? 500 : agent.score < 600 ? 600 : agent.score < 800 ? 800 : 1000,
        next_benefit:   agent.score < 300 ? 'Read access' : agent.score < 500 ? '5% kickback + Mint/Transfer' : agent.score < 600 ? 'Order access' : agent.score < 800 ? '10% kickback' : 'Maximum tier',
      },

      meta: {
        network:      'verun.network',
        phase:        'Genesis Beta',
        as_of:        new Date().toISOString(),
      },
    });

  } catch (err) {
    console.error('Score lookup error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
