FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 🔥 FORCE execution (no npm abstraction)
CMD ["node", "bot.js"]