
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
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/generate-bom',
        destination: `${process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/generate-bom`,
      },
      {
        source: '/api/upload-pricing',
        destination: `${process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/upload-pricing`,
      },
      {
        source: '/api/manufacturer-config',
        destination: `${process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/manufacturer-config`,
      },
      {
        source: '/api/db-check',
        destination: `${process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/api/db-check`,
      },
    ];
  },
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
};


export default nextConfig;
