import type { ProofrailPolicy } from '@proofrail/core';

export const policy = {
  version: 'proofrail.policy.v1',
  id: 'restricted-action-demo',
  defaults: {
    unconfiguredTool: 'deny',
  },
  tools: {
    'email.send': {
      id: 'email-send-human-approval',
      risk: 'medium',
      reason: 'External email can leak private data or trigger irreversible business actions.',
      require: {
        claim: 'human.approved_action',
        value: true,
        assurance: ['human_approved'],
        maxAgeSeconds: 5 * 60,
        bindActionInputHash: true,
      },
    },
    'payments.create_transfer': {
      id: 'payment-human-approval',
      risk: 'high',
      reason: 'Payments require explicit human approval for the exact amount and recipient.',
      require: {
        claim: 'human.approved_spend',
        value: true,
        assurance: ['human_approved'],
        maxAgeSeconds: 2 * 60,
        bindActionInputHash: true,
      },
    },
    'calendar.read': {
      id: 'calendar-read-low-risk',
      mode: 'allow',
      risk: 'low',
      reason: 'Read-only calendar access is allowed in this demo policy.',
    },
  },
} satisfies ProofrailPolicy;
