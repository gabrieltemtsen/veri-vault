/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir:
    process.env.NODE_ENV === "production" && !process.env.VERCEL
      ? ".next-build"
      : ".next",
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Clear-Site-Data",
            value: '"cache", "storage"',
          },
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
