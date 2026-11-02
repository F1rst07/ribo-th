/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  distDir: process.env.RIBO_BUILD_DIR || ".next",
};

export default nextConfig;
