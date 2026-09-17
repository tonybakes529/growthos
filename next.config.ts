import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // Pin the root: a stray package-lock.json in a parent directory otherwise makes Next trace from there.
  outputFileTracingRoot: path.resolve(__dirname),
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
};
export default config;
