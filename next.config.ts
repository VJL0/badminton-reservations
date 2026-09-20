import type { NextConfig } from "next";

// The Content Security Policy is per-request (nonce) and lives in src/proxy.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  // Dev only: lets a phone on the same Wi-Fi open http://<this-computer's-IP>:3000 (private address ranges).
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "172.*.*.*"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
