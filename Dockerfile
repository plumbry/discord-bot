# Use a stable, supported Node version for discord.js
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy dependency manifests first (better caching)
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy the rest of the project
COPY . .

# Start the bot
CMD ["node", "bot.js"]
