# Production Guide

PermitRail is a proof and audit layer for AI agent tool calls. It is designed to
sit beside your normal application authorization, not replace it.

## What Is Production-Ready

The core security path is ready for production integration when deployed with the
right operator controls:

- Ed25519 signed proofs and receipts through Web Crypto
- protected headers included in the signed payload
- default-deny policy
- proof binding to `audience`, `subject`, `purpose`, and claim
- optional binding to the exact action input hash
- proof expiration and max-age checks
- future-dated proof rejection
- single-use proof consumption
- MCP authorize-only flows consume proofs so they cannot be replayed later
- webhook approval responses must explicitly return `approved: true`
- webhook assurance is controlled by provider configuration, not the endpoint
- MCP stdout is reserved for JSON-RPC responses; status logs go to stderr

The test suite covers tampered proofs, expired proofs, future-dated proofs,
wrong tool proofs, wrong input proofs, no-input binding, replayed proofs, MCP
single-use behavior, webhook denial behavior, malformed webhook responses, and
receipt verification.

## What You Must Configure

For a real deployment:

- Generate provider signing keys and store private keys in a secret manager.
- Generate a receipt signing key once and persist it. Do not use a new receipt
  key on every restart.
- Configure `trustedProofKeys` explicitly. Never trust arbitrary proof keys from
  the caller.
- Store receipts in a durable `AuditSink`.
- Use a shared `ReplayGuard` for multi-instance deployments. The built-in
  `InMemoryReplayGuard` is only single-process.
- Use a production approval channel: passkey, Slack, Teams, email magic link,
  internal approval service, risk engine, or the webhook provider with your own
  authenticated endpoint.
- Treat webhook bearer tokens, HMAC secrets, Slack tokens, and similar approval
  channel credentials as your own infrastructure secrets. They are not issued by
  PermitRail and are not required for the local MCP server unless your chosen
  provider/channel needs them.
- Redact secrets and sensitive personal data before putting action input into
  policies, receipts, logs, or approval screens.
- Keep normal application authorization in place after PermitRail allows an
  action. PermitRail proves approval; your app still owns business rules.

## Package Choices

You do not need every package for every project.

| Use case | Packages |
| --- | --- |
| App-embedded gateway with your own approval service | `@permitrail/core`, `@permitrail/mcp-gateway`, `@permitrail/provider-webhook` |
| Local demo or internal prototype | `@permitrail/core`, `@permitrail/mcp-gateway`, `@permitrail/provider-local` |
| MCP client integration | `@permitrail/mcp` |
| Independent proof or receipt verification | `@permitrail/core` |
| Custom provider | `@permitrail/core` plus your own `ProofProvider` implementation |

## Current Limits

PermitRail v0.1.0 is an open-source package release, not a hosted approval
platform.

- It does not ship a managed dashboard.
- It does not store audit logs for you.
- It does not provide a Redis replay guard implementation yet.
- It does not rotate keys automatically.
- It does not validate every downstream tool input.
- It does not guarantee that an approval provider is truthful after that
  provider is compromised.

Those are deployment and product boundaries, not hidden test gaps. The core
protocol is intentionally small so teams can inspect it and plug it into their
own systems.
