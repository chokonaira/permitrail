import { createPermitRailKeyPair } from '@permitrail/core';
import { PermitRailGateway } from '@permitrail/mcp-gateway';
import { startLocalApproval } from '@permitrail/local-approval';

const policy = {
  version: 'permitrail.policy.v1',
  id: 'local-approval-demo',
  defaults: { unconfiguredTool: 'deny' as const },
  tools: {
    'payments.create_transfer': {
      risk: 'high',
      require: {
        claim: 'human.approved_spend',
        value: true,
        assurance: ['human_approved' as const],
        bindActionInputHash: true,
      },
    },
  },
};

const approval = await startLocalApproval({ port: 4677 });
const gateway = new PermitRailGateway({
  policy,
  provider: approval.provider,
  trustedProofKeys: [approval.publicKeyPem],
  receiptKeyPair: await createPermitRailKeyPair({ kid: 'local-approval-demo' }),
});

const action = {
  tool: 'payments.create_transfer',
  audience: 'finance-agent',
  subject: 'user_henry',
  purpose: 'Transfer 5000 USD to acct_new_vendor',
  risk: 'high',
  input: { amount: 5000, currency: 'USD', recipient: 'acct_new_vendor' },
};

console.log('\nPermitRail local approval demo\n');
const decision = await gateway.authorize(action);
console.log('decision:', decision.outcome);
if (decision.outcome !== 'require_proof' || !decision.challenge) {
  throw new Error('Expected require_proof');
}

console.log('\nApprove or deny this action in your browser:');
console.log('   ' + approval.url + '\n');

const proof = await approval.waitForProof(decision.challenge.id);
const result = await gateway.execute(action, () => ({ submitted: true }), { proofEnvelope: proof });
console.log('executed once:', result.ok, 'receipt:', result.receipt.payload.id);

const replay = await gateway.execute(action, () => ({ submitted: true }), { proofEnvelope: proof });
console.log('replay refused:', replay.ok, '-', replay.receipt.payload.reason);

await approval.stop();
console.log('\nDone. The proof worked exactly once.\n');
process.exit(0);
