FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/index.ts --outdir dist --target bun

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
EXPOSE 3001
ENV PORT=3001
CMD ["bun", "run", "dist/index.js"]
