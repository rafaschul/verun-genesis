// ─── POST /api/verify ─────────────────────────────────────────
// Verifies a claim certificate signature
// Also handles: GET /api/verify?claim_id=vga-0001
import { verifyCertificate } from '../lib/certificate.js';
import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: lookup by claim_id
  if (req.method === 'GET') {
    const { claim_id } = req.query;
    if (!claim_id) return res.status(400).json({ error: 'claim_id required' });

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('claim_id', claim_id.toLowerCase())
        .single();

      if (error || !data) {
        return res.status(404).json({ valid: false, error: 'Claim ID not found' });
      }

      return res.status(200).json({
        valid:        true,
        claim_id:     data.claim_id,
        claim_number: data.claim_number,
        address:      data.address,
        score:        data.score,
        tier:         data.tier,
        status:       data.status,
        anchor: data.stellar_tx ? {
          tx_hash:      data.stellar_tx,
          explorer_url: data.explorer_url,
        } : null,
        issued_at:   data.created_at,
        verify_url:  `https://verun.network/verify?claim_id=${data.claim_id}`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // POST: verify certificate signature
  if (req.method === 'POST') {
    const certificate = req.body;
    if (!certificate || !certificate.signature) {
      return res.status(400).json({ error: 'Certificate with signature required' });
    }
    try {
      const valid = verifyCertificate(certificate);
      return res.status(200).json({
        valid,
        claim_id:  certificate.claim_id,
        address:   certificate.identity?.address,
        score:     certificate.score?.founding_score,
        message:   valid ? 'Certificate signature valid' : 'Certificate signature INVALID',
      });
    } catch (err) {
      return res.status(400).json({ valid: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
