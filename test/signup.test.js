'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createServer } = require('../server');

const servers = new Map();
let nextServer = 0;
async function start(dataDir) {
    const server = await createServer({ dataDir });
    const url = `http://test-${nextServer++}`;
    servers.set(url, server);
    return { url, close: async () => { servers.delete(url); } };
}
// Exercise the actual HTTP request handler without opening sockets: the managed
// workspace disallows listen(). Requests still use streams and real disk writes.
function request(url, options = {}) {
    const parsed = new URL(url);
    const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    req.url = parsed.pathname;
    req.method = options.method || 'GET';
    req.headers = Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    return new Promise(resolve => {
        const res = {
            status: 200, headers: {},
            setHeader(name, value) { this.headers[name] = value; },
            writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
            end(body) { resolve({ status: this.status, json: async () => JSON.parse(String(body)), text: async () => String(body) }); }
        };
        servers.get(parsed.origin).emit('request', req, res);
    });
}
function subscribe(url, body, headers = { 'Content-Type': 'application/json' }) {
    return request(`${url}/api/subscribe`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('signups persist, deduplicate concurrently and after restart, and stay private', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    let app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    const responses = await Promise.all(Array.from({ length: 5 }, () => subscribe(app.url, { email: ' Reader@Example.com ', consent: true })));
    for (const response of responses) assert.deepEqual(await response.json(), { subscribed: true });
    const file = path.join(dataDir, 'subscribers.jsonl');
    const saved = await fs.readFile(file, 'utf8');
    assert.equal(saved.trim().split('\n').length, 1);
    const record = JSON.parse(saved);
    assert.equal(record.email, 'reader@example.com');
    assert.equal(record.consent, true);
    assert.ok(Number.isFinite(Date.parse(record.subscribedAt)));
    await app.close();
    app = await start(dataDir);
    assert.equal((await subscribe(app.url, { email: 'reader@example.com', consent: true })).status, 200);
    assert.equal(await fs.readFile(file, 'utf8'), saved);
    for (const resource of ['/data/subscribers.jsonl', '/subscribers.jsonl', '/server.js', '/.git/config']) {
        assert.equal((await request(app.url + resource)).status, 404);
    }
    for (const resource of ['/', '/wfl-landing.html', '/styles.css', '/signup.js', '/countdown.js']) {
        assert.equal((await request(app.url + resource)).status, 200);
    }
});

test('invalid input and failed storage never report success', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    for (const body of [null, {}, { email: 'invalid', consent: true }, { email: 'a@example.com' }, { email: 'a@example.com', consent: 'true' }]) {
        assert.equal((await subscribe(app.url, body)).status, 400);
    }
    assert.equal((await subscribe(app.url, {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request(app.url + '/api/subscribe')).status, 405);
    assert.equal((await request(app.url + '/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await subscribe(app.url, { email: 'x'.repeat(5000), consent: true })).status, 413);
    await fs.mkdir(path.join(dataDir, 'subscribers.jsonl'));
    assert.equal((await subscribe(app.url, { email: 'a@example.com', consent: true })).status, 503);
    await fs.rmdir(path.join(dataDir, 'subscribers.jsonl'));
    assert.equal((await subscribe(app.url, { email: 'a@example.com', consent: true })).status, 200);
});

async function client(fetchImpl) {
    const elements = {};
    for (const id of ['signup-form', 'agree-check', 'submit-btn', 'signup-error', 'email-input', 'success-msg']) {
        elements[id] = { checked: true, value: 'reader@example.com', textContent: 'Subscribe', style: {},
            handlers: {}, classes: new Set(), attributes: {},
            addEventListener(name, callback) { this.handlers[name] = callback; },
            reportValidity() { return true; },
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; }
        };
        elements[id].classList = { add: value => elements[id].classes.add(value) };
    }
    vm.runInNewContext(await fs.readFile(path.join(__dirname, '../signup.js'), 'utf8'), {
        document: { getElementById: id => elements[id] }, fetch: fetchImpl,
        AbortController, setTimeout, clearTimeout
    });
    return { elements, submit: () => elements['signup-form'].handlers.submit({ preventDefault() {} }) };
}

test('client shows success only after confirmation and prevents parallel submissions', async () => {
    let finish;
    let calls = 0;
    const { elements, submit } = await client(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const pending = submit();
    assert.equal(elements['submit-btn'].disabled, true);
    assert.equal(elements['success-msg'].classes.has('show'), false);
    await submit();
    assert.equal(calls, 1);
    finish({ ok: true, json: async () => ({ subscribed: true }) });
    await pending;
    assert.equal(elements['signup-form'].style.display, 'none');
    assert.equal(elements['success-msg'].classes.has('show'), true);
});

test('client keeps failed signups visible and retryable, including invalid success responses', async () => {
    for (const response of [async () => { throw new Error('offline'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({}) })]) {
        const { elements, submit } = await client(response);
        await submit();
        assert.equal(elements['signup-form'].style.display, undefined);
        assert.equal(elements['success-msg'].classes.has('show'), false);
        assert.match(elements['signup-error'].textContent, /try again/);
        assert.equal(elements['submit-btn'].disabled, false);
    }
});

test('client requires explicit consent before sending', async () => {
    let calls = 0;
    const { elements, submit } = await client(() => { calls++; });
    elements['agree-check'].checked = false;
    elements['agree-check'].handlers.change();
    await submit();
    assert.equal(elements['submit-btn'].disabled, true);
    assert.equal(calls, 0);
});
