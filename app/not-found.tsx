import Link from 'next/link';
import { LionMascot } from '@/components/LionMascot';

export default function NotFound() {
  return (
    <main className="screen with-nav">
      <div className="lockedscreen">
        <LionMascot size={96} />
        <h1>Page not found</h1>
        <p>That course or section does not exist in the demo.</p>
        <Link href="/" className="btn btn-gold">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
