// ─── Verun Genesis — Claim Certificate Generator ──────────────
import crypto from 'crypto';
import { getTier, getKickback, getPermissions } from './config.js';

// Sign certificate with VERUN_SIGNING_SECRET env var
function signCertificate(payload) {
  const secret = process.env.VERUN_SIGNING_SECRET || 'dev-secret-change-in-prod';
  const data = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
  return signature;
}

export function generateCertificate({
  claimNumber,
  address,
  addressType,
  score,
  status,
  stellarTxHash,
  explorerUrl,
  inviteUsed = false,
}) {
  const claimId    = `vga-${String(claimNumber).padStart(4, '0')}`;
  const tier       = getTier(claimNumber);
  const kickback   = getKickback(score);
  const permissions = getPermissions(score);
  const issuedAt   = new Date().toISOString();
  const validFrom  = '2026-06-01T00:00:00.000Z';

  const payload = {
    type:         'VGA-CLAIM',
    version:      '1.0',
    network:      'verun.network',
    claim_id:     claimId,
    claim_number: claimNumber,
    role:         'genesis_agent',

    identity: {
      address,
      address_type: addressType,
      verified:     status === 'verified',
    },

    score: {
      founding_score: score,
      max_score:      1000,
      note:           'Score activates and grows at mainnet launch (June 2026)',
    },

    tier: {
      name:  tier.label,
      badge: tier.badge,
      range: `vga-${String(tier.min).padStart(4,'0')} – vga-${String(tier.max).padStart(4,'0')}`,
    },

    permissions: {
      read:     { required: 300, granted: permissions.read },
      mint:     { required: 500, granted: permissions.mint },
      transfer: { required: 500, granted: permissions.transfer },
      order:    { required: 600, granted: permissions.order },
    },

    economics: {
      kickback_at_500: '5% of evaluation fee',
      kickback_at_800: '10% of evaluation fee',
      current_kickback: kickback.label,
      payment:          'automatic, on-chain, no claim required',
      fee_split:        '70% treasury / 10% validator / 10% agent kickback / 10% reserve',
    },

    anchor: {
      chain:        'stellar:testnet',
      tx_hash:      stellarTxHash ?? null,
      explorer_url: explorerUrl ?? null,
      anchored:     !!stellarTxHash,
      note:         'Registration anchored on Stellar Testnet via ManageData transaction',
    },

    genesis: {
      status:          'ACTIVE',
      invite_used:     inviteUsed,
      permanent:       true,
      non_transferable: true,
      note:            'Genesis Agent status is permanent and non-transferable. Founding position is secured regardless of mainnet launch date.',
    },

    dates: {
      issued_at:   issuedAt,
      valid_from:  validFrom,
      sbt_mint:    'April 2026 — Stellar SEP-41 Soulbound Token',
      mainnet:     'June 2026',
    },

    issued_by: {
      name:    'Verun Protocol',
      network: 'verun.network',
      github:  'https://github.com/rafaschul/verun-protocol',
    },
  };

  const signature = signCertificate(payload);

  return {
    ...payload,
    signature,
    verify_at: 'https://verun.network/verify',
  };
}

// Verify a certificate signature
export function verifyCertificate(certificate) {
  const { signature, verify_at, ...payload } = certificate;
  const expected = signCertificate(payload);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}
