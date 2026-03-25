// ─── POST /api/register ────────────────────────────────────────
// Registers a new Genesis Agent
// Body: { addressType, address, githubUrl?, email?, inviteCode? }
import { CONFIG, getTier } from '../lib/config.js';
import { runSybilCheck } from '../lib/sybil.js';
import { anchorRegistration } from '../lib/stellar.js';
import { generateCertificate } from '../lib/certificate.js';
import {
  getSupabase, getNextClaimNumber, getTotalRegistered,
  getAgentByAddress, insertAgent, updateAgentTx,
  validateInviteCode, markInviteCodeUsed, checkRateLimit,
} from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';

  try {
    const supabase = getSupabase();

    // ── 1. Rate limit ────────────────────────────────────────
    const rateCheck = await checkRateLimit(supabase, ip);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.reason });
    }

    // ── 2. Parse + validate body ─────────────────────────────
    const { addressType, address, githubUrl, email, inviteCode } = req.body ?? {};
    const validTypes = ['stellar', 'evm', 'github', 'email'];
    if (!addressType || !validTypes.includes(addressType)) {
      return res.status(400).json({ error: 'addressType must be: stellar | evm | github | email' });
    }

    const identifier = (address || email || githubUrl || '').trim();
    if (!identifier) return res.status(400).json({ error: 'Address or identifier required' });

    // ── 3. Check genesis cap ─────────────────────────────────
    const total = await getTotalRegistered(supabase);
    if (total >= CONFIG.GENESIS_CAP) {
      return res.status(410).json({
        error: 'Genesis registration closed',
        message: `All ${CONFIG.GENESIS_CAP.toLocaleString()} Genesis spots have been claimed. Join the waitlist.',`,
        waitlist: 'https://verun.network/waitlist',
      });
    }

    // ── 4. Check duplicate ───────────────────────────────────
    const existing = await getAgentByAddress(supabase, identifier);
    if (existing) {
      return res.status(409).json({
        error: 'Already registered',
        claim_id: existing.claim_id,
        message: 'This address already holds a Genesis position.',
      });
    }

    // ── 5. Invite code check (first INVITE_ONLY_UNTIL spots) ─
    const claimNumber = total + 1;
    let inviteUsed = false;
    let inviteBonus = 0;

    if (claimNumber <= CONFIG.INVITE_ONLY_UNTIL) {
      if (!inviteCode) {
        return res.status(403).json({
          error: 'Invite required',
          message: `The first ${CONFIG.INVITE_ONLY_UNTIL} Genesis spots are invite-only. Request an invite at verun.network`,
          spots_remaining_invite_only: CONFIG.INVITE_ONLY_UNTIL - total,
        });
      }
      const inv = await validateInviteCode(supabase, inviteCode);
      if (!inv.valid) return res.status(403).json({ error: inv.reason });
      inviteUsed = true;
      inviteBonus = CONFIG.SCORE_INVITE_BONUS;
    }

    // ── 6. Sybil check ───────────────────────────────────────
    const sybil = await runSybilCheck({ addressType, address, githubUrl, email });
    if (!sybil.pass) {
      return res.status(422).json({
        error: 'Sybil check failed',
        reason: sybil.reason,
      });
    }

    const finalScore  = Math.min(sybil.score + inviteBonus, 1000);
    const status      = sybil.tier1 ? 'verified' : 'provisional';
    const tier        = getTier(claimNumber);
    const claimId     = `vga-${String(claimNumber).padStart(4, '0')}`;

    // ── 7. Insert agent into DB ──────────────────────────────
    if (inviteUsed) await markInviteCodeUsed(supabase, inviteCode);

    const agent = await insertAgent(supabase, {
      claim_id:     claimId,
      claim_number: claimNumber,
      address:      identifier,
      address_type: addressType,
      score:        finalScore,
      tier:         tier.label,
      status,
      invite_code:  inviteUsed ? inviteCode : null,
      created_at:   new Date().toISOString(),
    });

    // ── 8. Anchor on Stellar Testnet (async, non-blocking) ───
    let stellarTx = null;
    let explorerUrl = null;
    try {
      const anchor = await anchorRegistration({
        claimId,
        address: identifier,
        score: finalScore,
        timestamp: agent.created_at,
      });
      stellarTx   = anchor.txHash;
      explorerUrl = anchor.explorerUrl;
      await updateAgentTx(supabase, claimId, stellarTx, explorerUrl);
    } catch (stellarErr) {
      // Non-fatal — cert is valid without anchor, will retry
      console.error('Stellar anchor failed (non-fatal):', stellarErr.message);
    }

    // ── 9. Generate claim certificate ────────────────────────
    const certificate = generateCertificate({
      claimNumber,
      address:      identifier,
      addressType,
      score:        finalScore,
      status,
      stellarTxHash: stellarTx,
      explorerUrl,
      inviteUsed,
    });

    // ── 10. Response ─────────────────────────────────────────
    return res.status(201).json({
      success:     true,
      claim_id:    claimId,
      claim_number: claimNumber,
      score:       finalScore,
      status,
      tier:        tier.label,
      spots_remaining: CONFIG.GENESIS_CAP - claimNumber,
      stellar_anchor: stellarTx
        ? { tx_hash: stellarTx, explorer_url: explorerUrl }
        : { note: 'Stellar anchor pending — will be added within minutes' },
      certificate,
      next_steps: [
        status === 'provisional'
          ? 'Connect a Stellar or EVM wallet to upgrade your score to 350'
          : 'Your Genesis Agent position is secured.',
        'SBT mint: April 2026 on Stellar',
        'Mainnet activation: June 2026',
        'Kickback payments begin at score 500+',
      ],
    });

  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
