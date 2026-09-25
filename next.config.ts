import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite (banco local de desenvolvimento) usa WASM e não deve ser empacotado.
  serverExternalPackages: ['@electric-sql/pglite', 'xlsx'],
  poweredByHeader: false,
  // Conciliador estático antigo (100% no navegador), mantido em /conciliador.
  async rewrites() {
    return [{ source: '/conciliador', destination: '/conciliador/index.html' }];
  },
};

export default nextConfig;
