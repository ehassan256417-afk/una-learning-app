import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import { Suspense } from 'react';
import { BottomNav } from '@/components/BottomNav';
import { ProgressProvider } from '@/lib/progress/store';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-app',
});

export const metadata: Metadata = {
  title: 'UNA Learning — Student Beta',
  description:
    'Independent student project for UNA learners. Not an official University of North Alabama application.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#2b0f52',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <ProgressProvider>
          <div className="app">
            {children}
            <Suspense fallback={null}>
              <BottomNav />
            </Suspense>
          </div>
        </ProgressProvider>
      </body>
    </html>
  );
}
