/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared types live as raw .ts in packages/shared. Tell Next/webpack
  // to transpile them rather than expecting a pre-built dist.
  transpilePackages: ['@trailhead/shared'],
};

export default nextConfig;
