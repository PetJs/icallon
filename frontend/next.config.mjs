/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for wagmi/viem — they ship ESM-only packages
  transpilePackages: ["@rainbow-me/rainbowkit"],

  webpack: (config) => {
    // viem + wagmi use Node.js built-ins that don't exist in browser bundles.
    // Tell webpack to treat them as empty modules on the client side.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
