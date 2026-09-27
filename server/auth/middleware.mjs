import { verifyAccessToken } from "./jwt.mjs";
import { normalizeRole } from "./roles.mjs";

function parseCookies(headerCookie = "") {
  return Object.fromEntries(
    String(headerCookie)
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export async function optionalAuth(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.access_token || req.headers.authorization?.replace(/^Bearer\s+/i, "") || null;
  if (!token) return null;
  try {
    const payload = await verifyAccessToken(token);
    const role = normalizeRole(payload.role);
    if (!role) return null;
    return {
      id: payload.sub,
      email: payload.email,
      role,
      jti: payload.jti,
      exp: payload.exp,
      iss: payload.iss,
      aud: payload.aud
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req) {
  const user = await optionalAuth(req);
  if (!user) throw Object.assign(new Error("Authentication is required."), { status: 401, code: "AUTHENTICATION_REQUIRED" });
  return user;
}

export async function requireRole(req, allowed) {
  const user = await requireAuth(req);
  if (!allowed.includes(user.role)) {
    throw Object.assign(new Error("You are not authorized for this action."), { status: 403, code: "FORBIDDEN" });
  }
  return user;
}

export async function revokeToken(_jti) {
  return true;
}
