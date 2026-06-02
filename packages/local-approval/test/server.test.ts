import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalApprovalProvider } from '@permitrail/provider-local';
import { startApprovalServer } from '../src/server.ts';

async function setup() {
  const provider = await LocalApprovalProvider.create();
  const server = await startApprovalServer({ provider, host: '127.0.0.1', port: 0 });
  return { provider, server, base: server.url };
}

test('pending lists a challenge, approve signs it', async () => {
  const { provider, server, base } = await setup();
  try {
    const challenge = await provider.requestProof({
      claim: 'human.approved_action',
      subject: 'user_1',
      audience: 'agent',
      purpose: 'Send invoice',
      action: {
        tool: 'email.send',
        audience: 'agent',
        subject: 'user_1',
        purpose: 'Send invoice',
        input: { to: 'a@b.com' },
      },
    });

    const pending = await (await fetch(base + '/api/pending')).json();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].tool, 'email.send');

    const res = await fetch(base + '/api/approve/' + challenge.id, { method: 'POST' });
    assert.equal((await res.json()).ok, true);

    const status = await (await fetch(base + '/api/challenge/' + challenge.id)).json();
    assert.equal(status.status, 'approved');
  } finally {
    await server.stop();
  }
});

test('serves the approval page at /', async () => {
  const { server, base } = await setup();
  try {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /PermitRail local approval/);
  } finally {
    await server.stop();
  }
});
