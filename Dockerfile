FROM node:22-bookworm-slim AS dependencies
WORKDIR /app/upa

# Support native SQLite compilation when no prebuilt binary is available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists

COPY upa/package.json upa/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

FROM dependencies AS build
COPY upa/ ./
COPY ci-cd/make-artifacts.sh /app/ci-cd/make-artifacts.sh
RUN bash /app/ci-cd/make-artifacts.sh

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.version="0.0.1-initial"
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIRECTORY=/data
WORKDIR /app/upa

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists

COPY upa/package.json ./
COPY --from=production-dependencies /app/upa/node_modules ./node_modules
COPY --from=build /app/upa/dist ./dist
COPY container-scripts/entrypoint.sh /usr/local/bin/telugu-now-entrypoint

RUN chmod 755 /usr/local/bin/telugu-now-entrypoint
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/telugu-now-entrypoint"]
CMD ["node", "dist/server/index.js"]
