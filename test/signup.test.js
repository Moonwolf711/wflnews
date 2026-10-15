'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { createServer } = require('../server');
const { canonicalEmail } = require('../email');

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
    const req = Readable.from(options.chunks || (options.body ? [Buffer.from(options.body)] : []));
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
    for (const resource of ['/', '/wfl-landing.html', '/styles.css', '/signup.js', '/countdown.js', '/email.js']) {
        assert.equal((await request(app.url + resource)).status, 200);
    }
});

test('invalid input and failed storage never report success', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    for (const body of [null, {}, { email: 'invalid', consent: true }, { email: 'user@com', consent: true }, { email: 'user@localhost', consent: true }, { email: 'reader@example.com\u200b', consent: true }, { email: 'a@example.com' }, { email: 'a@example.com', consent: 'true' }]) {
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
    const documentStub = { activeElement: null, getElementById: id => elements[id] };
    for (const id of ['signup-form', 'agree-check', 'submit-btn', 'signup-error', 'email-input', 'success-msg']) {
        elements[id] = { checked: true, disabled: false, value: 'reader@example.com', textContent: 'Subscribe', style: {},
            handlers: {}, classes: new Set(), attributes: {},
            addEventListener(name, callback) { this.handlers[name] = callback; },
            reportValidity() { return true; },
            setAttribute(name, value) { this.attributes[name] = value; },
            removeAttribute(name) { delete this.attributes[name]; },
            focus() { documentStub.activeElement = this; }
        };
        elements[id].classList = { add: value => elements[id].classes.add(value) };
    }
    elements['signup-form'].contains = node => node === elements['email-input'] || node === elements['submit-btn'] || node === elements['agree-check'];
    vm.runInNewContext(await fs.readFile(path.join(__dirname, '../signup.js'), 'utf8'), {
        document: documentStub, fetch: fetchImpl,
        canonicalEmail, AbortController, setTimeout, clearTimeout
    });
    return { elements, document: documentStub, submit: () => elements['signup-form'].handlers.submit({ preventDefault() {} }) };
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

test('pending signup locks its email and consent, then a failed request permits an edited retry', async () => {
    const requests = [];
    let finish;
    const { elements, submit } = await client((url, options) => {
        requests.push(JSON.parse(options.body));
        return new Promise(resolve => { finish = resolve; });
    });
    const pending = submit();
    assert.equal(elements['email-input'].disabled, true);
    assert.equal(elements['agree-check'].disabled, true);
    assert.deepEqual(requests, [{ email: 'reader@example.com', consent: true }]);
    finish({ ok: false });
    await pending;
    assert.equal(elements['email-input'].disabled, false);
    assert.equal(elements['agree-check'].disabled, false);
    assert.equal(elements['success-msg'].classes.has('show'), false);
    elements['email-input'].value = 'corrected@example.com';
    const retry = submit();
    assert.equal(elements['email-input'].disabled, true);
    assert.equal(elements['agree-check'].disabled, true);
    assert.deepEqual(requests[1], { email: 'corrected@example.com', consent: true });
    finish({ ok: true, json: async () => ({ subscribed: true }) });
    await retry;
    assert.equal(elements['success-msg'].classes.has('show'), true);
});


test('equivalent unicode addresses are stored once', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    let app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    const nfc = 'reader@café.example';
    const mixed = ` ${nfc.normalize('NFD').toUpperCase()} `;
    assert.notEqual(mixed.trim(), nfc);
    assert.equal(canonicalEmail(mixed), nfc);
    assert.equal((await subscribe(app.url, { email: mixed, consent: true })).status, 200);
    const file = path.join(dataDir, 'subscribers.jsonl');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).email, nfc);
    await app.close();
    app = await start(dataDir);
    assert.equal((await subscribe(app.url, { email: nfc, consent: true })).status, 200);
    const records = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 1);
    assert.equal(records[0].email, nfc);
});

test('client sends international addresses and keeps dotless domains off the request', async () => {
    const pages = await Promise.all(['index.html', 'wfl-landing.html'].map(file => fs.readFile(path.join(__dirname, '..', file), 'utf8')));
    for (const html of pages) {
        assert.match(html, /<input type="text" id="email-input"[^>]*inputmode="email"/);
        assert.match(html, /<script src="email\.js" defer><\/script>\s*<script src="signup\.js" defer><\/script>/);
        assert.doesNotMatch(html, /type="email"/);
    }
    const requests = [];
    const { elements, submit } = await client((url, options) => {
        requests.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ subscribed: true }) };
    });
    let focused = false;
    elements['email-input'].focus = () => { focused = true; };
    elements['email-input'].value = 'user@com';
    await submit();
    assert.equal(requests.length, 0);
    assert.equal(focused, true);
    assert.match(elements['signup-error'].textContent, /valid email/);
    assert.equal(elements['email-input'].attributes['aria-invalid'], 'true');
    assert.equal(elements['signup-form'].style.display, undefined);
    elements['email-input'].value = ' Reader@Café.example ';
    await submit();
    assert.deepEqual(requests, [{ email: 'reader@café.example', consent: true }]);
    assert.equal(elements['email-input'].attributes['aria-invalid'], undefined);
    assert.equal(elements['success-msg'].classes.has('show'), true);
});

test('chunk boundaries cannot corrupt UTF-8 subscriber addresses', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    const email = 'reader@café.example';
    const body = Buffer.from(JSON.stringify({ email, consent: true }));
    // Network chunks can end anywhere, including inside the two bytes of é.
    const split = body.indexOf(Buffer.from('é')) + 1;
    const response = await request(app.url + '/api/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        chunks: [body.subarray(0, split), body.subarray(split)]
    });
    assert.equal(response.status, 200);
    assert.equal((await subscribe(app.url, { email, consent: true })).status, 200);
    const records = (await fs.readFile(path.join(dataDir, 'subscribers.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 1);
    assert.equal(records[0].email, email);
});

test('empty address replaces a stale save error instead of asking for a retry', async () => {
    const pages = await Promise.all(['index.html', 'wfl-landing.html'].map(file => fs.readFile(path.join(__dirname, '..', file), 'utf8')));
    for (const html of pages) assert.match(html, /<form id="signup-form"[^>]*\snovalidate>/);
    let calls = 0;
    const { elements, submit } = await client(async () => { calls++; throw new Error('offline'); });
    await submit();
    assert.match(elements['signup-error'].textContent, /try again/);
    assert.equal(calls, 1);
    elements['email-input'].value = '';
    elements['email-input'].validity = { valid: false };
    elements['email-input'].validationMessage = 'Please fill out this field.';
    elements['signup-form'].reportValidity = () => false;
    await submit();
    assert.equal(calls, 1);
    assert.equal(elements['signup-error'].textContent, 'Please fill out this field.');
    assert.equal(elements['email-input'].attributes['aria-invalid'], 'true');
    assert.equal(elements['email-input'].attributes['aria-describedby'], 'signup-error');
    assert.equal(elements['submit-btn'].disabled, false);
    assert.equal(elements['signup-form'].style.display, undefined);
    assert.equal(elements['success-msg'].classes.has('show'), false);
    elements['email-input'].value = 'reader@example.com';
    elements['email-input'].validity = { valid: true };
    elements['email-input'].validationMessage = '';
    elements['signup-form'].reportValidity = () => true;
    await submit();
    assert.equal(calls, 2);
    assert.match(elements['signup-error'].textContent, /try again/);
    assert.equal(elements['email-input'].attributes['aria-invalid'], undefined);
    assert.equal(elements['submit-btn'].disabled, false);
});

test('consent precedes the submit button in tab order on both landing pages', async () => {
    // A disabled submit control is skipped. It has to follow the checkbox or
    // Tab leaves the form and the retry button cannot be reached going forward.
    const pages = await Promise.all(['index.html', 'wfl-landing.html'].map(file => fs.readFile(path.join(__dirname, '..', file), 'utf8')));
    for (const html of pages) {
        const email = html.indexOf('id="email-input"');
        const consent = html.indexOf('id="agree-check"');
        const submit = html.indexOf('id="submit-btn"');
        assert.ok(email !== -1 && consent !== -1 && submit !== -1);
        assert.ok(email < consent && consent < submit, 'tab order should be email, consent, then submit');
    }
    const css = await fs.readFile(path.join(__dirname, '../styles.css'), 'utf8');
    assert.match(css, /\.signup-fields\s*\{[^}]*display:\s*grid/);
    assert.match(css, /\.signup-fields \.submit-btn\s*\{[^}]*grid-row:\s*1/);
    assert.match(css, /\.signup-fields \.legal-check\s*\{[^}]*grid-row:\s*2/);
});

test('signup keeps keyboard focus on failure and moves it to the confirmation', async () => {
    const pages = await Promise.all(['index.html', 'wfl-landing.html'].map(file => fs.readFile(path.join(__dirname, '..', file), 'utf8')));
    for (const html of pages) assert.match(html, /id="success-msg"[^>]*tabindex="-1"/);
    const failed = await client(async () => { throw new Error('offline'); });
    failed.document.activeElement = failed.elements['submit-btn'];
    await failed.submit();
    assert.equal(failed.document.activeElement, failed.elements['submit-btn']);
    assert.match(failed.elements['signup-error'].textContent, /try again/);
    assert.equal(failed.elements['signup-form'].style.display, undefined);
    assert.equal(failed.elements['submit-btn'].disabled, false);

    const confirmed = await client(async () => ({ ok: true, json: async () => ({ subscribed: true }) }));
    confirmed.document.activeElement = confirmed.elements['email-input'];
    await confirmed.submit();
    assert.equal(confirmed.document.activeElement, confirmed.elements['success-msg']);
    assert.equal(confirmed.elements['success-msg'].attributes.tabindex, '-1');
    assert.equal(confirmed.elements['success-msg'].classes.has('show'), true);
    assert.equal(confirmed.elements['signup-form'].style.display, 'none');
});

test('malformed UTF-8 cannot be accepted as a different subscriber address', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    const response = await request(app.url + '/api/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        chunks: [Buffer.from('{"email":"reader@caf'), Buffer.from([0xc3]), Buffer.from('.example","consent":true}')]
    });
    assert.equal(response.status, 400);
    await assert.rejects(fs.readFile(path.join(dataDir, 'subscribers.jsonl')), { code: 'ENOENT' });
});

test('format and bidi marks cannot masquerade as another signup address', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    // Arabic letter mark, invisible times, C1 next line, Mongolian vowel separator.
    for (const mark of ['\u061C', '\u2062', '\u0085', '\u180E']) {
        const disguised = `reader${mark}@example.com`;
        assert.notEqual(disguised.normalize('NFC').toLowerCase(), 'reader@example.com');
        assert.equal(canonicalEmail(disguised), '');
        assert.equal((await subscribe(app.url, { email: disguised, consent: true })).status, 400);
    }
    await assert.rejects(fs.readFile(path.join(dataDir, 'subscribers.jsonl')), { code: 'ENOENT' });
    let calls = 0;
    const { elements, submit } = await client(() => { calls++; return { ok: true, json: async () => ({ subscribed: true }) }; });
    elements['email-input'].value = 'reader\u061C@example.com';
    let focused = false;
    elements['email-input'].focus = () => { focused = true; };
    await submit();
    assert.equal(calls, 0);
    assert.equal(focused, true);
    assert.match(elements['signup-error'].textContent, /valid email/);
    assert.equal(elements['email-input'].attributes['aria-invalid'], 'true');
    assert.equal(elements['success-msg'].classes.has('show'), false);
});

test('empty dot labels are rejected before a signup is stored or sent', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    for (const email of ['reader@example.com.', 'reader@example..com', 'reader@.example.com', '.reader@example.com', 'reader.@example.com', 'a@b..', 'user@local.host.']) {
        assert.equal(canonicalEmail(email), '');
        assert.equal((await subscribe(app.url, { email, consent: true })).status, 400);
    }
    assert.equal(canonicalEmail('  First.Last@Example.com  '), 'first.last@example.com');
    await assert.rejects(fs.readFile(path.join(dataDir, 'subscribers.jsonl')), { code: 'ENOENT' });
    let calls = 0;
    const { elements, submit } = await client(() => { calls++; return { ok: true, json: async () => ({ subscribed: true }) }; });
    elements['email-input'].value = 'reader@example.com.';
    let focused = false;
    elements['email-input'].focus = () => { focused = true; };
    await submit();
    assert.equal(calls, 0);
    assert.equal(focused, true);
    assert.match(elements['signup-error'].textContent, /valid email/);
    assert.equal(elements['email-input'].attributes['aria-invalid'], 'true');
    assert.equal(elements['success-msg'].classes.has('show'), false);
    elements['email-input'].value = 'first.last@example.com';
    await submit();
    assert.equal(calls, 1);
    assert.equal(elements['success-msg'].classes.has('show'), true);
});

test('pasted mailbox punctuation is rejected before a signup is stored or sent', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    for (const email of ['mailto:reader@example.com', '<reader@example.com>', 'reader@example.com,', 'reader@example.com>', '"reader@example.com"', 'reader@example.com;', 'user@-example.com', 'user@example-.com', 'user@example.com/path']) {
        assert.equal(canonicalEmail(email), '');
        assert.equal((await subscribe(app.url, { email, consent: true })).status, 400);
    }
    assert.equal(canonicalEmail('user+tag@example.com'), 'user+tag@example.com');
    assert.equal(canonicalEmail('first.last@example.com'), 'first.last@example.com');
    assert.equal(canonicalEmail('user@münchen.de'), 'user@münchen.de');
    await assert.rejects(fs.readFile(path.join(dataDir, 'subscribers.jsonl')), { code: 'ENOENT' });
    let calls = 0;
    const seen = [];
    const { elements, submit } = await client((url, options) => {
        calls++;
        seen.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ subscribed: true }) };
    });
    elements['email-input'].value = 'mailto:reader@example.com';
    let focused = false;
    elements['email-input'].focus = () => { focused = true; };
    await submit();
    assert.equal(calls, 0);
    assert.equal(focused, true);
    assert.match(elements['signup-error'].textContent, /valid email/);
    assert.equal(elements['email-input'].attributes['aria-invalid'], 'true');
    assert.equal(elements['success-msg'].classes.has('show'), false);
    elements['email-input'].value = 'user+tag@example.com';
    await submit();
    assert.equal(calls, 1);
    assert.deepEqual(seen, [{ email: 'user+tag@example.com', consent: true }]);
    assert.equal(elements['success-msg'].classes.has('show'), true);
});

test('default-ignorable marks cannot masquerade as another signup address', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    // Combining grapheme joiner, variation selectors, and Hangul filler are not control or format characters.
    for (const mark of ['\u034F', '\uFE0F', '\uFE00', '\u3164']) {
        const disguised = `reader${mark}@example.com`;
        assert.notEqual(disguised.normalize('NFC').toLowerCase(), 'reader@example.com');
        assert.equal(canonicalEmail(disguised), '');
        assert.equal((await subscribe(app.url, { email: disguised, consent: true })).status, 400);
    }
    assert.equal(canonicalEmail('reader@example.com\u034F'), '');
    assert.equal(canonicalEmail('first.last@example.com'), 'first.last@example.com');
    assert.equal(canonicalEmail('user+tag@example.com'), 'user+tag@example.com');
    assert.equal(canonicalEmail('user@münchen.de'), 'user@münchen.de');
    assert.equal(canonicalEmail('user@my-domain.com'), 'user@my-domain.com');
    assert.equal(canonicalEmail("O'Brien@example.com"), "o'brien@example.com");
    await assert.rejects(fs.readFile(path.join(dataDir, 'subscribers.jsonl')), { code: 'ENOENT' });
    let calls = 0;
    const { elements, submit } = await client(() => { calls++; return { ok: true, json: async () => ({ subscribed: true }) }; });
    elements['email-input'].value = 'reader\u034F@example.com';
    let focused = false;
    elements['email-input'].focus = () => { focused = true; };
    await submit();
    assert.equal(calls, 0);
    assert.equal(focused, true);
    assert.match(elements['signup-error'].textContent, /valid email/);
    assert.equal(elements['email-input'].attributes['aria-invalid'], 'true');
    assert.equal(elements['success-msg'].classes.has('show'), false);
});

test('signup errors below the fold are brought into view without moving failure focus', async () => {
    const css = await fs.readFile(path.join(__dirname, '../styles.css'), 'utf8');
    assert.match(css, /#signup-error:not\(:empty\) \{[^}]*scroll-margin:\s*39px 0 16px;/);
    function scrolledNearest(calls) {
        assert.equal(calls.length, 1);
        assert.equal(calls[0].block, 'nearest');
        assert.equal(calls[0].inline, 'nearest');
        assert.equal(calls[0].behavior, 'auto');
    }

    const failed = await client(async () => { throw new Error('offline'); });
    const failedScrolls = [];
    failed.elements['signup-error'].scrollIntoView = options => { failedScrolls.push(options); };
    let releaseFonts;
    failed.document.fonts = { ready: new Promise(resolve => { releaseFonts = resolve; }) };
    failed.document.activeElement = failed.elements['submit-btn'];
    await failed.submit();
    assert.equal(failed.document.activeElement, failed.elements['submit-btn']);
    assert.match(failed.elements['signup-error'].textContent, /try again/);
    assert.equal(failed.elements['signup-form'].style.display, undefined);
    scrolledNearest(failedScrolls);
    // A late webfont reflow can push the same line back past the fold.
    releaseFonts();
    await failed.document.fonts.ready;
    await Promise.resolve();
    assert.equal(failedScrolls.length, 2);
    assert.equal(failedScrolls[1].block, 'nearest');
    assert.equal(failedScrolls[1].behavior, 'auto');

    const invalid = await client(() => { throw new Error('should not send'); });
    const invalidScrolls = [];
    invalid.elements['signup-error'].scrollIntoView = options => { invalidScrolls.push(options); };
    invalid.elements['email-input'].value = 'not-an-email';
    let focused = false;
    invalid.elements['email-input'].focus = () => { focused = true; invalid.document.activeElement = invalid.elements['email-input']; };
    await invalid.submit();
    assert.equal(invalid.document.activeElement, invalid.elements['email-input']);
    assert.equal(focused, true);
    assert.match(invalid.elements['signup-error'].textContent, /valid email/);
    scrolledNearest(invalidScrolls);

    const confirmed = await client(async () => ({ ok: true, json: async () => ({ subscribed: true }) }));
    const confirmedScrolls = [];
    confirmed.elements['signup-error'].scrollIntoView = options => { confirmedScrolls.push(options); };
    await confirmed.submit();
    assert.deepEqual(confirmedScrolls, []);
    assert.equal(confirmed.document.activeElement, confirmed.elements['success-msg']);
    assert.equal(confirmed.elements['success-msg'].classes.has('show'), true);
});

test('request limit counts original bytes across chunks with exact boundary acceptance', async t => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wfl-test-'));
    const app = await start(dataDir);
    t.after(async () => { await app.close(); await fs.rm(dataDir, { recursive: true }); });
    const json = Buffer.from(JSON.stringify({ email: 'reader@café.example', consent: true }));
    const body = Buffer.concat([json, Buffer.alloc(4096 - json.length, ' ')]);
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    assert.equal((await request(app.url + '/api/subscribe', { ...options, chunks: [body.subarray(0, 20), body.subarray(20)] })).status, 200);
    assert.equal((await request(app.url + '/api/subscribe', { ...options, chunks: [body, Buffer.from(' ')] })).status, 413);
});
