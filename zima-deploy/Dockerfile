FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.js signup.js index.html wfl-landing.html styles.css ./
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.js"]
