import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";

// 배포할 때는 정적 파일로 빌드해 Nginx가 제공하고, /api/* 전달도 Nginx가 맡는다.
const staticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = staticExport
  ? { output: "export" }
  : {
      // 개발할 때는 Next.js 개발 서버가 /api/* 를 API 티어로 전달한다.
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
      },
    };

export default nextConfig;
