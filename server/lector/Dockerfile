# Lector de cuotas: imagen de Playwright (trae Chromium y sus librerías). El lector de cada casa
# (electron/bookmarklet/marcador.js) se monta en /lector-src desde docker-compose.yml.
FROM mcr.microsoft.com/playwright:v1.49.0-noble
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY runner.js ./
USER pwuser
CMD ["node", "runner.js"]
