# Una sola imagen para los cuatro servicios; docker-compose.yml elige cuál arranca cada contenedor
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY shared ./shared
COPY services ./services
USER node
