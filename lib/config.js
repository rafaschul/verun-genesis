// ─── Verun Genesis — Central Config ───────────────────────────
export const CONFIG = {
  // Genesis cap — change env var to expand (never announced publicly)
  GENESIS_CAP: parseInt(process.env.GENESIS_CAP || '10000'),

  // Invite-only for first 1000 spots (max Sybil protection)
  INVITE_ONLY_UNTIL: parseInt(process.env.INVITE_ONLY_UNTIL || '1000'),

  // Score values
  SCORE_WALLET:      350,   // Stellar/EVM wallet verified
  SCORE_IDENTIFIED:  200,   // GitHub/email identified only
  SCORE_INVITE_BONUS: 50,   // +50 for invited agents

  // Thresholds (KYA protocol — do not change)
  THRESHOLD_READ:     300,
  THRESHOLD_MINT:     500,
  THRESHOLD_TRANSFER: 500,
  THRESHOLD_ORDER:    600,

  // Kickback rates
  KICKBACK_HIGH:  0.10,  // score 800+
  KICKBACK_MID:   0.05,  // score 500–799
  KICKBACK_NONE:  0.00,

  // Stellar Testnet
  STELLAR_NETWORK:     'testnet',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  STELLAR_FRIENDBOT:   'https://friendbot.stellar.org',
  MIN_ACCOUNT_AGE_DAYS: 7,

  // Tiers by claim_id
  TIERS: {
    FOUNDING: { min: 1,      max: 10000,   label: 'Genesis Founding', badge: '🥇' },
    EXTENDED: { min: 10001,  max: 100000,  label: 'Genesis Extended', badge: '🥈' },
    OPEN:     { min: 100001, max: 1000000, label: 'Genesis Open',     badge: '🥉' },
  },

  // Rate limiting
  RATE_LIMIT_PER_MINUTE: 5,
  RATE_LIMIT_PER_HOUR:   20,
};

export function getTier(claimNumber) {
  for (const [key, tier] of Object.entries(CONFIG.TIERS)) {
    if (claimNumber >= tier.min && claimNumber <= tier.max) return { key, ...tier };
  }
  return { key: 'OPEN', ...CONFIG.TIERS.OPEN };
}

export function getKickback(score) {
  if (score >= 800) return { rate: CONFIG.KICKBACK_HIGH, label: '10%' };
  if (score >= 500) return { rate: CONFIG.KICKBACK_MID,  label: '5%' };
  return { rate: CONFIG.KICKBACK_NONE, label: '0%' };
}

export function getPermissions(score) {
  return {
    read:     score >= CONFIG.THRESHOLD_READ,
    mint:     score >= CONFIG.THRESHOLD_MINT,
    transfer: score >= CONFIG.THRESHOLD_TRANSFER,
    order:    score >= CONFIG.THRESHOLD_ORDER,
  };
}
