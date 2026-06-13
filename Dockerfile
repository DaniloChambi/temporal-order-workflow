# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependencias primero (capa cacheable)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copiar fuentes y compilar TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Solo instalar dependencias de producción
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copiar artefactos compilados del stage anterior
COPY --from=builder /app/lib ./lib

# Usuario no-root por seguridad
RUN addgroup -g 1001 -S temporal && \
    adduser -S temporal -u 1001
USER temporal

# El worker no expone puertos (solo se conecta al servidor Temporal via gRPC)
# CMD se define en docker-compose.yml para poder reusar la imagen para otros comandos
CMD ["node", "lib/worker.js"]
