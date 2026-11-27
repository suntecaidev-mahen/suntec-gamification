import type { Metadata, Viewport } from 'next';
import { Montserrat } from 'next/font/google';
import { EnvBanner } from '@/components/EnvBanner';
import './globals.css';

// Same typeface as sunteccity.com.sg (Google Fonts, SIL Open Font License).
const montserrat = Montserrat({ subsets: ['latin'], display: 'swap', variable: '--font-montserrat' });

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
    <html lang="en-SG" className={montserrat.variable}>
      <body className="min-h-dvh bg-bg text-text">
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
