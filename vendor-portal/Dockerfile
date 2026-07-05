FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --frozen-lockfile || npm install
COPY . .
# basePath build-time (W2-05): default '/ncc' cho main server; domain riêng build --build-arg APP_BASE_PATH=""
ARG APP_BASE_PATH=/ncc
ENV APP_BASE_PATH=$APP_BASE_PATH
# V-02: cùng giá trị cho FE đọc qua process.env (lib/base-path.ts) — dùng cho các
# redirect tuyệt đối window.location.href/redirect() mà Next không tự chèn basePath.
ENV NEXT_PUBLIC_BASE_PATH=$APP_BASE_PATH
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
