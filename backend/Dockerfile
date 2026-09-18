# ---- CloudGuard AI backend -------------------------------------------------
# Build context is the repository root so the seeded scenario data under
# ./data can be baked into the image. See docker-compose.yml.
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so this layer is cached between source edits.
COPY backend/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# Application source and the seeded simulation data.
COPY backend/src ./src
COPY data ./data

ENV PORT=5000 \
    DATA_DIR=/app/data/scenarios

EXPOSE 5000

# Health check the compose file depends on before starting the frontend.
HEALTHCHECK --interval=10s --timeout=4s --start-period=8s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "src/server.js"]
