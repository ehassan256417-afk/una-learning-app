// Copies pdf.js's web worker into /public so the browser can load it from this
// site (no third-party CDN). Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs');
console.log('pdf.js worker copied to public/pdf.worker.min.mjs');
