// GitHub Pages serves static files from /<repo-name>/, so the Pages build
// (GITHUB_PAGES=true) exports static HTML under that base path. Local dev and
// normal builds are unaffected.
const forPages = process.env.GITHUB_PAGES === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The floating dev badge covers the bottom navigation on phone-sized screens.
  devIndicators: false,
  ...(forPages && {
    output: 'export',
    basePath: process.env.PAGES_BASE_PATH || '',
    trailingSlash: true,
  }),
};

export default nextConfig;
