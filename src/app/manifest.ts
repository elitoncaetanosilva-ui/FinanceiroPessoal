import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Finanças — controle e planejamento',
    short_name: 'Finanças',
    description: 'Controle e planejamento financeiro pessoal',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f6f5',
    theme_color: '#0d6b5c',
    lang: 'pt-BR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Nova despesa', url: '/movimentos/novo?tipo=despesa' },
      { name: 'Pendentes', url: '/pendentes' },
      { name: 'Importar arquivo', url: '/importacoes' },
    ],
  };
}
