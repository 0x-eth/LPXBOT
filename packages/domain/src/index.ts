export const domainPackage = {
  name: "@lpbot/domain",
} as const;

export type Role = "user" | "pro" | "admin";
export type Tier = "normal" | "pro";
export type AccountStatus = "active" | "pending" | "rejected" | "banned";
export type AccessLevel = "authenticated" | "pro" | "admin";
export type ChainAccessMode = "off" | "pro" | "all";
export type ChainOperationCategory = "read" | "monitor" | "unwind" | "new-exposure";

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
