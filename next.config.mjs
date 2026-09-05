/**
 * Static export. When deployed to a GitHub Pages project site the app lives under
 * /<repo>/, so the CI sets NEXT_PUBLIC_BASE_PATH=/<repo> before building.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
};
export default nextConfig;
