'use client';

import { BarChart3, BookOpen, FileUp, Home, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/courses', label: 'Courses', icon: BookOpen },
  { href: '/upload', label: 'Upload', icon: FileUp },
  { href: '/progress', label: 'Progress', icon: BarChart3 },
  { href: '/profile', label: 'Profile', icon: UserRound },
];

/** Pre-lesson and lesson screens are focused flows with their own action bar. */
const isFocusedFlow = (path: string) => /^\/courses\/[^/]+\/[^/]+/.test(path);

export function BottomNav() {
  const pathname = usePathname() ?? '/';
  if (isFocusedFlow(pathname)) return null;
  return (
    <nav className="bottomnav" aria-label="Main navigation">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const current = href === '/' ? pathname === '/' : pathname.startsWith(href);
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
