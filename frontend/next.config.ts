
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
};


export default nextConfig;
