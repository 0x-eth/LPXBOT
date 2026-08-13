export const domainPackage = {
  name: "@lpbot/domain",
} as const;

export type Role = "user" | "pro" | "admin";
export type AccountStatus = "active" | "pending" | "rejected" | "banned";
export type AccessLevel = "authenticated" | "pro" | "admin";

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
