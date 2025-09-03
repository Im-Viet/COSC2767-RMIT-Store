# RMIT Store - Frontend (webpack-dev-server)
FROM node:22-alpine
WORKDIR /app

# Install dev dependencies
COPY client/package*.json ./
RUN npm ci

# Copy source
COPY client/ ./

# API URL is consumed by dotenv-webpack at dev-server start.
# We write .env dynamically from the container env (API_URL)
ARG API_URL=/api
RUN sed -i "s|^API_URL=.*|API_URL=${API_URL}|" .env || echo "API_URL=${API_URL}" >> .env

# Helper entrypoint writes .env then launches webpack-dev-server
COPY client/docker-entrypoint.sh /usr/local/bin/entry.sh
RUN chmod +x /usr/local/bin/entry.sh

# Expose dev server port
EXPOSE 8080

CMD ["sh", "-lc", "/usr/local/bin/entry.sh"]
