import assert from 'node:assert/strict';
import test from 'node:test';

import { createPermitRailKeyPair, verifyProof } from '@permitrail/core';
import type { PermitRailPolicy } from '@permitrail/core';
import { PermitRailGateway, InMemoryAuditLog } from '@permitrail/mcp-gateway';
import { WebhookApprovalProvider } from '../src/index.ts';
import type { WebhookTransport } from '../src/index.ts';

const policy = {
  version: 'permitrail.policy.v1',
  id: 'webhook-test',
  defaults: { unconfiguredTool: 'deny' },
  tools: {
    'email.send': {
      id: 'email-send',
      require: {
        claim: 'human.approved_action',
        value: true,
        assurance: ['human_approved'],
        bindActionInputHash: true,
      },
    },
  },
} satisfies PermitRailPolicy;

const action = {
  tool: 'email.send',
  audience: 'sales-agent',
  subject: 'user_1',
  purpose: 'Send invoice INV-1',
  input: { to: 'client@example.com' },
};

const approves: WebhookTransport = async () => ({ approved: true, approvedBy: 'risk-engine' });
const denies: WebhookTransport = async () => ({ approved: false, reason: 'flagged by risk engine' });

test('webhook provider signs a usable proof when the endpoint approves', async () => {
  const provider = await WebhookApprovalProvider.create({ endpoint: 'https://approve.example', transport: approves });
  const challenge = await provider.requestProof({
    claim: 'human.approved_action',
    subject: 'user_1',
    audience: 'sales-agent',
    purpose: 'Send invoice INV-1',
  });

  assert.equal(challenge.status, 'approved');
  assert.ok(challenge.proofEnvelope);
  const payload = await verifyProof(challenge.proofEnvelope, {
    publicKeyPem: provider.publicKeyPem,
    audience: 'sales-agent',
    subject: 'user_1',
    purpose: 'Send invoice INV-1',
  });
  assert.equal(payload.claim, 'human.approved_action');
  assert.equal(payload.metadata?.approvedBy, 'risk-engine');
});

test('webhook provider records a denial when the endpoint rejects', async () => {
  const provider = await WebhookApprovalProvider.create({ endpoint: 'https://approve.example', transport: denies });
  const challenge = await provider.requestProof({
    claim: 'human.approved_action',
    subject: 'user_1',
    audience: 'sales-agent',
    purpose: 'Send invoice INV-1',
  });

  assert.equal(challenge.status, 'denied');
  assert.equal(challenge.proofEnvelope, undefined);
  assert.match(challenge.denialReason ?? '', /risk engine/);
});

test('the same gateway and policy work end to end with the webhook provider', async () => {
  const provider = await WebhookApprovalProvider.create({ endpoint: 'https://approve.example', transport: approves });
  const receiptKeyPair = await createPermitRailKeyPair({ kid: 'webhook-test-receipts' });
  const auditLog = new InMemoryAuditLog();
  const gateway = new PermitRailGateway({
    policy,
    provider,
    trustedProofKeys: [provider.publicKeyPem],
    receiptKeyPair,
    auditSink: auditLog,
  });

  const decision = await gateway.authorize(action);
  if (decision.outcome !== 'require_proof' || !decision.challenge?.proofEnvelope) {
    throw new Error('Expected the webhook challenge to resolve with a proof');
  }

  const result = await gateway.execute(action, () => ({ delivered: true }), {
    proofEnvelope: decision.challenge.proofEnvelope,
  });

  assert.equal(result.ok, true);
  assert.equal(result.receipt.payload.decision, 'allowed');
  assert.equal(auditLog.receipts.length, 1);
});
