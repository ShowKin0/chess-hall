FROM node:20-alpine

WORKDIR /app

COPY server_v3.js ./
COPY public ./public
COPY tools ./tools
RUN node tools/generate_audio.js

EXPOSE 1010

CMD ["node", "server_v3.js"]
