// ─── Verun Genesis — Stellar ManageData Anchor ────────────────
// Kite's snippet — production-ready, Soroban RPC, PENDING polling
import { Keypair, TransactionBuilder, Operation, Networks, rpc, xdr } from '@stellar/stellar-sdk';
import crypto from 'crypto';

const SOROBAN_RPC_URL  = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET;
const server = new rpc.Server(SOROBAN_RPC_URL);

function getServiceKeypair() {
  const secret = process.env.STELLAR_SECRET_KEY;
  if (!secret) throw new Error('STELLAR_SECRET_KEY not set');
  return Keypair.fromSecret(secret);
}

// Generate a new service keypair (run once, store secret in env)
export function generateServiceKeypair() {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secret: kp.secret() };
}

// Fund on testnet via Friendbot (run once)
export async function fundServiceAccount(publicKey) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!res.ok) throw new Error('Friendbot failed');
  return res.json();
}

// ─── Core anchor — Kite's ManageData approach ─────────────────
export async function anchorRegistration({ claimId, address, score, timestamp }) {
  const kp = getServiceKeypair();

  const registrationPayload = { claimId, address, score, ts: timestamp || Date.now() };

  // key  <= 64 bytes: "vga:0001"
  const key = `vga:${claimId}`.slice(0, 64);

  // value <= 64 bytes: sha256 hex of payload (64 chars = 64 bytes UTF-8)
  const val = Buffer.from(
    crypto.createHash('sha256').update(JSON.stringify(registrationPayload)).digest('hex').slice(0, 64),
    'utf8'
  );

  const acc = await server.getAccount(kp.publicKey());

  const tx = new TransactionBuilder(acc, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.manageData({ name: key, value: val }))
    .setTimeout(30)
    .build();

  tx.sign(kp);

  const sent = await server.sendTransaction(tx);

  // Handle PENDING — poll until confirmed (Kite's pattern)
  if (sent.status === 'PENDING') {
    const hash = sent.hash;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const txRes = await server.getTransaction(hash);
      if (txRes.status === 'SUCCESS') {
        return { ok: true, txHash: hash, explorerUrl: explorerUrl(hash), status: 'SUCCESS' };
      }
      if (txRes.status === 'FAILED') {
        const errName = txRes.resultXdr
          ? xdr.TransactionResult.fromXDR(txRes.resultXdr, 'base64').result().switch().name
          : 'FAILED';
        return { ok: false, txHash: hash, explorerUrl: explorerUrl(hash), status: 'FAILED', error: errName };
      }
    }
    // Timeout — return PENDING with hash (still valid, just slow)
    return { ok: true, txHash: hash, explorerUrl: explorerUrl(hash), status: 'PENDING' };
  }

  if (sent.status === 'SUCCESS') {
    return { ok: true, txHash: sent.hash, explorerUrl: explorerUrl(sent.hash), status: 'SUCCESS' };
  }

  return { ok: false, status: sent.status || 'ERROR', error: sent.errorResultXdr || sent };
}

function explorerUrl(hash) {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

// ─── Sybil check: verify Stellar Pubnet address ───────────────
export async function checkStellarAddress(address) {
  if (!isValidStellarAddress(address)) {
    return { valid: false, reason: 'Invalid Stellar address format' };
  }
  try {
    const res = await fetch(`https://horizon.stellar.org/accounts/${address}`);
    if (res.status === 404) return { valid: false, reason: 'Address not found on Stellar Pubnet' };
    const account = await res.json();

    // Check age via first operation
    const opsRes = await fetch(
      `https://horizon.stellar.org/accounts/${address}/operations?order=asc&limit=1`
    );
    const ops = await opsRes.json();
    const createdAt = ops.records?.[0]?.created_at;
    if (!createdAt) return { valid: false, reason: 'No account activity found' };

    const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) {
      return { valid: false, reason: `Account too new (${Math.floor(ageDays)} days). Minimum 7 days required.` };
    }

    const xlmBalance = account.balances?.find(b => b.asset_type === 'native');
    if (!xlmBalance || parseFloat(xlmBalance.balance) < 0.5) {
      return { valid: false, reason: 'Account must have at least 0.5 XLM balance' };
    }

    return { valid: true, ageDays: Math.floor(ageDays), xlmBalance: xlmBalance.balance };
  } catch (err) {
    return { valid: false, reason: 'Horizon check failed: ' + err.message };
  }
}

export function isValidStellarAddress(address) {
  if (typeof address !== 'string' || !address.startsWith('G') || address.length !== 56) return false;
  try {
    // basic base32 check
    return /^G[A-Z2-7]{55}$/.test(address);
  } catch { return false; }
}

export function isValidEVMAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}
