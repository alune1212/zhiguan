FROM oven/bun:1.4.0 AS web
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY scripts/check-dependencies.mjs scripts/check-dependencies.mjs
RUN bun ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src src
RUN bun run build

FROM oven/bun:1.4.0
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY scripts/check-dependencies.mjs scripts/check-dependencies.mjs
RUN bun install --frozen-lockfile --production
COPY server server
COPY src src
COPY --from=web /app/dist dist
ENV NODE_ENV=production
EXPOSE 4174
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && chown -R app:app /app
USER app
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD bun -e "const response = await fetch('http://127.0.0.1:4174/'); if (!response.ok) process.exit(1)"
CMD ["bun", "server/main.ts"]
