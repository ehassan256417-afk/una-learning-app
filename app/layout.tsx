import type { Metadata, Viewport } from 'next';
import { Poppins } from 'next/font/google';
import { Shell } from '@/components/Shell';
import { SessionProvider } from '@/lib/account/session';
import { ProgressProvider } from '@/lib/progress/store';
import './globals.css';
import './accounts.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-app',
});

export const metadata: Metadata = {
  title: 'UNA Learning — lessons from your own course material',
  description:
    'Turn course PDFs and slides into short lessons, quizzes and spaced review. An independent student project, not an official University of North Alabama application.',
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
        <SessionProvider>
          <ProgressProvider>
            <Shell>{children}</Shell>
          </ProgressProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
