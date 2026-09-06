# syntax=docker/dockerfile:1
# Install and compile on the host arch. QEMU-emulated Node/npm on linux/arm64
# dies with SIGILL on GitHub Actions runners. Runtime deps are JS-only, so the
# copied node_modules are valid on the target platform.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=$BUILDPLATFORM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY --from=build /app/dist ./dist
USER node
ENV PLANT_VIEW_HOST=127.0.0.1 \
    PLANT_VIEW_PORT=3000 \
    WATTLOFT_API_URL=http://127.0.0.1:8000 \
    COOKIE_SECURE=true
CMD ["node", "dist/server.js"]
