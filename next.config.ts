import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  turbopack: {
    root: process.cwd(),
  },
  outputFileTracingIncludes: {
    "/api/openapi": ["./docs/openapi.yaml"],
  },
};

export default withWorkflow(nextConfig);
