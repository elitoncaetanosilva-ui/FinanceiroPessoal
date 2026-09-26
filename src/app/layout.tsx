import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Finanças', template: '%s · Finanças' },
  description: 'Controle e planejamento financeiro pessoal',
  applicationName: 'Finanças',
  appleWebApp: { capable: true, title: 'Finanças', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1412' },
  ],
};

// Aplica tema e modo privacidade antes da pintura (sem piscar).
const boot = `try{var t=localStorage.getItem('fp.theme');if(t)document.documentElement.dataset.theme=t;if(localStorage.getItem('fp.privacy')==='on')document.documentElement.dataset.privacy='on'}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
