# Proofrail MCP server

`@proofrail/mcp` is a runnable, dependency-free MCP server. It speaks
newline-delimited JSON-RPC 2.0 over stdio and puts the Proofrail gateway in front
of agent tool calls, so any MCP client can authorize actions, collect approvals,
verify proofs, and write signed receipts.

## Run

```bash
npx @proofrail/mcp
```

## Connect a client

```json
{
  "mcpServers": {
    "proofrail": { "command": "npx", "args": ["-y", "@proofrail/mcp"] }
  }
}
```

## Configuration

The server reads two environment variables:

- `PROOFRAIL_POLICY`: path to a policy JSON file. Without it, a safe sample is used
  (read-only calendar allowed, email and payments require approval, everything
  else denied).
- `PROOFRAIL_RECEIPT_KEY`: path to a JSON key file in the shape returned by
  `createProofrailKeyPair`. Without it, an ephemeral development key is generated
  and a warning is printed; receipts will not verify across restarts.

## Tools

- `proofrail_authorize_tool_call(action, proofEnvelope?)` returns a decision:
  `allow`, `deny`, or `require_proof` with a challenge.
- `proofrail_get_challenge(challengeId)` returns the status of a challenge.
- `proofrail_verify_proof(proofEnvelope, publicKeyPem?)` verifies a signed proof.
- `proofrail_write_receipt(action, decision, ...)` returns a signed receipt.

The recommended loop:

```txt
agent
  -> proofrail_authorize_tool_call
  -> approval channel if the result is require_proof
  -> the sensitive tool only after Proofrail allows
  -> proofrail_write_receipt
```

## Embedding in an existing server

If you already run an MCP server, import the tool router instead of the binary:

```ts
import { createProofrailMcpTools } from '@proofrail/mcp-gateway';

const proofrail = createProofrailMcpTools({ gateway, provider });
for (const tool of proofrail.tools) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, (input) =>
    proofrail.callTool(tool.name, input),
  );
}
```

## Approval over MCP

Approval is the provider's job and usually happens out of band (passkey, email,
Slack, webhook). For local development the server also exposes
`proofrail_approve_challenge`, which stands in for a real approval channel. It is
labeled development only and should not be enabled in production.
