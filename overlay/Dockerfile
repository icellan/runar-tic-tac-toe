FROM node:20-slim

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files and local SDK tarball
COPY package.json package-lock.json* ./
COPY runar-sdk-0.2.0.tgz ./

# Install dependencies (package.json already points runar-sdk at the local tarball)
RUN npm install --omit=dev

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 8081

CMD ["npx", "tsx", "src/index.ts"]
