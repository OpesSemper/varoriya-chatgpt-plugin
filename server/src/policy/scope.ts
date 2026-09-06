import { AppError } from "../errors.js";
import type { RequestContext } from "../types/varoriya.js";

/** Concrete exact-match scope guard; wildcard scopes are never inferred. */
export class ScopePolicy {
  public require(context: RequestContext, scope: string): void {
    if (!validScope(scope) || !context.scopes.has(scope)) {
      throw new AppError("INSUFFICIENT_SCOPE", {
        status: 403,
        message: "The access token does not grant the required permission.",
        ...(validScope(scope) ? { details: { required_scope: scope } } : {}),
      });
    }
  }
}

function validScope(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value);
}
