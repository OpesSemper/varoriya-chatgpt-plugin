import { AppError } from "../errors.js";
import type { AuthContext } from "./types.js";

export type ScopeMatch = "all" | "any";

export function assertScopes(
  auth: Pick<AuthContext, "scopes">,
  requiredScopes: readonly string[],
  match: ScopeMatch = "all",
): void {
  if (requiredScopes.length === 0) return;
  const permitted =
    match === "all"
      ? requiredScopes.every((scope) => auth.scopes.has(scope))
      : requiredScopes.some((scope) => auth.scopes.has(scope));
  if (!permitted) {
    throw new AppError("INSUFFICIENT_SCOPE", {
      status: 403,
      message: "The access token does not grant the required permission.",
      details: { required_scope: requiredScopes.join(" ") },
    });
  }
}

/**
 * Compare against ownership metadata loaded from a trusted server-side record,
 * never an owner identifier supplied by the request itself.
 */
export function assertResourceOwner(
  auth: { readonly userId?: string; readonly subject?: string },
  trustedResourceOwnerId: string | null | undefined,
): void {
  const authenticatedOwnerId = auth.userId ?? auth.subject;
  if (
    !trustedResourceOwnerId ||
    trustedResourceOwnerId.length > 256 ||
    authenticatedOwnerId !== trustedResourceOwnerId
  ) {
    throw new AppError("RESOURCE_FORBIDDEN", {
      status: 403,
      message: "The requested resource is not available to this account.",
    });
  }
}
