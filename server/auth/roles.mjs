export const roles = Object.freeze(["participant", "facilitator", "administrator"]);

export function normalizeRole(value) {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  return roles.includes(role) ? role : null;
}

export function requireRole(user, allowed) {
  if (!user) throw Object.assign(new Error("Authentication is required."), { status: 401, code: "AUTHENTICATION_REQUIRED" });
  const role = normalizeRole(user.role);
  if (!role || !allowed.includes(role)) {
    throw Object.assign(new Error("You are not authorized for this action."), { status: 403, code: "FORBIDDEN" });
  }
}
