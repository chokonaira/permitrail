# @permitrail/provider-webhook

Webhook approval provider for PermitRail.

This package routes each approval request to an HTTP endpoint, treats that
endpoint as the approver trust boundary, and signs a PermitRail proof only when
the endpoint explicitly returns `approved: true`.

## Install

```bash
npm install @permitrail/provider-webhook
```

## Use

```ts
import { WebhookApprovalProvider } from '@permitrail/provider-webhook';

const provider = await WebhookApprovalProvider.create({
  endpoint: 'https://approvals.example.com/permitrail',
  headers: { authorization: `Bearer ${process.env.APPROVAL_TOKEN}` },
  timeoutMs: 10_000,
});
```

`APPROVAL_TOKEN` is your own secret for authenticating to your approval endpoint.
It is not issued by PermitRail, and it is not an npm token. If your endpoint uses
HMAC signatures, mTLS, a queue, or a private network instead of bearer auth,
inject a custom transport.

The default transport requires HTTPS, except for localhost development. You can
inject a custom transport to add request signing, queues, private networking, or
tests without a network call.

## Links

- Repository: https://github.com/chokonaira/permitrail
- Threat model: https://github.com/chokonaira/permitrail/blob/main/docs/threat-model.md
- Policy model: https://github.com/chokonaira/permitrail/blob/main/docs/policy.md

## License

Apache-2.0
