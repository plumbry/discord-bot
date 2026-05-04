FROM node:20-alpine

WORKDIR /app

# Copy EVERYTHING first (important)
COPY . .

# Install deps AFTER copy (ensures files exist)
RUN npm install

# Debug: list files in container
RUN ls -la

# Force execution
CMD ["node", "bot.js"]