# Deploy WFL to ZimaCube

The site now saves email signups through its own Node server. Static Nginx hosting
alone cannot accept subscriptions; both landing pages need this server.

## Docker Compose

Copy the complete repository to your ZimaCube, then run from its root:

```sh
docker compose -f zima-deploy/docker-compose.yml up -d --build
```

Open `http://<ZIMA-IP>:8080`. Route your existing HTTPS Cloudflare tunnel to this
port for public access. The named `wfl-subscribers` volume preserves signup records
across container replacement. Back it up and do not run `docker compose down -v`
unless you intend to delete those records.

## Without Docker

Use Node 20 or newer. There are no third-party dependencies.

```sh
npm test
npm start
```

`PORT` defaults to `8080`. `DATA_DIR` defaults to `./data` beside `server.js`;
set it to a persistent, writable directory in production. The server runs as the
unprivileged `node` user in Docker.

## Subscriber records

`DATA_DIR/subscribers.jsonl` stores one JSON record per address, with email consent
and an ISO signup timestamp. Email addresses are normalized and duplicates are
ignored, including after a restart. The server only confirms success after the
record has been written and synced. Subscriber files are never served publicly,
logged, or committed to Git.

This completes the signup list, not newsletter delivery: export the private records
to your chosen email platform when preparing the first issue. Protect exported
subscriber data. No email-provider credentials are required to collect signups.
