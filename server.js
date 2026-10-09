'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');

const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/wfl-landing.html', ['wfl-landing.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/countdown.js', ['countdown.js', 'text/javascript; charset=utf-8']],
    ['/signup.js', ['signup.js', 'text/javascript; charset=utf-8']]
]);

async function createServer({ dataDir = process.env.DATA_DIR || path.join(__dirname, 'data') } = {}) {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(dataDir, 'subscribers.jsonl');
    const emails = new Set();
    try {
        for (const line of (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean)) {
            emails.add(JSON.parse(line).email);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    let writes = Promise.resolve();
    function reply(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
    }
    return http.createServer(async (req, res) => {
        try {
            const pathname = new URL(req.url, 'http://localhost').pathname;
            if (pathname === '/api/subscribe') {
                if (req.method !== 'POST') {
                    res.setHeader('Allow', 'POST');
                    return reply(res, 405, { error: 'Use POST to subscribe.' });
                }
                if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
                    return reply(res, 415, { error: 'Send JSON.' });
                }
                let body = '';
                for await (const chunk of req) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 4096) return reply(res, 413, { error: 'Request too large.' });
                }
                let input;
                try { input = JSON.parse(body); }
                catch { return reply(res, 400, { error: 'Invalid JSON.' }); }
                const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
                if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || input?.consent !== true) {
                    return reply(res, 400, { error: 'Enter a valid email and agree to receive the Lowdown.' });
                }
                // Serialize writes so simultaneous retries cannot create duplicate records.
                const write = writes.then(async () => {
                    if (emails.has(email)) return;
                    const handle = await fs.open(file, 'a', 0o600);
                    try {
                        await handle.writeFile(JSON.stringify({ email, consent: true, subscribedAt: new Date().toISOString() }) + '\n');
                        await handle.sync();
                    } finally { await handle.close(); }
                    emails.add(email);
                });
                writes = write.catch(() => {});
                await write;
                return reply(res, 200, { subscribed: true });
            }
            const asset = assets.get(pathname);
            if (!asset) return reply(res, 404, { error: 'Not found.' });
            if (!['GET', 'HEAD'].includes(req.method)) {
                res.setHeader('Allow', 'GET, HEAD');
                return reply(res, 405, { error: 'Method not allowed.' });
            }
            const content = await fs.readFile(path.join(__dirname, asset[0]));
            res.writeHead(200, { 'Content-Type': asset[1], 'X-Content-Type-Options': 'nosniff' });
            res.end(req.method === 'HEAD' ? undefined : content);
        } catch {
            reply(res, 503, { error: 'Signup is temporarily unavailable. Please try again.' });
        }
    });
}

if (require.main === module) {
    createServer().then(server => {
        server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('WFL server listening'));
    }).catch(() => {
        console.error('Cannot initialize subscriber storage. Check DATA_DIR permissions and contents.');
        process.exitCode = 1;
    });
}
module.exports = { createServer };
