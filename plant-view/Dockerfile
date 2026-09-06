# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
ENV PLANT_VIEW_HOST=127.0.0.1 \
    PLANT_VIEW_PORT=3000 \
    WATTLOFT_API_URL=http://127.0.0.1:8000 \
    COOKIE_SECURE=true
CMD ["node", "dist/server.js"]
