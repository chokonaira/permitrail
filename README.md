# Proofrail

[![CI](https://github.com/chokonaira/proofrail/actions/workflows/test.yml/badge.svg)](https://github.com/chokonaira/proofrail/actions/workflows/test.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![dependencies](https://img.shields.io/badge/runtime%20dependencies-0-2ea043.svg)](package.json)

**Authorization, proof, and audit for what AI agents actually do.**

Agents now send mail, move money, open pull requests, and delete data. The hard
question is no longer "can the model call the tool." It is "was this exact action
allowed, by whom, for what, and can you prove it afterward."

Proofrail sits in front of those actions. Policy decides, an approver signs off on
the exact action, a short-lived signed proof is issued, the tool runs once, and a
signed receipt lands in your audit log.

```txt
agent ──▶ authorize ──▶ approve ──▶ execute ──▶ seal
            policy        proof       tool       signed receipt
```

[Live sandbox](https://chokonaira.github.io/proofrail/) · [Policy model](docs/policy.md) · [MCP server](docs/mcp.md) · [Threat model](docs/threat-model.md) · [Protocol schema](spec/proofrail.schema.json)

## What it gives you

- Per-tool policy: allow, deny, or require approval.
- Proofs bound to the exact subject, audience, purpose, and input hash. A proof
  for one recipient or amount does not work for another.
- Single-use proofs. A still-valid proof cannot be replayed against the same
  action before it expires.
- A signed, verifiable receipt for every action, allowed or denied.
- Pluggable approval providers. The same policy works whether approval comes from
  a passkey, an email link, Slack, or a webhook.
- Multi-agent chains: correlate a sequence of agent handoffs into one signed,
  tamper-evident trail.
- Zero runtime dependencies. The same code runs on Node, browsers, Deno, Bun, and
  edge runtimes (Ed25519 and SHA-256 over the Web Crypto API).

## Install

```bash
npm install @proofrail/core @proofrail/mcp-gateway @proofrail/provider-local
```

```ts
import { createProofrailKeyPair } from '@proofrail/core';
import type { AgentAction, ProofrailPolicy } from '@proofrail/core';
import { LocalApprovalProvider } from '@proofrail/provider-local';
import { ProofrailGateway } from '@proofrail/mcp-gateway';

const policy = {
  version: 'proofrail.policy.v1',
  id: 'agent-policy',
  defaults: { unconfiguredTool: 'deny' },
  tools: {
    'email.send': {
      require: {
        claim: 'human.approved_action',
        value: true,
        assurance: ['human_approved'],
        maxAgeSeconds: 300,
        bindActionInputHash: true,
      },
    },
  },
} satisfies ProofrailPolicy;

const provider = await LocalApprovalProvider.create();
const gateway = new ProofrailGateway({
  policy,
  provider,
  trustedProofKeys: [provider.publicKeyPem],
  // Generate once and persist it. Receipts stay verifiable across restarts.
  receiptKeyPair: await createProofrailKeyPair(),
});

const action = {
  tool: 'email.send',
  audience: 'sales-agent',
  subject: 'user_123',
  purpose: 'Send invoice INV-123 to client@example.com',
  input: { to: 'client@example.com', subject: 'Invoice INV-123' },
} satisfies AgentAction;

const decision = await gateway.authorize(action);

if (decision.outcome === 'require_proof' && decision.challenge) {
  // In production a real provider channel approves out of band.
  const proof = await provider.approve(decision.challenge.id);
  const result = await gateway.execute(action, sendEmail, { proofEnvelope: proof });
  console.log(result.ok, result.receipt.payload.id);
}
```

## Run it as an MCP server

Proofrail ships a runnable, dependency-free MCP server. Point any MCP client at it
and route sensitive tool calls through Proofrail first.

```bash
npx @proofrail/mcp
```

```json
{
  "mcpServers": {
    "proofrail": { "command": "npx", "args": ["-y", "@proofrail/mcp"] }
  }
}
```

Set `PROOFRAIL_POLICY` to a policy JSON file and `PROOFRAIL_RECEIPT_KEY` to a
persisted key file for production. The server exposes:

- `proofrail_authorize_tool_call`
- `proofrail_get_challenge`
- `proofrail_verify_proof`
- `proofrail_write_receipt`

See [docs/mcp.md](docs/mcp.md).

## Try it locally

Requires Node 22.6 or newer (it runs TypeScript directly for development).

```bash
git clone https://github.com/chokonaira/proofrail.git
cd proofrail
npm install
npm run check   # typecheck, tests, and the demo
npm run demo    # block a payment, approve an email, then watch a replay get refused
```

The sandbox is a static page. Build it and serve `site/` with any static server:

```bash
npm run build:sandbox
npx http-server site
```

## How a proof stays safe

| Attack | What stops it |
| --- | --- |
| Prompt injection telling the agent to act | Risky tools need a proof; the approver sees the exact purpose and input |
| Replaying an approval for a different amount or recipient | The proof is bound to a hash of the exact input |
| Reusing a valid proof a second time | Proofs are single-use; the gateway consumes them before the tool runs |
| One agent using another agent's proof | The proof is bound to an `audience`; verification rejects the wrong holder |
| Tampering with the audit trail | Receipts are Ed25519 signed and verify independently |

Details and scope are in [docs/threat-model.md](docs/threat-model.md).

## Multi-agent chains

Set `chainId` on each action and `parentId` to the upstream step's receipt id.
Every step is authorized independently and its receipt carries the chain context,
so the whole handoff sequence reconstructs into one signed, tamper-evident trail.
Because each proof is bound to its `audience`, one agent cannot wield another
agent's approval.

## Approval providers

A provider answers an approval request and signs a proof. The local provider is
included for demos and internal tools. The same policy and proof format work for:

- passkeys and WebAuthn
- email one-time codes or magic links
- Slack or Teams approvals
- GitHub review approvals
- OAuth account control (Google, Microsoft, Okta)
- identity verification (for example Persona or Stripe Identity)
- any custom HTTP webhook

Swapping providers never changes your policy logic.

## Other languages

The protocol is portable. Policies, proofs, and receipts are JSON; signatures are
Ed25519; input binding is canonical JSON plus SHA-256. Any stack can verify a
proof or receipt from [spec/proofrail.schema.json](spec/proofrail.schema.json).

## Packages

| Package | What it is |
| --- | --- |
| `@proofrail/core` | Protocol primitives: policy, proofs, receipts, Web Crypto signing |
| `@proofrail/mcp-gateway` | The enforcement gateway, replay guard, audit sink, MCP tool definitions |
| `@proofrail/provider-local` | Local approval provider for demos and internal tools |
| `@proofrail/mcp` | Runnable stdio MCP server |

## Contributing

Issues and pull requests are welcome. Run `npm run check` before opening a PR. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
