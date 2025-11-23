import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'github.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack(config) {
    config.resolve ??= {}
    config.resolve.alias ??= {}
    config.resolve.alias['@vercel/sandbox'] = path.join(__dirname, 'lib/sandbox/provider.ts')
    return config
  },
}

export default nextConfig
