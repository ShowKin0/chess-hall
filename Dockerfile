FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN echo "zero-dependency build (no npm install needed)"

COPY server.js ./
COPY public ./public

EXPOSE 1010

CMD ["node", "server.js"]
