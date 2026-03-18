FROM oven/bun:1

WORKDIR /app

COPY . .

# HERE WE SHOULD USE SOMETHING LIKE THE uv sync IN PYTHON

RUN bun install
RUN bun run css

CMD ["bun", "run", "app"]
