# ---------- Stage 1: Build ----------
FROM node:20-alpine AS builder

# Create app directory
WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./

# Install dependencies (include dev for build)
RUN npm install --legacy-peer-deps

# Copy the rest of the app
COPY . .

# Build the app and prune dev deps
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

# ---------- Stage 2: Runtime ----------
FROM node:20-alpine

WORKDIR /app

# Install ffmpeg for video processing
RUN apk add --no-cache ffmpeg

# Copy only the built app + node_modules from builder
COPY --from=builder /app /app

# Expose port
EXPOSE 8081

# Start the app
CMD ["npm", "start"]
