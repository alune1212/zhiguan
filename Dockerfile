FROM oven/bun:1.4.0 AS web
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY scripts/check-dependencies.mjs scripts/check-dependencies.mjs
RUN bun ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src src
RUN bun run build

FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY scripts/jev_server.py scripts/jev_conversation.py scripts/
COPY --from=web /app/dist dist
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4174/', timeout=2)"
CMD ["python", "scripts/jev_server.py"]
