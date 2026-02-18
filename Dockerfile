FROM node:20-slim

WORKDIR /app

# Copy package files first (important for cache)
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy the rest of the app
COPY . .

# Start the bot
CMD ["node", "bot.js"]
