# 빌드 컨텍스트는 저장소 루트다. (워크스페이스 lock 파일과 마이그레이션이 필요하다)
FROM node:24-alpine

# 마이그레이션 스크립트가 psql을 사용한다.
RUN apk add --no-cache postgresql-client

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --no-audit --no-fund -w api

COPY api/src api/src
COPY scripts/env.mjs scripts/postgres.mjs scripts/migrate.mjs scripts/
COPY db/migrations db/migrations

# 컨테이너 밖(웹 컨테이너)에서 접속할 수 있도록 모든 주소에서 받는다.
ENV API_HOST=0.0.0.0
ENV API_PORT=4000
EXPOSE 4000

USER node

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 마이그레이션을 적용한 뒤 시작한다. exec로 종료 신호가 node에 바로 전달되게 한다.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node api/src/server.js"]
