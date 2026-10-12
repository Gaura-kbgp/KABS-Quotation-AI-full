
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* Optimized for production deployment */
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  experimental: {
    workerThreads: false,
    cpus: 1,
    // Middleware (matches /api/*) buffers request bodies; the 10MB default cut off
    // large spec-book / pricing PDF uploads ("Failed to parse body as FormData").
    middlewareClientMaxBodySize: '50mb',
  },
  // Baseline security headers — none were set before. A full Content-Security-Policy
  // is deliberately left out here: this app loads Google OAuth, Supabase storage
  // images, and third-party fonts/scripts, and a wrong CSP silently breaks those
  // rather than failing loudly, so it needs its own dedicated pass with real
  // testing against every page, not a drive-by addition in a broader security sweep.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};


export default nextConfig;
