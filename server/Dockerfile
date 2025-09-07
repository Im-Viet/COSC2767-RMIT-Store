# RMIT Store - Backend (Dev server with nodemon)
FROM node:22-alpine
WORKDIR /app

# Install dev dependencies (no NODE_ENV=production here)
COPY server/package*.json ./
RUN npm ci

# Copy source
COPY server/ ./

# Runtime env - bind to all interfaces so K8s can reach it
ENV NODE_ENV=development
ENV HOST=0.0.0.0
ENV PORT=3000

# Expose backend port
EXPOSE 3000

# Start dev server (nodemon)
CMD ["npm", "run", "dev"]
