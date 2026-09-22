import type { NextConfig } from "next";

// CSP is per-request (nonce): see src/proxy.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Type-checks links against the real routes.
  typedRoutes: true,
  poweredByHeader: false,
  // Dev only: phones on the same Wi-Fi.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "172.*.*.*"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
