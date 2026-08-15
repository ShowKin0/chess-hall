FROM node:20-alpine

WORKDIR /app

COPY server_v3.js ./
COPY public ./public

EXPOSE 1010

CMD ["node", "server_v3.js"]
