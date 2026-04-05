
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
        destination: 'http://127.0.0.1:8000/api/generate-bom',
      },
      {
        source: '/api/upload-pricing',
        destination: 'http://127.0.0.1:8000/api/upload-pricing',
      },
      {
        source: '/api/manufacturer-config',
        destination: 'http://127.0.0.1:8000/api/manufacturer-config',
      },
      {
        source: '/api/db-check',
        destination: 'http://127.0.0.1:8000/api/db-check',
      },
    ];
  },
};


export default nextConfig;
