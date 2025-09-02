# RMIT Store - Frontend (webpack-dev-server)
FROM node:22-alpine
WORKDIR /app

# Install dev dependencies
COPY client/package*.json ./
RUN npm ci

# Copy source
COPY client/ ./

# Defaults for webpack-dev-server
ENV NODE_ENV=development
ENV HOST=0.0.0.0
ENV PORT=8080

# API URL is consumed by dotenv-webpack at dev-server start.
# We write .env dynamically from the container env (API_URL)
ENV API_URL=http://backend-svc:3000/api

# Helper entrypoint writes .env then launches webpack-dev-server
COPY client/docker-entrypoint.sh /usr/local/bin/entry.sh
RUN chmod +x /usr/local/bin/entry.sh

# Expose dev server port
EXPOSE 8080

# Non-root
USER node

CMD ["sh", "-lc", "/usr/local/bin/entry.sh"]
