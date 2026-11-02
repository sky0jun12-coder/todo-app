# 빌드 컨텍스트는 저장소 루트다. (워크스페이스 lock 파일이 필요하다)
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci --no-audit --no-fund -w web

COPY web web
RUN npm run build:static -w web


# 정적 파일을 Nginx로 제공한다.
FROM nginx:stable-alpine

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/out /usr/share/nginx/html

EXPOSE 80
