const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  poweredByHeader: false,
  // Public assessment links contain credentials; do not print raw request URLs.
  logging: { incomingRequests: false },
  // Lets CI and migration checks use an isolated cache without touching a running app.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Dev only: DTOV/Playwright hit http://127.0.0.1:3010; without this, HMR is blocked and pages never hydrate.
  allowedDevOrigins: ['127.0.0.1'],
  experimental: { agentUpgrade: 'security' },
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      // Browser gets one locale catalog on demand (lib/i18n-client.js), not all of them.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]i18n[\\/]bundled-catalogs\.js$/,
          (resource) => {
            resource.request = resource.request.replace(/bundled-catalogs\.js$/, 'bundled-catalogs.client.js');
          }
        )
      );
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
      {
        source: '/employee/:path*',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }],
      },
    ];
  },
};

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || '3035tech-9t',
  project: process.env.SENTRY_PROJECT || '30team',
  // Source maps upload only when token is present (CI/prod build)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
});
