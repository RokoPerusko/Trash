# TAK karta: Node bez npm ovisnosti, pa slika sadrzi samo izvorni kod i Node.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# samo ono sto aplikacija treba (vidi .dockerignore: .env, data, .git... nikad ne ulaze u sliku)
COPY --chown=node:node package.json server.js ots-client.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public

# zone i rute: jedina mapa u koju aplikacija pise
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

CMD ["node", "server.js"]
