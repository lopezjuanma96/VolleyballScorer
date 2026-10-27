FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY static ./static
RUN bun run css

FROM oven/bun:1.4.0 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/static ./static
COPY src ./src
COPY db/migrations ./db/migrations
RUN mkdir -p static/uploads && chown -R bun:bun /app
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
