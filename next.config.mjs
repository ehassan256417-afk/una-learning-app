// GitHub Pages serves static files from /<repo-name>/, so the Pages build
// (GITHUB_PAGES=true) exports static HTML under that base path. Local dev and
// normal builds are unaffected.
const forPages = process.env.GITHUB_PAGES === 'true';
const basePath = forPages ? process.env.PAGES_BASE_PATH || '' : '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The floating dev badge covers the bottom navigation on phone-sized screens.
  devIndicators: false,
  // Lets browser code find static files (the pdf.js worker) under the base path.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  ...(forPages && {
    output: 'export',
    basePath,
    trailingSlash: true,
  }),
};

export default nextConfig;
