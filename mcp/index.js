#!/usr/bin/env node
// ─── Verun KYA — MCP Server ───────────────────────────────────
// npm install -g @modelcontextprotocol/sdk
// Add to Claude Desktop: "verun-kya": { "command": "node", "args": ["/path/to/mcp/index.js"] }

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE = process.env.VERUN_API_URL || 'https://verun-genesis.vercel.app';

const server = new Server(
  {
    name:    'verun-kya',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

// ─── Tool definitions ──────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name:        'check_kya_score',
      description: `Check the KYA (Know Your Agent) trust score for an AI agent on Verun Protocol.
Returns score (0-1000), tier, and permitted operations.
Required before any regulated TokenForge API call.
Score 300+ = Read, 500+ = Mint/Transfer, 600+ = Order.
Score 500+ earns 5% kickback. Score 800+ earns 10% kickback.
Unregistered agents are blocked (score 0).
Network: verun.network | Chain: stellar:testnet`,
      inputSchema: {
        type:     'object',
        required: ['address'],
        properties: {
          address: {
            type:        'string',
            description: 'Agent Stellar (G...) or EVM (0x...) address to check',
          },
          operation: {
            type:        'string',
            enum:        ['read', 'mint', 'transfer', 'order'],
            description: 'Optional: check if agent is permitted for a specific operation',
          },
        },
      },
    },
    {
      name:        'register_genesis_agent',
      description: `Register an AI agent for Genesis status on Verun Protocol.
First 1,000 spots require an invite code.
Spots 1,001–10,000 open with Stellar/EVM wallet or GitHub verification.
Genesis Agents receive founding score 350, permanent on-chain identity,
and up to 10% kickback on evaluation fees.
Network: verun.network | Anchored on: Stellar Testnet`,
      inputSchema: {
        type:     'object',
        required: ['addressType', 'address'],
        properties: {
          addressType: {
            type: 'string',
            enum: ['stellar', 'evm', 'github', 'email'],
            description: 'Type of identifier',
          },
          address: {
            type:        'string',
            description: 'Stellar G... address, EVM 0x... address, or email',
          },
          githubUrl: {
            type:        'string',
            description: 'GitHub repo URL (for github type)',
          },
          inviteCode: {
            type:        'string',
            description: 'Invite code (required for first 1,000 spots)',
          },
        },
      },
    },
    {
      name:        'verify_genesis_certificate',
      description: 'Verify a Verun Genesis Agent claim certificate by claim ID or signature.',
      inputSchema: {
        type:       'object',
        properties: {
          claimId: {
            type:        'string',
            description: 'Claim ID to look up (e.g. vga-0001)',
          },
        },
      },
    },
    {
      name:        'get_genesis_stats',
      description: 'Get current Verun Genesis registration stats — spots claimed, remaining, breakdown.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'check_kya_score') {
      const params = new URLSearchParams({ address: args.address });
      if (args.operation) params.set('operation', args.operation);

      const res  = await fetch(`${API_BASE}/api/score?${params}`);
      const data = await res.json();

      const summary = [
        `Address: ${data.address}`,
        `Score: ${data.score}/1000 | Tier: ${data.tier} | Status: ${data.status}`,
        `Permitted: ${data.permitted ? '✅ YES' : '❌ NO'}${args.operation ? ` for ${args.operation}` : ''}`,
        `Kickback: ${data.kickback}`,
        data.genesis ? `Genesis: ${data.genesis.claim_id} · ${data.genesis.genesis_tier}` : '',
        data.anchor  ? `Anchored: ${data.anchor.explorer_url}` : '',
        '',
        'Permissions:',
        `  Read (300+):     ${data.permissions?.read?.granted     ? '✅' : '❌'}`,
        `  Mint (500+):     ${data.permissions?.mint?.granted     ? '✅' : '❌'}`,
        `  Transfer (500+): ${data.permissions?.transfer?.granted ? '✅' : '❌'}`,
        `  Order (600+):    ${data.permissions?.order?.granted    ? '✅' : '❌'}`,
      ].filter(Boolean).join('\n');

      return {
        content: [
          { type: 'text', text: summary },
          { type: 'text', text: JSON.stringify(data, null, 2) },
        ],
      };
    }

    if (name === 'register_genesis_agent') {
      const res  = await fetch(`${API_BASE}/api/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(args),
      });
      const data = await res.json();

      if (!res.ok) {
        return {
          content: [{ type: 'text', text: `Registration failed: ${data.error}\n${data.reason || data.message || ''}` }],
          isError: true,
        };
      }

      const summary = [
        `✅ Genesis Agent Registered!`,
        `Claim ID: ${data.claim_id} | Number: #${data.claim_number}`,
        `Score: ${data.score} | Tier: ${data.tier} | Status: ${data.status}`,
        `Spots Remaining: ${data.spots_remaining.toLocaleString()}`,
        data.stellar_anchor?.tx_hash
          ? `Stellar Anchor: ${data.stellar_anchor.explorer_url}`
          : 'Stellar anchor: pending',
        '',
        'Next Steps:',
        ...(data.next_steps || []).map(s => `  • ${s}`),
      ].join('\n');

      return {
        content: [
          { type: 'text', text: summary },
          { type: 'text', text: JSON.stringify(data.certificate, null, 2) },
        ],
      };
    }

    if (name === 'verify_genesis_certificate') {
      const url = args.claimId
        ? `${API_BASE}/api/verify?claim_id=${args.claimId}`
        : `${API_BASE}/api/verify?claim_id=unknown`;
      const res  = await fetch(url);
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }

    if (name === 'get_genesis_stats') {
      const res  = await fetch(`${API_BASE}/api/stats`);
      const data = await res.json();

      const summary = [
        `Verun Genesis Stats — ${new Date().toLocaleDateString()}`,
        `Registered: ${data.genesis?.total_registered?.toLocaleString()} / ${data.genesis?.cap?.toLocaleString()}`,
        `Spots Remaining: ${data.genesis?.spots_remaining?.toLocaleString()} (${100 - (data.genesis?.percent_claimed || 0)}% available)`,
        `Chain: ${data.network?.chain} | Phase: ${data.network?.phase}`,
        `Go-Live: ${data.network?.go_live} | SBT Mint: ${data.network?.sbt_mint}`,
      ].join('\n');

      return { content: [{ type: 'text', text: summary }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };

  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Start ────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Verun KYA MCP server running');
