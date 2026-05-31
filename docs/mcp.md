# PermitRail MCP server

`@permitrail/mcp` is a runnable, dependency-free MCP server. It speaks
newline-delimited JSON-RPC 2.0 over stdio and puts the PermitRail gateway in front
of agent tool calls, so any MCP client can authorize actions, collect approvals,
and verify proofs.

## Run

```bash
npx @permitrail/mcp
```

## Connect a client

```json
{
  "mcpServers": {
    "permitrail": { "command": "npx", "args": ["-y", "@permitrail/mcp"] }
  }
}
```

## Configuration

The server reads two environment variables:

- `PERMITRAIL_POLICY`: path to a policy JSON file. Without it, a safe sample is used
  (read-only calendar allowed, email and payments require approval, everything
  else denied).
- `PERMITRAIL_RECEIPT_KEY`: path to a JSON key file in the shape returned by
  `createPermitRailKeyPair`. Without it, an ephemeral development key is generated
  and a warning is printed; receipts will not verify across restarts.

## Tools

- `permitrail_authorize_tool_call(action, proofEnvelope?)` returns a decision:
  `allow`, `deny`, or `require_proof` with a challenge. When a proof allows an
  action, the MCP path consumes that proof so it cannot be replayed.
- `permitrail_get_challenge(challengeId)` returns the status of a challenge.
- `permitrail_verify_proof(proofEnvelope, publicKeyPem?)` verifies a signed proof.

The recommended loop:

```txt
agent
  -> permitrail_authorize_tool_call
  -> approval channel if the result is require_proof
  -> permitrail_authorize_tool_call again with the signed proof
  -> the sensitive tool only after PermitRail allows and consumes the proof
```

Signed receipts are produced by the embedded gateway `execute()` path. The
runnable MCP server does not expose a public receipt-signing tool because that
would let an untrusted MCP client mint arbitrary audit receipts.

## Embedding in an existing server

If you already run an MCP server, import the tool router instead of the binary:

```ts
import { createPermitRailMcpTools } from '@permitrail/mcp-gateway';

const permitrail = createPermitRailMcpTools({ gateway, provider });
for (const tool of permitrail.tools) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, (input) =>
    permitrail.callTool(tool.name, input),
  );
}
```

## Approval over MCP

Approval is the provider's job and usually happens out of band (passkey, email,
Slack, webhook). For local development the server also exposes
`permitrail_approve_challenge`, which stands in for a real approval channel. It is
labeled development only and should not be enabled in production.
