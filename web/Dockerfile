# La web: se compila con Vite y la sirve nginx, que reenvía /api y /events al gateway.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src src
COPY chrome/bookmarklet chrome/bookmarklet
RUN npx vite build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
