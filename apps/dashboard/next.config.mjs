/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared types live as raw .ts in packages/shared. Tell Next/webpack
  // to transpile them rather than expecting a pre-built dist.
  transpilePackages: ['@trailhead/shared'],
  // Next 16.3 writes AGENTS.md and CLAUDE.md into the app directory on every
  // `next dev` unless this is off; they are not part of the repo.
  agentRules: false,
};

export default nextConfig;
