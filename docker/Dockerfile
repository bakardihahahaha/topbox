# Build context: the repository root (see .github/workflows/ci.yml).
FROM node:20-bookworm-slim AS web-build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY packages/web packages/web
ARG GIT_SHA=dev
ENV VITE_APP_VERSION=$GIT_SHA
RUN npm run build --workspace packages/web

FROM node:20-bookworm-slim
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci --omit=dev
COPY packages/shared packages/shared
COPY packages/server/src packages/server/src
COPY packages/server/tsconfig.json packages/server/tsconfig.json
COPY --from=web-build /repo/packages/web/dist ./web-dist

# One container serves the API and the built PWA — same shape as decom/KPI/Stock Take. PDFs are
# generated in the browser, so there's no Chromium/Playwright in this image at all.
ENV NODE_ENV=production WEB_DIST_PATH=/repo/web-dist DB_PATH=/app/data/signoff.db
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "packages/server/src/main.ts"]
