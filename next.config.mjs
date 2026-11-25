/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Wildcarded on purpose: the studio photos live in Supabase public storage,
    // and the project ref is configuration, not a constant. Matching any
    // Supabase host keeps this working if the project ever changes without
    // pinning the ref here — which is exactly what studio-photos.ts avoids.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
