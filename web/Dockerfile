# La web: se compila con Vite y la sirve nginx, que reenvía /api y /events al gateway.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src src
COPY chrome/bookmarklet chrome/bookmarklet
RUN npx vite build
# Copia comprimida al máximo de cada fichero de texto, para el gzip_static de nginx (no comprime en cada petición)
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) -exec sh -c 'gzip -9 -c "$1" > "$1.gz"' _ {} \;

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/cabeceras.conf /etc/nginx/cabeceras.conf
COPY --from=build /app/dist /usr/share/nginx/html
