FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev
ENTRYPOINT ["node", "dist/index.js"]
