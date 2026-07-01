FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat curl
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat curl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat curl
COPY --from=builder /app/apps/web/.next apps/web/.next
COPY --from=builder /app/apps/web/public apps/web/public
COPY --from=builder /app/apps/web/package.json apps/web/package.json
COPY --from=builder /app/apps/web/prisma apps/web/prisma
COPY --from=builder /app/apps/web/scripts apps/web/scripts
COPY --from=builder /app/apps/web/src apps/web/src
COPY --from=builder /app/apps/web/tsconfig.json apps/web/tsconfig.json
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run db:seed && npm run start"]
