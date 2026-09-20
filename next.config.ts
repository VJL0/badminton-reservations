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
  // Links and redirects are checked against the real routes: a typo or a removed page is a compile error.
  typedRoutes: true,
  experimental: {
    // On a dropped connection, hold a navigation or Server Action (join queue, leave, pause...) and run it
    // once the network is back, instead of failing. See <OfflineBanner>. Experimental in 16.3.
    useOffline: true,
  },
  poweredByHeader: false,
  // Dev only: lets a phone on the same Wi-Fi open http://<this-computer's-IP>:3000 (private address ranges).
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "172.*.*.*"],
  // Near-miss URLs people type or guess. Temporary (307): where they land depends on tonight's session.
  async redirects() {
    return [
      { source: "/play", destination: "/", permanent: false },
      { source: "/join", destination: "/", permanent: false },
      { source: "/admin/sessions", destination: "/admin", permanent: false },
      { source: "/(login|signin|sign-in|staff|officer|officers)", destination: "/admin/login", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
