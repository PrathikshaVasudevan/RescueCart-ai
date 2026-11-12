import { timingSafeEqual } from "node:crypto";

export function isValidRecoveryAuthorization(
  authorization: string | null,
  username = process.env.RECOVERY_CENTRE_USERNAME,
  password = process.env.RECOVERY_CENTRE_PASSWORD,
): boolean {
  if (!username || !password || !authorization) return false;
  const separator = authorization.indexOf(" ");
  if (separator < 0 || authorization.slice(0, separator).toLowerCase() !== "basic") return false;

  let supplied: Buffer;
  try {
    supplied = Buffer.from(authorization.slice(separator + 1).trim(), "base64");
  } catch {
    return false;
  }
  const expected = Buffer.from(`${username}:${password}`, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
