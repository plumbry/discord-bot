# Use Node 20 (safe with your engines)
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy rest of the bot
COPY . .

# Start the bot
CMD ["npm", "start"]