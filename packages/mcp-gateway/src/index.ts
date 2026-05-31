import {
  DEFAULT_POLICY,
  buildProofRequestFromPolicy,
  createActionReceipt,
  evaluatePolicy,
  verifyProof,
} from '@proofrail/core';
import type {
  ActionReceiptPayload,
  AgentAction,
  ProofrailKeyPair,
  ProofrailPolicy,
  PolicyDecision,
  ProofChallenge,
  ProofPayload,
  ProofProvider,
  SignedEnvelope,
} from '@proofrail/core';

export interface ProofrailGatewayOptions {
  readonly policy?: ProofrailPolicy;
  readonly provider?: ProofProvider;
  // Required. Generate once with createProofrailKeyPair() and persist it so
  // receipts stay verifiable across restarts. A gateway that mints a throwaway
  // key on every boot produces an audit trail nobody can later verify.
  readonly receiptKeyPair: ProofrailKeyPair;
  readonly trustedProofKeys?: readonly string[];
}

export interface GatewayAuthorizeOptions {
  readonly proofEnvelope?: SignedEnvelope<ProofPayload>;
  readonly now?: Date | number | string;
}

export type GatewayAuthorization<TInput = unknown> = PolicyDecision<TInput> & {
  readonly challenge?: ProofChallenge<TInput>;
  readonly proof?: ProofPayload;
  readonly verificationError?: unknown;
};

export type ToolHandler<TInput, TResult> = (input: TInput | undefined) => Promise<TResult> | TResult;

export interface GatewayExecutionResult<TInput = unknown, TResult = unknown> {
  readonly ok: boolean;
  readonly result?: TResult;
  readonly authorization: GatewayAuthorization<TInput>;
  readonly receipt: SignedEnvelope<ActionReceiptPayload>;
}

export interface McpToolDefinition {
  readonly name: ProofrailMcpToolName;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties: boolean;
  };
}

export interface ProofrailMcpToolsOptions {
  readonly gateway: ProofrailGateway;
  readonly provider?: ProofProvider;
}

export type ProofrailMcpToolName =
  | 'proofrail_authorize_tool_call'
  | 'proofrail_get_challenge'
  | 'proofrail_verify_proof'
  | 'proofrail_write_receipt';

export interface ProofrailMcpToolRouter {
  readonly tools: readonly McpToolDefinition[];
  callTool(name: ProofrailMcpToolName, input: Record<string, unknown>): Promise<unknown>;
}

export class ProofrailGateway {
  readonly policy?: ProofrailPolicy;
  readonly provider?: ProofProvider;
  readonly receiptKeyPair: ProofrailKeyPair;
  readonly trustedProofKeys: readonly string[];

  constructor(options: ProofrailGatewayOptions) {
    if (!options?.receiptKeyPair?.privateKeyPem) {
      throw new Error(
        'ProofrailGateway requires a receiptKeyPair. Generate one with createProofrailKeyPair() and persist it so receipts stay verifiable across restarts.',
      );
    }
    this.policy = options.policy;
    this.provider = options.provider;
    this.receiptKeyPair = options.receiptKeyPair;
    this.trustedProofKeys = options.trustedProofKeys || [];
  }

  async authorize<TInput = unknown>(
    action: AgentAction<TInput>,
    options: GatewayAuthorizeOptions = {},
  ): Promise<GatewayAuthorization<TInput>> {
    let verifiedProof: ProofPayload | null = null;
    let verificationError: unknown = null;
    let matchedPublicKeyPem = this.trustedProofKeys[0];

    if (options.proofEnvelope) {
      for (const publicKeyPem of this.trustedProofKeys) {
        try {
          verifiedProof = await verifyProof(options.proofEnvelope, {
            publicKeyPem,
            audience: action.audience,
            subject: action.subject,
            purpose: action.purpose,
            now: options.now,
          });
          matchedPublicKeyPem = publicKeyPem;
          verificationError = null;
          break;
        } catch (error) {
          verificationError = error;
        }
      }
    }

    const activePolicy = this.policy || DEFAULT_POLICY;
    const decision = await evaluatePolicy(activePolicy, action, options.proofEnvelope, {
      publicKeyPem: matchedPublicKeyPem,
      audience: action.audience,
      subject: action.subject,
      purpose: action.purpose,
      now: options.now,
    });

    if (decision.outcome === 'require_proof' && this.provider) {
      const proofRequest = buildProofRequestFromPolicy(activePolicy, action);
      const challenge = await this.provider.requestProof(proofRequest);
      return {
        ...decision,
        challenge,
      };
    }

    return {
      ...decision,
      proof: verifiedProof || (decision.outcome === 'allow' ? decision.proof : undefined),
      verificationError,
    };
  }

  async execute<TInput = unknown, TResult = unknown>(
    action: AgentAction<TInput>,
    handler: ToolHandler<TInput, TResult>,
    options: GatewayAuthorizeOptions = {},
  ): Promise<GatewayExecutionResult<TInput, TResult>> {
    const authorization = await this.authorize(action, options);

    if (!authorization.allowed) {
      const receipt = await createActionReceipt(
        {
          action,
          decision: authorization.outcome,
          reason: authorization.reason,
          policyId: authorization.policyId,
          proofEnvelope: options.proofEnvelope,
        },
        this.receiptKeyPair,
      );

      return {
        ok: false,
        authorization,
        receipt,
      };
    }

    const result = await handler(action.input);
    const receipt = await createActionReceipt(
      {
        action,
        decision: 'allowed',
        reason: authorization.reason,
        policyId: authorization.policyId,
        proofEnvelope: options.proofEnvelope,
      },
      this.receiptKeyPair,
    );

    return {
      ok: true,
      result,
      authorization,
      receipt,
    };
  }
}

export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = Object.freeze([
  {
    name: 'proofrail_authorize_tool_call',
    description: 'Authorize an agent tool call and request proof when policy requires it.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      additionalProperties: false,
      properties: {
        action: { type: 'object' },
        proofEnvelope: { type: 'object' },
      },
    },
  },
  {
    name: 'proofrail_get_challenge',
    description: 'Read the status of a pending, approved, or denied proof challenge.',
    inputSchema: {
      type: 'object',
      required: ['challengeId'],
      additionalProperties: false,
      properties: {
        challengeId: { type: 'string' },
      },
    },
  },
  {
    name: 'proofrail_verify_proof',
    description: 'Verify a signed Proofrail proof envelope.',
    inputSchema: {
      type: 'object',
      required: ['proofEnvelope'],
      additionalProperties: false,
      properties: {
        proofEnvelope: { type: 'object' },
        publicKeyPem: { type: 'string' },
      },
    },
  },
  {
    name: 'proofrail_write_receipt',
    description: 'Create a signed receipt for an allowed, blocked, or denied action.',
    inputSchema: {
      type: 'object',
      required: ['action', 'decision'],
      additionalProperties: false,
      properties: {
        action: { type: 'object' },
        decision: { type: 'string' },
        reason: { type: 'string' },
        policyId: { type: 'string' },
        proofEnvelope: { type: 'object' },
      },
    },
  },
]);

export function createProofrailMcpTools(options: ProofrailMcpToolsOptions): ProofrailMcpToolRouter {
  return {
    tools: MCP_TOOL_DEFINITIONS,
    async callTool(name, input) {
      switch (name) {
        case 'proofrail_authorize_tool_call':
          return options.gateway.authorize(
            input.action as AgentAction,
            { proofEnvelope: input.proofEnvelope as SignedEnvelope<ProofPayload> | undefined },
          );

        case 'proofrail_get_challenge':
          if (!options.provider?.getChallenge) {
            throw new Error('This Proofrail provider does not expose challenge lookup');
          }
          return options.provider.getChallenge(String(input.challengeId));

        case 'proofrail_verify_proof':
          return verifyWithTrustedKeys(
            options.gateway.trustedProofKeys,
            input.proofEnvelope as SignedEnvelope<ProofPayload>,
            typeof input.publicKeyPem === 'string' ? input.publicKeyPem : undefined,
          );

        case 'proofrail_write_receipt':
          return createActionReceipt(
            {
              action: input.action as AgentAction,
              decision: String(input.decision),
              reason: typeof input.reason === 'string' ? input.reason : undefined,
              policyId: typeof input.policyId === 'string' ? input.policyId : undefined,
              proofEnvelope: input.proofEnvelope as SignedEnvelope<ProofPayload> | undefined,
            },
            options.gateway.receiptKeyPair,
          );

        default:
          throw new Error(`Unknown Proofrail MCP tool: ${String(name)}`);
      }
    },
  };
}

async function verifyWithTrustedKeys(
  trustedProofKeys: readonly string[],
  proofEnvelope: SignedEnvelope<ProofPayload>,
  explicitPublicKeyPem?: string,
): Promise<{ readonly ok: true; readonly proof: ProofPayload } | { readonly ok: false; readonly error: string }> {
  const keys = explicitPublicKeyPem ? [explicitPublicKeyPem] : trustedProofKeys;

  for (const publicKeyPem of keys) {
    try {
      return {
        ok: true,
        proof: await verifyProof(proofEnvelope, { publicKeyPem }),
      };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    error: 'Proof could not be verified with the configured trusted keys',
  };
}
