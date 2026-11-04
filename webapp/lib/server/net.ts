// Addresses a server-side fetch must never reach: loopback, private networks, link-local (cloud metadata), CGNAT, multicast.
import { isIP } from "node:net";

export function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? privateIp(m[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

