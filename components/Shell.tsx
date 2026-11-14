'use client';

import { Megaphone, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useSession } from '@/lib/account/session';
import { trackPage } from '@/lib/account/tracker';
import { BottomNav } from './BottomNav';
import { Landing } from './Landing';
import { LionMascot } from './LionMascot';

/**
 * Decides what a visitor may see.
 *
 * - Someone who is not signed in gets the public site: the landing page and
 *   the sign-in screens. Every other route sends them to sign in, so they can
 *   never land on a screen holding a student's courses or progress.
 * - The owner area exists only for the owner account.
 * - In the device-only build (no backend) the app works without an account.
 */

const AUTH_PAGES = ['/login', '/register', '/reset'];
const ENTERED_KEY = 'una-learning:entered';

const clean = (pathname: string | null) => (pathname ?? '/').replace(/\/+$/, '') || '/';

/** Reports each page that is opened, as a route name only. */
function RouteTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    trackPage(pathname ?? '/', search?.toString() ?? '');
  }, [pathname, search]);
  return null;
}

function Splash({ text }: { text: string }) {
  return (
    <div className="app">
      <main className="screen">
        <div className="lockedscreen" role="status">
          <LionMascot size={84} />
          <span className="spinner" aria-hidden="true" />
          <p>{text}</p>
        </div>
      </main>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = clean(usePathname());
  const router = useRouter();
  const { mode, user, config, offline } = useSession();
  // Device-only build: the landing page is shown until the visitor chooses to try the app here.
  const [entered, setEntered] = useState(true);

  useEffect(() => {
    try {
      setEntered(
        window.localStorage.getItem(ENTERED_KEY) === '1' ||
          window.localStorage.getItem('una-learning:progress:v1') !== null ||
          window.localStorage.getItem('una-learning:pdf-courses:v1') !== null,
      );
    } catch {
      setEntered(true);
    }
  }, []);

  const isAuthPage = AUTH_PAGES.includes(pathname);
  const isOwnerArea = pathname === '/owner' || pathname.startsWith('/owner/');
  const mustSignIn = mode === 'guest' && pathname !== '/' && !isAuthPage;
  const alreadyIn = mode === 'user' && isAuthPage;

  useEffect(() => {
    if (mustSignIn) router.replace('/login');
    else if (alreadyIn) router.replace('/');
    else if (mode === 'local' && isAuthPage) router.replace('/');
  }, [mustSignIn, alreadyIn, mode, isAuthPage, router]);

  const tracker = (
    <Suspense fallback={null}>
      <RouteTracker />
    </Suspense>
  );

  if (mode === 'loading') return <Splash text="Opening UNA Learning…" />;
  if (mustSignIn || alreadyIn || (mode === 'local' && isAuthPage)) return <Splash text="One moment…" />;

  const enter = () => {
    try {
      window.localStorage.setItem(ENTERED_KEY, '1');
    } catch {
      /* ignore */
    }
    setEntered(true);
  };

  if (pathname === '/' && (mode === 'guest' || (mode === 'local' && !entered))) {
    return (
      <div className="site">
        {tracker}
        <Landing onTryHere={mode === 'local' ? enter : undefined} />
      </div>
    );
  }

  if (isOwnerArea) {
    // To anyone but the owner this address looks like any page that does not exist.
    if (user?.role !== 'owner') {
      return (
        <div className="app">
          {tracker}
          <main className="screen">
            <div className="lockedscreen">
              <LionMascot size={96} />
              <h1>Page not found</h1>
              <p>There is nothing at this address.</p>
              <Link href="/" className="btn btn-gold">
                Back to home
              </Link>
            </div>
          </main>
        </div>
      );
    }
    return <div className="site owner-site">{children}</div>;
  }

  return (
    <div className="app">
      {tracker}
      {config.announcement && !isAuthPage && (
        <div className={`announce announce-${config.announcement.tone}`} role="status">
          <Megaphone size={16} aria-hidden="true" />
          <span>{config.announcement.text}</span>
        </div>
      )}
      {offline && mode === 'user' && (
        <div className="announce announce-warning" role="status">
          <WifiOff size={16} aria-hidden="true" />
          <span>Offline. You can keep studying; changes are saved to your account when you reconnect.</span>
        </div>
      )}
      {children}
      {!isAuthPage && (
        <Suspense fallback={null}>
          <BottomNav />
        </Suspense>
      )}
    </div>
  );
}
