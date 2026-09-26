import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite (Postgres em WASM, só para desenvolvimento/testes) e pg não devem ser empacotados.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', '@e965/xlsx'],
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '5mb' },
  },
};

export default nextConfig;
