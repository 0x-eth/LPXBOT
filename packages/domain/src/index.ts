export const domainPackage = {
  name: "@lpbot/domain",
} as const;

export { evaluateMonitorSnapshot, monitorCandidateKey } from "./monitor-evaluator.js";
export type {
  MonitorCandidate,
  MonitorConditionMetric,
  MonitorEvaluationCondition,
  MonitorEvaluationDefinition,
  MonitorEvaluationInput,
  MonitorEvaluationResult,
  MonitorMetricSnapshot,
  MonitorMetricValue,
  MonitorNoMatchReason,
} from "./monitor-evaluator.js";

export type Role = "user" | "pro" | "admin";
export type Tier = "normal" | "pro";
export type AccountStatus = "active" | "pending" | "rejected" | "banned";
export type AccessLevel = "authenticated" | "pro" | "admin";
export type ChainAccessMode = "off" | "pro" | "all";
export type ChainOperationCategory = "read" | "monitor" | "unwind" | "new-exposure";

export interface PoolEligibilityCandidate {
  chainId: number;
  poolKey: string;
  token0Address: string | null;
  token1Address: string | null;
}

export interface PoolEligibilityBlockedBy {
  identity: string;
  scope: "pool" | "token";
}

export interface PoolEligibilityLimitation {
  code: "POOL_KEY_NON_CANONICAL" | "TOKEN_ADDRESS_MISSING" | "TOKEN_ADDRESS_NON_CANONICAL";
  field: "poolKey" | "token0Address" | "token1Address";
}

export interface PoolEligibilityDecision {
  blockedBy: PoolEligibilityBlockedBy[];
  eligible: boolean;
  limitations: PoolEligibilityLimitation[];
}

export interface PoolEligibilityPolicy {
  readonly blocklistHash: string;
  evaluate(candidate: PoolEligibilityCandidate): PoolEligibilityDecision;
  filter<T extends PoolEligibilityCandidate>(
    candidates: readonly T[],
  ): {
    candidates: T[];
    limitations: Array<PoolEligibilityLimitation & { poolKey: string }>;
  };
}

export interface PoolEligibilityPolicySnapshot {
  blocklistHash: string;
  entries: ReadonlyArray<{
    chainId: number;
    identity: string;
    scope: "pool" | "token";
  }>;
}

const canonicalPoolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const canonicalTokenAddressPattern = /^0x[0-9a-f]{40}$/u;
const blocklistHashPattern = /^sha256:[0-9a-f]{64}$/u;

export function createPoolEligibilityPolicy(
  snapshot: PoolEligibilityPolicySnapshot,
): PoolEligibilityPolicy {
  if (!blocklistHashPattern.test(snapshot.blocklistHash) || !Array.isArray(snapshot.entries)) {
    throw new RangeError("POOL_ELIGIBILITY_POLICY_INVALID");
  }
  const blockedPools = new Set<string>();
  const blockedTokens = new Set<string>();
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    const validIdentity =
      entry.scope === "pool"
        ? canonicalPoolKeyPattern.test(entry.identity)
        : entry.scope === "token" && canonicalTokenAddressPattern.test(entry.identity);
    const key = `${entry.chainId}\u0000${entry.scope}\u0000${entry.identity}`;
    if (entry.chainId !== 56 || !validIdentity || seen.has(key)) {
      throw new RangeError("POOL_ELIGIBILITY_POLICY_INVALID");
    }
    seen.add(key);
    (entry.scope === "pool" ? blockedPools : blockedTokens).add(entry.identity);
  }

  const evaluate = (candidate: PoolEligibilityCandidate): PoolEligibilityDecision => {
    const blockedBy: PoolEligibilityBlockedBy[] = [];
    const limitations: PoolEligibilityLimitation[] = [];
    if (candidate.chainId !== 56 || !canonicalPoolKeyPattern.test(candidate.poolKey)) {
      limitations.push({ code: "POOL_KEY_NON_CANONICAL", field: "poolKey" });
    } else if (blockedPools.has(candidate.poolKey)) {
      blockedBy.push({ identity: candidate.poolKey, scope: "pool" });
    }

    for (const field of ["token0Address", "token1Address"] as const) {
      const identity = candidate[field];
      if (identity === null) {
        limitations.push({ code: "TOKEN_ADDRESS_MISSING", field });
      } else if (!canonicalTokenAddressPattern.test(identity)) {
        limitations.push({ code: "TOKEN_ADDRESS_NON_CANONICAL", field });
      } else if (
        blockedTokens.has(identity) &&
        !blockedBy.some((entry) => entry.scope === "token" && entry.identity === identity)
      ) {
        blockedBy.push({ identity, scope: "token" });
      }
    }
    return { blockedBy, eligible: blockedBy.length === 0, limitations };
  };

  return {
    blocklistHash: snapshot.blocklistHash,
    evaluate,
    filter<T extends PoolEligibilityCandidate>(candidates: readonly T[]) {
      const eligible: T[] = [];
      const limitations: Array<PoolEligibilityLimitation & { poolKey: string }> = [];
      for (const candidate of candidates) {
        const decision = evaluate(candidate);
        limitations.push(
          ...decision.limitations.map((limitation) => ({
            ...limitation,
            poolKey: candidate.poolKey,
          })),
        );
        if (decision.eligible) eligible.push(candidate);
      }
      return { candidates: eligible, limitations };
    },
  };
}

export type ChainAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "CHAIN_ACCESS_DENIED" | "CHAIN_CREATION_DISABLED" | "CHAIN_PRO_REQUIRED";
    };

export interface ChainAccessPolicyValue {
  access: string;
  chainId: number;
}

const chainOperationCategories = {
  "pool.create": "new-exposure",
  "pool.withdraw": "unwind",
  "position.close": "unwind",
  "position.compound": "new-exposure",
  "position.emergency_exit": "unwind",
  "position.increase": "new-exposure",
  "position.monitor": "monitor",
  "position.read": "read",
  "position.switch_pool": "new-exposure",
  "task.create": "new-exposure",
  "task.stop": "unwind",
} as const satisfies Readonly<Record<string, ChainOperationCategory>>;

export function chainOperationCategory(action: string): ChainOperationCategory | null {
  if (!Object.hasOwn(chainOperationCategories, action)) return null;
  return chainOperationCategories[action as keyof typeof chainOperationCategories];
}

export function trustedRoleForTier(role: string, tier: string): Role | null {
  if (role === "user" && tier === "normal") return role;
  if (role === "pro" && tier === "pro") return role;
  if (role === "admin" && (tier === "normal" || tier === "pro")) return role;
  return null;
}

function isChainAccessMode(value: string): value is ChainAccessMode {
  return value === "off" || value === "pro" || value === "all";
}

function isChainOperationCategory(value: string): value is ChainOperationCategory {
  return value === "read" || value === "monitor" || value === "unwind" || value === "new-exposure";
}

export function authorizeChainOperation(input: {
  access: string;
  operation: string;
  role: string;
  tier: string;
}): ChainAccessDecision {
  const role = trustedRoleForTier(input.role, input.tier);
  if (!role || !isChainAccessMode(input.access) || !isChainOperationCategory(input.operation)) {
    return { allowed: false, code: "CHAIN_ACCESS_DENIED" };
  }

  if (input.operation !== "new-exposure") return { allowed: true };
  if (input.access === "off") {
    return { allowed: false, code: "CHAIN_CREATION_DISABLED" };
  }
  if (input.access === "pro" && role === "user") {
    return { allowed: false, code: "CHAIN_PRO_REQUIRED" };
  }
  return { allowed: true };
}

export function effectiveAllowedChainIds(
  policies: readonly ChainAccessPolicyValue[],
  role: string,
  tier: string,
): number[] {
  const trustedRole = trustedRoleForTier(role, tier);
  if (!trustedRole) return [];

  const allowed = new Set<number>();
  for (const policy of policies) {
    if (!Number.isSafeInteger(policy.chainId) || policy.chainId <= 0) continue;
    if (policy.access === "all" || (policy.access === "pro" && trustedRole !== "user")) {
      allowed.add(policy.chainId);
    }
  }
  return [...allowed];
}

export interface AccountAccessContext {
  accountStatus: AccountStatus;
  maintenance: {
    enabled: boolean;
    message: string | null;
    until: string | null;
  };
  region: {
    blocked: boolean;
    code: string | null;
    message: string | null;
  };
  role: Role;
}

export type AccountAccessDecision =
  | { allowed: true; maintenanceBypass: boolean }
  | {
      allowed: false;
      code:
        | "ACCOUNT_PENDING"
        | "ACCOUNT_REJECTED"
        | "ACCOUNT_BANNED"
        | "REGION_BLOCKED"
        | "MAINTENANCE";
      message: string;
      region?: string | null;
      retryable: boolean;
      statusCode: 403 | 503;
      until?: string | null;
    };

const roleRank: Readonly<Record<Role, number>> = {
  user: 1,
  pro: 2,
  admin: 3,
};

const accessRank: Readonly<Record<AccessLevel, number>> = {
  authenticated: 1,
  pro: 2,
  admin: 3,
};

export function roleCanAccess(role: string, required: AccessLevel | null): boolean {
  if (required === null || !(role in roleRank) || !(required in accessRank)) return false;
  return roleRank[role as Role] >= accessRank[required];
}

const accountErrors = {
  pending: { code: "ACCOUNT_PENDING", message: "Account approval is pending" },
  rejected: { code: "ACCOUNT_REJECTED", message: "Account access was rejected" },
  banned: { code: "ACCOUNT_BANNED", message: "Account access is suspended" },
} as const;

export function authorizeAccount(context: AccountAccessContext): AccountAccessDecision {
  if (context.accountStatus !== "active") {
    const error = accountErrors[context.accountStatus];
    return {
      allowed: false,
      ...error,
      retryable: false,
      statusCode: 403,
    };
  }

  if (context.region.blocked) {
    return {
      allowed: false,
      code: "REGION_BLOCKED",
      message: context.region.message ?? "Service is unavailable in this region",
      region: context.region.code,
      retryable: false,
      statusCode: 403,
    };
  }

  if (context.maintenance.enabled && context.role !== "admin") {
    return {
      allowed: false,
      code: "MAINTENANCE",
      message: context.maintenance.message ?? "Service is temporarily unavailable",
      retryable: true,
      statusCode: 503,
      until: context.maintenance.until,
    };
  }

  return {
    allowed: true,
    maintenanceBypass: context.maintenance.enabled && context.role === "admin",
  };
}

export function canAccessOwnedResource(
  subjectUserId: string,
  ownerUserId: string,
  role: Role,
  adminScopeGranted: boolean,
): boolean {
  return subjectUserId === ownerUserId || (role === "admin" && adminScopeGranted);
}
