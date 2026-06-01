import { createPermitRailKeyPair } from '@permitrail/core';
import { PermitRailGateway, InMemoryAuditLog, createPermitRailMcpTools } from '@permitrail/mcp-gateway';
import { LocalApprovalProvider } from '@permitrail/provider-local';

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));

const policy = {
  version: 'permitrail.policy.v1',
  id: 'sandbox',
  defaults: { unconfiguredTool: 'deny' },
  tools: {
    'email.send': {
      id: 'email-send',
      risk: 'medium',
      require: {
        claim: 'human.approved_action',
        value: true,
        assurance: ['human_approved'],
        maxAgeSeconds: 300,
        bindActionInputHash: true,
      },
    },
    'payments.create_transfer': {
      id: 'payments-transfer',
      risk: 'high',
      require: {
        claim: 'human.approved_spend',
        value: true,
        assurance: ['human_approved'],
        maxAgeSeconds: 120,
        bindActionInputHash: true,
      },
    },
    'database.delete_rows': {
      id: 'delete-rows',
      risk: 'high',
      require: {
        claim: 'admin.approved_action',
        value: true,
        assurance: ['human_approved'],
        bindActionInputHash: true,
      },
    },
  },
};

const ICONS = {
  email: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  payment: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>',
  delete: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>',
  custom: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
};

const scenarios = {
  email: {
    glyph: ICONS.email,
    title: 'Approve a customer invoice email',
    sub: 'Medium risk · external message',
    summary: 'The sales agent wants to email invoice INV-123 to an existing customer.',
    recommendation: 'approve if the recipient and invoice match',
    recommendedDecision: 'approve',
    approveLabel: 'Approve invoice email',
    denyLabel: 'Deny email send',
    action: {
      tool: 'email.send',
      audience: 'sales-agent',
      subject: 'user_henry',
      purpose: 'Send invoice INV-123 to client@example.com',
      risk: 'medium',
      chainId: 'chain_sandbox',
      input: { to: 'client@example.com', subject: 'Invoice INV-123', attachment: 'inv-123.pdf' },
    },
  },
  payment: {
    glyph: ICONS.payment,
    title: 'Reject a suspicious payment request',
    sub: 'High risk · money movement',
    summary: 'An untrusted email tells the finance agent to send 5,000 USD to a new account.',
    recommendation: 'deny because the recipient is not verified',
    recommendedDecision: 'deny',
    approveLabel: 'Approve transfer anyway',
    denyLabel: 'Deny suspicious transfer',
    action: {
      tool: 'payments.create_transfer',
      audience: 'finance-agent',
      subject: 'user_henry',
      purpose: 'Transfer 5,000 USD to acct_new_vendor from an untrusted email',
      risk: 'high',
      chainId: 'chain_sandbox',
      input: { amount: 5000, currency: 'USD', recipient: 'acct_new_vendor', source: 'untrusted_email' },
    },
  },
  delete: {
    glyph: ICONS.delete,
    title: 'Approve a production cleanup',
    sub: 'High risk · database mutation',
    summary: 'An ops agent wants to delete expired rows after an admin reviewed the exact filter.',
    recommendation: 'approve only after checking the table and filter',
    recommendedDecision: 'approve',
    approveLabel: 'Approve cleanup',
    denyLabel: 'Deny deletion',
    action: {
      tool: 'database.delete_rows',
      audience: 'db-agent',
      subject: 'admin_1',
      purpose: 'Delete 1,204 expired rows from the events table',
      risk: 'high',
      chainId: 'chain_sandbox',
      input: { table: 'events', where: { expired: true } },
    },
  },
  custom: {
    glyph: ICONS.custom,
    title: 'Write your own tool call',
    sub: 'Test any action against the policy',
    summary: 'Edit the JSON and run it. Tools that are not in the policy are denied by default.',
    recommendation: 'your call',
    recommendedDecision: 'approve',
    approveLabel: 'Approve and sign proof',
    denyLabel: 'Deny and seal receipt',
    action: {
      tool: 'payments.create_transfer',
      audience: 'my-agent',
      subject: 'user_123',
      purpose: 'Describe exactly what this action does',
      risk: 'high',
      input: { amount: 250, currency: 'USD', recipient: 'acct_demo' },
    },
  },
};

const toolResults = {
  'email.send': { simulated: true, delivered: true, messageId: 'msg_8f21c' },
  'payments.create_transfer': { simulated: true, transferId: 'txn_sandbox_only', status: 'would_submit' },
  'database.delete_rows': { simulated: true, deleted: 1204 },
};

let gateway;
let provider;
let mcp;
let current = null;
let challenge = null;
let proof = null;
let tamperedProof = null;
let tampered = false;
let editedAction = null;

async function init() {
  provider = await LocalApprovalProvider.create();
  const receiptKeyPair = await createPermitRailKeyPair({ kid: 'sandbox-receipts' });
  gateway = new PermitRailGateway({
    policy,
    provider,
    trustedProofKeys: [provider.publicKeyPem],
    receiptKeyPair,
    auditSink: new InMemoryAuditLog(),
  });
  mcp = createPermitRailMcpTools({ gateway, provider });

  $('engineDot').classList.add('ready');
  $('engineState').textContent = 'signing engine ready';
  renderScenarios();
}

function activeAction() {
  return editedAction ?? scenarios[current].action;
}

function renderScenarios() {
  const host = $('scenarios');
  host.innerHTML = '';
  let firstButton = null;
  for (const [key, scn] of Object.entries(scenarios)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scn';
    btn.setAttribute('aria-selected', 'false');
    btn.dataset.key = key;
    btn.innerHTML =
      `<span class="glyph">${scn.glyph}</span>` +
      `<span class="scn-copy"><span class="scn-title">${scn.title}</span><span class="scn-sub">${scn.sub}</span></span>` +
      `<span class="scn-decision" data-decision="${scn.recommendedDecision}">${scn.recommendedDecision}</span>`;
    btn.addEventListener('click', () => selectScenario(key, btn));
    host.appendChild(btn);
    firstButton ??= btn;
  }
  if (firstButton) selectScenario('email', firstButton);
}

function selectScenario(key, btn) {
  current = key;
  challenge = null;
  proof = null;
  tampered = false;
  editedAction = key === 'custom' ? clone(scenarios.custom.action) : null;

  for (const el of document.querySelectorAll('.scn')) el.setAttribute('aria-selected', 'false');
  btn.setAttribute('aria-selected', 'true');

  renderActionCard();
  resetState();

  if (key === 'custom') openEditor();
  else closeEditor();
}

function renderActionCard() {
  const scn = scenarios[current];
  const action = activeAction();
  $('acTool').textContent = action.tool || '-';
  const risk = $('acRisk');
  risk.textContent = action.risk || 'n/a';
  risk.dataset.risk = action.risk || '';
  $('acSummary').textContent = scn.summary;
  $('acRecommendation').textContent = scn.recommendation;
  $('acPurpose').textContent = action.purpose || '';
  showJson($('acInput'), action.input ?? {});
  $('inputDetails').open = !isSmallScreen();
  $('approveBtn').textContent = scn.approveLabel;
  $('denyBtn').textContent = scn.denyLabel;
  $('approveBtn').dataset.recommended = scn.recommendedDecision === 'approve' ? 'true' : 'false';
  $('denyBtn').dataset.recommended = scn.recommendedDecision === 'deny' ? 'true' : 'false';
}

function resetState() {
  resetRail();
  setVerdict('idle', 'ready');
  setMcp(null);
  note('readoutHint', 'run the check to begin');
  showJson($('output'), 'Run the check to see whether this action needs approval.', true);
  const run = $('runBtn');
  run.disabled = false;
  run.textContent = 'Check this action';
  hide('approveActions');
  hide('executeActions');
  hide('verifyBox');
  $('executeBtn').removeAttribute('hidden');
  hide('replayBtn');
}

/* ---- editor ---- */

function openEditor() {
  $('actionEditor').value = JSON.stringify(activeAction(), null, 2);
  hide('editorError');
  hide('actionView');
  show('editor');
  $('editToggle').textContent = 'close';
}

function closeEditor() {
  hide('editor');
  show('actionView');
  $('editToggle').textContent = 'edit';
}

function toggleEditor() {
  if ($('editor').hasAttribute('hidden')) openEditor();
  else closeEditor();
}

function applyEdit() {
  let parsed;
  try {
    parsed = JSON.parse($('actionEditor').value);
  } catch (error) {
    showEditorError(`Invalid JSON: ${error.message}`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    showEditorError('The action must be a JSON object.');
    return;
  }
  if (!parsed.tool || !parsed.audience || !parsed.subject || !parsed.purpose) {
    showEditorError('Include at least tool, audience, subject, and purpose.');
    return;
  }
  editedAction = parsed;
  renderActionCard();
  closeEditor();
  resetState();
}

function showEditorError(message) {
  const el = $('editorError');
  el.textContent = message;
  el.removeAttribute('hidden');
}

/* ---- flow ---- */

async function run() {
  if (!current) return;
  const action = activeAction();
  $('runBtn').disabled = true;
  setStage('authorize', 'active');
  setMcp('permitrail_authorize_tool_call');

  let decision;
  try {
    decision = await mcp.callTool('permitrail_authorize_tool_call', { action });
  } catch (error) {
    setStage('authorize', 'blocked');
    setVerdict('deny', 'error');
    showJson($('output'), { error: String(error.message || error) });
    $('runBtn').disabled = false;
    return;
  }

  setVerdict(decision.outcome, decision.outcome.replace('_', ' '));

  if (decision.outcome === 'require_proof' && decision.challenge) {
    challenge = decision.challenge;
    setStage('authorize', 'done');
    setStage('approve', 'active');
    note('st-authorize', 'policy says this action needs approval');
    note('readoutHint', 'approve or reject it below');
    showJson($('output'), {
      tool: 'permitrail_authorize_tool_call',
      decision: decision.outcome,
      reason: decision.reason,
      policyId: decision.policyId,
      challenge: challenge.id,
      requires: challenge.request.claim,
    });
    show('approveActions');
    focusStep('approve');
  } else if (decision.outcome === 'allow') {
    setStage('authorize', 'done');
    setStage('approve', 'done');
    setStage('execute', 'active');
    note('st-authorize', 'policy allows this tool with no approval');
    showJson($('output'), { tool: 'permitrail_authorize_tool_call', decision: decision.outcome, reason: decision.reason });
    show('executeActions');
    focusStep('execute');
  } else {
    setStage('authorize', 'blocked');
    note('st-authorize', 'policy denied this tool call');
    showJson($('output'), { tool: 'permitrail_authorize_tool_call', decision: decision.outcome, reason: decision.reason });
    focusOutput();
  }
}

async function approve() {
  if (!challenge) return;
  proof = await provider.approve(challenge.id, { approvedBy: 'you@sandbox' });
  tampered = false;
  setStage('approve', 'done');
  setStage('execute', 'active');
  note('st-approve', 'approved, a signed proof was issued for this exact request');
  note('readoutHint', 'run it once, or verify the proof');
  hide('approveActions');
  showJson($('output'), proofView(proof));
  show('executeActions');
  showVerifyBox();
  focusStep('execute');
}

async function deny() {
  if (!challenge) return;
  const receipt = await provider.deny(challenge.id, { reason: 'User rejected this action.' });
  setStage('approve', 'blocked');
  setVerdict('blocked', 'blocked');
  note('st-approve', 'rejected, a signed receipt was saved');
  note('readoutHint', 'rejected and recorded');
  hide('approveActions');
  showJson($('output'), receiptView(receipt));
  addReceipt(receipt);
  focusOutput();
}

async function execute() {
  if (!current || !proof) return;
  const action = activeAction();
  const result = await gateway.execute(action, () => toolResults[action.tool] ?? { simulated: true, ran: true }, {
    proofEnvelope: proof,
  });

  if (result.ok) {
    setStage('execute', 'done');
    setVerdict('allowed', 'allowed');
    note('st-execute', 'the action ran once and a signed receipt was saved');
    note('readoutHint', 'now try reusing the same proof');
    showJson($('output'), { result: result.result, receipt: receiptView(result.receipt) });
    addReceipt(result.receipt);
    $('executeBtn').setAttribute('hidden', '');
    show('replayBtn');
    focusOutput();
  }
}

async function replay() {
  if (!current || !proof) return;
  const action = activeAction();
  const result = await gateway.execute(action, () => toolResults[action.tool] ?? { simulated: true, ran: true }, {
    proofEnvelope: proof,
  });

  setStage('execute', 'blocked');
  setVerdict('blocked', 'replay blocked');
  note('st-execute', 'same proof, second time: refused');
  note('readoutHint', 'blocked, each proof works only once');
  showJson($('output'), { ok: result.ok, reason: result.receipt.payload.reason, receipt: receiptView(result.receipt) });
  addReceipt(result.receipt);
  $('replayBtn').setAttribute('hidden', '');
  focusOutput();
}

/* ---- verify + tamper (real permitrail_verify_proof) ---- */

function showVerifyBox() {
  tampered = false;
  $('tamperBtn').textContent = 'Tamper with it';
  $('tamperBtn').dataset.on = 'false';
  showJson($('verifyOut'), 'Check the proof against the trusted key. Tamper with it and watch verification fail.', true);
  show('verifyBox');
}

async function verifyProof() {
  if (!proof) return;
  const envelope = tampered ? tamperedProof : proof;
  const result = await mcp.callTool('permitrail_verify_proof', { proofEnvelope: envelope });
  if (result.ok) {
    showJson($('verifyOut'), {
      tool: 'permitrail_verify_proof',
      ok: true,
      verified: true,
      subject: result.proof.subject,
      claim: result.proof.claim,
      actionInputHash: trunc(result.proof.actionInputHash, 30),
    });
  } else {
    showJson($('verifyOut'), { tool: 'permitrail_verify_proof', ok: false, error: result.error });
  }
}

function toggleTamper() {
  if (!proof) return;
  tampered = !tampered;
  if (tampered) {
    tamperedProof = clone(proof);
    const sig = tamperedProof.signature || '';
    tamperedProof.signature = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    $('tamperBtn').textContent = 'Restore proof';
    showJson($('verifyOut'), 'One byte of the signature flipped. Verify again and it fails.', true);
  } else {
    $('tamperBtn').textContent = 'Tamper with it';
    showJson($('verifyOut'), 'Proof restored. Verify again and it passes.', true);
  }
  $('tamperBtn').dataset.on = String(tampered);
}

/* ---- view helpers ---- */

function trunc(value, max = 24) {
  return typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : value;
}

function proofView(envelope) {
  const p = envelope.payload;
  return {
    kind: p.kind,
    claim: p.claim,
    value: p.value,
    subject: p.subject,
    audience: p.audience,
    purpose: p.purpose,
    assurance: p.assurance,
    actionInputHash: trunc(p.actionInputHash, 30),
    expiresAt: p.expiresAt,
    signature: `ed25519:${trunc(envelope.signature, 44)}`,
  };
}

function receiptView(envelope) {
  const p = envelope.payload;
  return {
    kind: p.kind,
    id: p.id,
    decision: p.decision,
    reason: p.reason,
    inputHash: trunc(p.inputHash, 30),
    chainId: p.chainId,
    signature: `ed25519:${trunc(envelope.signature, 44)}`,
  };
}

let receiptCount = 0;
function addReceipt(envelope) {
  const p = envelope.payload;
  const list = $('auditList');
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  const allowed = p.decision === 'allowed';
  const row = document.createElement('div');
  row.className = `receipt ${allowed ? 'allowed' : 'denied'}`;
  row.innerHTML =
    `<span class="pill"></span>` +
    `<span class="rid">${p.id} · <span class="rhash">${trunc(p.inputHash ?? 'no-input', 22)}</span></span>` +
    `<span class="rdec">${p.decision}</span>`;
  list.prepend(row);
  receiptCount += 1;
  $('auditCount').textContent = `${receiptCount} receipt${receiptCount === 1 ? '' : 's'}`;
}

function setStage(name, status) {
  const el = document.querySelector(`.stage[data-stage="${name}"]`);
  if (el) el.dataset.status = status;
}

function resetRail() {
  for (const el of document.querySelectorAll('.stage')) el.removeAttribute('data-status');
  note('st-authorize', 'PermitRail checks this action against the policy');
  note('st-approve', 'a person approves or rejects the exact request');
  note('st-execute', 'the action runs once, then a signed receipt is saved');
}

function note(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setVerdict(state, text) {
  const v = $('verdict');
  v.dataset.state = state;
  $('verdictValue').textContent = text;
}

function setMcp(toolName) {
  const chip = $('mcpChip');
  if (!chip) return;
  if (toolName) {
    chip.textContent = `mcp · ${toolName}`;
    chip.removeAttribute('hidden');
  } else {
    chip.setAttribute('hidden', '');
  }
}

function show(id) {
  $(id).removeAttribute('hidden');
}
function hide(id) {
  $(id).setAttribute('hidden', '');
}

function isSmallScreen() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function focusStep(stage) {
  if (!isSmallScreen()) return;
  document.querySelector(`.stage[data-stage="${stage}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function focusOutput() {
  if (!isSmallScreen()) return;
  $('output').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showJson(el, obj, raw = false) {
  const text = raw && typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  el.querySelector('code').innerHTML = highlight(text);
}

function highlight(input) {
  const escaped = input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?/g,
    (match, str, colon) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      return `<span class="n">${match}</span>`;
    },
  );
}

$('runBtn').addEventListener('click', run);
$('approveBtn').addEventListener('click', approve);
$('denyBtn').addEventListener('click', deny);
$('executeBtn').addEventListener('click', execute);
$('replayBtn').addEventListener('click', replay);
$('editToggle').addEventListener('click', toggleEditor);
$('applyEdit').addEventListener('click', applyEdit);
$('cancelEdit').addEventListener('click', closeEditor);
$('verifyBtn').addEventListener('click', verifyProof);
$('tamperBtn').addEventListener('click', toggleTamper);

init().catch((error) => {
  $('engineState').textContent = `engine error: ${error.message}`;
});
