import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Suntec+ Play & Win', template: '%s · Suntec+ Play & Win' },
  description: 'Play games, complete missions and earn rewards at Suntec City.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-SG" className={inter.variable}>
      <body className="min-h-dvh bg-bg text-text">{children}</body>
    </html>
  );
}
