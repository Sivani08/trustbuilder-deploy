import { SignJWT, jwtVerify } from "jose";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required.");
  return new TextEncoder().encode(secret);
}

export function getJwtConfig() {
  return {
    issuer: process.env.JWT_ISSUER || "trustbuilder",
    audience: process.env.JWT_AUDIENCE || "trustbuilder-web",
    accessTtl: process.env.JWT_ACCESS_TTL || "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL || "7d"
  };
}

export async function createAccessToken(user) {
  const { issuer, audience, accessTtl } = getJwtConfig();
  const jwt = await new SignJWT({ sub: user.id, role: user.role, email: user.email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(accessTtl)
    .setJti(globalThis.crypto?.randomUUID?.() || `jwt-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    .sign(getSecret());
  return jwt;
}

export async function verifyAccessToken(token) {
  if (!token) throw new Error("Missing access token.");
  const { issuer, audience } = getJwtConfig();
  const { payload } = await jwtVerify(token, getSecret(), { issuer, audience });
  return payload;
}

export function revokeToken(jti) {
  return Boolean(jti);
}
