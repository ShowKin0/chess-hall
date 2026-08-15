FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --registry=https://registry.npmjs.org --omit=dev

COPY server.js ./
COPY public ./public

EXPOSE 1010

CMD ["node", "server.js"]
