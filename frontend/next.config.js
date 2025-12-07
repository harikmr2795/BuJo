/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Optimize compilation performance
  swcMinify: true,
  compiler: {
    // Remove console logs in production
    removeConsole: process.env.NODE_ENV === 'production',
  },
  // Reduce file watching overhead in WSL
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Optimize file watching for WSL
      config.watchOptions = {
        poll: 1000, // Check for changes every second
        aggregateTimeout: 300, // Delay before rebuilding
        ignored: /node_modules/,
      }
    }
    return config
  },
}

module.exports = nextConfig

