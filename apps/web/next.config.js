/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,

  experimental: {
    // BullMQ, ioredis, Prisma and fluent-ffmpeg only ever run on the
    // server - keep them out of the client bundle explicitly.
    serverComponentsExternalPackages: [
      "bullmq",
      "ioredis",
      "@prisma/client",
      "fluent-ffmpeg",
    ],
    // Tree-shake the heaviest client imports.
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "**.fbsbx.com" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.tiktokcdn.com" },
      { protocol: "https", hostname: "**.tiktokcdn-us.com" },
      { protocol: "https", hostname: "**.ytimg.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "**.twimg.com" },
      { protocol: "https", hostname: "**.pbs.twimg.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Webhook endpoints must be reachable by platform callbacks;
        // keep them out of any aggressive caching.
        source: "/api/webhooks/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },

  async rewrites() {
    return [
      {
        source: "/healthz",
        destination: "/api/health",
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      // BullMQ workers rely on optional externals; keep webpack quiet.
      config.externals = config.externals || [];
    }
    return config;
  },
};

module.exports = nextConfig;
