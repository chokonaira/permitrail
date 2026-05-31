import assert from 'node:assert/strict';
import test from 'node:test';

import { ProofrailGateway, createProofrailMcpTools } from '../src/index.ts';
import { LocalApprovalProvider } from '@proofrail/provider-local';
import { createProofrailKeyPair } from '@proofrail/core';
import type { ProofrailPolicy } from '@proofrail/core';

const policy = {
  version: 'proofrail.policy.v1',
  id: 'gateway-test',
  tools: {
    'database.delete_rows': {
      id: 'delete-requires-approval',
      require: {
        claim: 'admin.approved_action',
        value: true,
        assurance: ['human_approved'],
        bindActionInputHash: true,
      },
    },
  },
} satisfies ProofrailPolicy;

async function buildGateway() {
  const provider = await LocalApprovalProvider.create();
  const receiptKeyPair = await createProofrailKeyPair({ kid: 'gateway-test-receipts' });
  const gateway = new ProofrailGateway({
    policy,
    provider,
    trustedProofKeys: [provider.publicKeyPem],
    receiptKeyPair,
  });
  return { provider, gateway };
}

test('gateway requires a receipt key pair', () => {
  // @ts-expect-error receiptKeyPair is required
  assert.throws(() => new ProofrailGateway({ policy }), /receiptKeyPair/);
});

test('gateway returns proof challenge when tool call is not authorized yet', async () => {
  const { gateway } = await buildGateway();

  const decision = await gateway.authorize({
    tool: 'database.delete_rows',
    audience: 'db-agent',
    subject: 'admin_1',
    purpose: 'Delete expired sandbox rows',
    input: { table: 'sandbox_events', where: { expired: true } },
  });

  assert.equal(decision.outcome, 'require_proof');
  if (decision.outcome !== 'require_proof' || !decision.challenge) {
    throw new Error('Expected proof challenge');
  }
  assert.ok(decision.challenge.id);
});

test('gateway executes a tool only after a bound proof and writes a receipt', async () => {
  const { provider, gateway } = await buildGateway();
  const action = {
    tool: 'database.delete_rows',
    audience: 'db-agent',
    subject: 'admin_1',
    purpose: 'Delete expired sandbox rows',
    input: { table: 'sandbox_events', where: { expired: true } },
  };

  const pending = await gateway.authorize(action);
  if (pending.outcome !== 'require_proof' || !pending.challenge) {
    throw new Error('Expected proof challenge');
  }

  const proofEnvelope = await provider.approve(pending.challenge.id, { approvedBy: 'admin_1' });

  let ran = false;
  const result = await gateway.execute(
    action,
    () => {
      ran = true;
      return { deleted: 3 };
    },
    { proofEnvelope },
  );

  assert.equal(result.ok, true);
  assert.equal(ran, true);
  assert.equal(result.receipt.payload.decision, 'allowed');
  assert.ok(result.receipt.payload.inputHash);
});

test('mcp tools authorize calls and expose challenge status', async () => {
  const { provider, gateway } = await buildGateway();
  const mcp = createProofrailMcpTools({ gateway, provider });

  const decision = await mcp.callTool('proofrail_authorize_tool_call', {
    action: {
      tool: 'database.delete_rows',
      audience: 'db-agent',
      subject: 'admin_1',
      purpose: 'Delete expired sandbox rows',
      input: { table: 'sandbox_events', where: { expired: true } },
    },
  });

  assert.equal(typeof decision, 'object');
  assert.ok(decision);
  const authorization = decision as Awaited<ReturnType<ProofrailGateway['authorize']>>;
  assert.equal(authorization.outcome, 'require_proof');
  if (authorization.outcome !== 'require_proof' || !authorization.challenge) {
    throw new Error('Expected proof challenge');
  }

  const challenge = await mcp.callTool('proofrail_get_challenge', {
    challengeId: authorization.challenge.id,
  });

  assert.equal(typeof challenge, 'object');
  assert.ok(challenge);
  assert.equal((challenge as { status: string }).status, 'pending');
});
