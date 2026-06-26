import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver + Prisma client must not be bundled (Prisma 7 + Next.js)
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-libsql",
    "@libsql/client",
  ],
  async redirects() {
    return [
      {
        source: "/browse",
        destination: "/marketplace",
        permanent: false,
      },
      {
        source: "/",
        destination: "/marketplace",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

