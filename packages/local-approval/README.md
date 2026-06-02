# @permitrail/local-approval

A localhost human-approval server and page for PermitRail agent tool calls.

PermitRail adds human approval to sensitive agent tool calls routed through
PermitRail. This package gives you the local approval surface: a risky tool call
pauses, a local web page shows the exact action, a human approves or denies, and
PermitRail signs the proof.

```ts
import { startLocalApproval } from '@permitrail/local-approval';
import { PermitRailGateway } from '@permitrail/mcp-gateway';
import { createPermitRailKeyPair } from '@permitrail/core';

const approval = await startLocalApproval({ port: 4677 });
const gateway = new PermitRailGateway({
  policy,
  provider: approval.provider,
  trustedProofKeys: [approval.publicKeyPem],
  receiptKeyPair: await createPermitRailKeyPair(),
});

const decision = await gateway.authorize(action);
if (decision.outcome === 'require_proof' && decision.challenge) {
  console.log(`Approve at ${approval.url}`);
  const proof = await approval.waitForProof(decision.challenge.id);
  await gateway.execute(action, runTool, { proofEnvelope: proof });
}
```

## Local only

This package is for demos, single-user dev, and internal tools. The approval page
has no auth, the challenge store is in memory, and the server binds to 127.0.0.1.
It is not multi-user production auth. For production, route approvals through your
own channel (the webhook provider today) and a durable store.

## License

Apache-2.0.
