// ─── Verun Genesis — Sybil Protection ────────────────────────
import { checkStellarAddress, isValidStellarAddress, isValidEVMAddress } from './stellar.js';
import { CONFIG } from './config.js';

// ─── Main sybil check router ──────────────────────────────────
export async function runSybilCheck({ addressType, address, githubUrl, email }) {
  switch (addressType) {
    case 'stellar': return checkStellarSybil(address);
    case 'evm':     return checkEVMSybil(address);
    case 'github':  return checkGithubSybil(githubUrl, email);
    case 'email':   return checkEmailSybil(email);
    default:        return { pass: false, reason: 'Unknown address type' };
  }
}

// ─── Stellar Pubnet check (strongest) ─────────────────────────
async function checkStellarSybil(address) {
  if (!isValidStellarAddress(address)) {
    return { pass: false, reason: 'Invalid Stellar address format (must start with G, 56 chars)' };
  }

  const result = await checkStellarAddress(address);
  if (!result.valid) return { pass: false, reason: result.reason };

  return {
    pass: true,
    score: CONFIG.SCORE_WALLET,
    tier1: true,
    details: `Stellar Pubnet · ${result.ageDays} days old · ${result.xlmBalance} XLM`,
  };
}

// ─── EVM address check ────────────────────────────────────────
async function checkEVMSybil(address) {
  if (!isValidEVMAddress(address)) {
    return { pass: false, reason: 'Invalid EVM address format (must be 0x + 40 hex chars)' };
  }

  // Check Ethereum mainnet via public RPC
  try {
    const res = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount',
        params: [address, 'latest'],
      }),
    });
    const data = await res.json();
    const txCount = parseInt(data.result, 16);

    if (txCount === 0) {
      return { pass: false, reason: 'EVM address has no transaction history on Ethereum mainnet' };
    }

    return {
      pass: true,
      score: CONFIG.SCORE_WALLET,
      tier1: true,
      details: `EVM Mainnet · ${txCount} transactions`,
    };
  } catch {
    // If RPC fails, still allow but mark as unverified
    return {
      pass: true,
      score: CONFIG.SCORE_IDENTIFIED,
      tier1: false,
      details: 'EVM address — RPC check skipped',
    };
  }
}

// ─── GitHub check ─────────────────────────────────────────────
async function checkGithubSybil(githubUrl, email) {
  if (!githubUrl || !githubUrl.includes('github.com')) {
    return { pass: false, reason: 'Valid GitHub URL required (e.g. https://github.com/org/repo)' };
  }

  try {
    // Extract owner/repo from URL
    const parts = githubUrl.replace('https://github.com/', '').split('/');
    const owner = parts[0];
    const repo  = parts[1];

    if (!owner) return { pass: false, reason: 'GitHub URL must include username or org' };

    // Check account age via GitHub API
    const userRes = await fetch(`https://api.github.com/users/${owner}`, {
      headers: { 'User-Agent': 'verun-genesis/1.0' },
    });
    if (!userRes.ok) return { pass: false, reason: 'GitHub user not found' };

    const user = await userRes.json();
    const createdAt = new Date(user.created_at);
    const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

    if (ageDays < 30) {
      return {
        pass: false,
        reason: `GitHub account too new (${Math.floor(ageDays)} days). Must be 30+ days old.`,
      };
    }

    return {
      pass: true,
      score: CONFIG.SCORE_IDENTIFIED,
      tier1: false,
      details: `GitHub @${owner} · ${Math.floor(ageDays)} days old · ${user.public_repos} repos`,
    };
  } catch {
    return { pass: false, reason: 'GitHub check failed' };
  }
}

// ─── Email check (weakest — provisional only) ─────────────────
async function checkEmailSybil(email) {
  if (!email || !email.includes('@') || !email.includes('.')) {
    return { pass: false, reason: 'Valid email address required' };
  }

  // Block obvious disposable domains
  const disposableDomains = ['mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'throwam.com'];
  const domain = email.split('@')[1]?.toLowerCase();
  if (disposableDomains.includes(domain)) {
    return { pass: false, reason: 'Disposable email domains not allowed' };
  }

  return {
    pass: true,
    score: CONFIG.SCORE_IDENTIFIED,
    tier1: false,
    details: `Email identified · upgrade to wallet for score ${CONFIG.SCORE_WALLET}`,
  };
}
