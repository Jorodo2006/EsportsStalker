# Una sola imagen para todos los servicios de Node; docker-compose.yml elige cuál arranca cada contenedor
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY services ./services
# Motor de los Challenger (lo usa el servicio challenger): sólo el código, sin sus datos ni sus pruebas
COPY sharpex-tenis/package.json ./sharpex-tenis/
COPY sharpex-tenis/src ./sharpex-tenis/src
COPY sharpex-tenis/bin ./sharpex-tenis/bin
# Carpeta del volumen del servicio challenger: Docker copia este dueño al volumen nuevo, y el servicio no corre como root
RUN mkdir -p /data && chown node:node /data
USER node
