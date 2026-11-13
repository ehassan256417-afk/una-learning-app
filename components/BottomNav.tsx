'use client';

import { BarChart3, BookOpen, FileUp, Home, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Home', icon: Home, match: ['/'] },
  { href: '/courses', label: 'Courses', icon: BookOpen, match: ['/courses', '/my'] },
  { href: '/upload', label: 'Upload', icon: FileUp, match: ['/upload'] },
  { href: '/progress', label: 'Progress', icon: BarChart3, match: ['/progress'] },
  { href: '/profile', label: 'Profile', icon: UserRound, match: ['/profile'] },
];

export function BottomNav() {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  // Pre-lesson and lesson screens are focused flows with their own action bar.
  const focused = /^\/courses\/[^/]+\/[^/]+/.test(pathname) || (pathname.startsWith('/my') && params.has('s'));
  if (focused) return null;
  return (
    <nav className="bottomnav" aria-label="Main navigation">
      {ITEMS.map(({ href, label, icon: Icon, match }) => {
        const current = match.some((m) => (m === '/' ? pathname === '/' : pathname.startsWith(m)));
        return (
          <Link key={href} href={href} className={current ? 'current' : ''} aria-current={current ? 'page' : undefined}>
            <Icon size={23} fill={current && href === '/' ? 'currentColor' : 'none'} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
