'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { releaseState, mountCountdown } = require('../countdown');
const release = '2026-10-16T18:00:00Z'; // Fixture only; no production date is asserted.

test('missing, ambiguous, and invalid dates never invent a release', () => {
    for (const value of [null, '', 'Friday', '2026-10-16T12:00:00', '2026-02-30T12:00:00Z', '2026-13-01T12:00:00Z']) {
        assert.deepEqual(releaseState(value), { status: 'unscheduled' });
    }
});

test('fixed release has accurate remaining time and never rolls forward at or after zero', () => {
    const target = Date.parse(release);
    assert.deepEqual(releaseState(release, target - (1440 + 125) * 60000), { status: 'scheduled', days: 1, hours: 2, minutes: 5 });
    assert.deepEqual(releaseState(release, target - 1), { status: 'scheduled', days: 0, hours: 0, minutes: 1 });
    for (const now of [target, target + 1, target + 7 * 86400000]) {
        assert.deepEqual(releaseState(release, now), { status: 'due', days: 0, hours: 0, minutes: 0 });
    }
});

test('visitor timezone and daylight-saving boundaries do not change the release instant', () => {
    const originalTZ = process.env.TZ;
    try {
        const states = ['UTC', 'America/Denver', 'Pacific/Auckland'].map(timeZone => {
            process.env.TZ = timeZone;
            return releaseState('2026-11-01T08:00:00Z', Date.parse('2026-11-01T06:00:00Z'));
        });
        for (const state of states) assert.deepEqual(state, { status: 'scheduled', days: 0, hours: 2, minutes: 0 });
    } finally {
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
    }
});

function documentStub() {
    const elements = Object.fromEntries(['countdown', 'drop-status', 'release-time', 'cd-days', 'cd-hours', 'cd-mins'].map(id => [id, { hidden: false, textContent: '' }]));
    return { elements, getElementById: id => elements[id] };
}

test('rendered timer identifies UTC, stops when due, and does not announce publication', () => {
    const document = documentStub();
    let now = Date.parse(release) - 1000;
    let tick;
    let cancelled;
    mountCountdown(document, release, () => now, callback => { tick = callback; return 42; }, id => { cancelled = id; });
    assert.equal(document.elements.countdown.hidden, false);
    assert.match(document.elements['release-time'].textContent, /UTC/);
    assert.equal(document.elements['release-time'].dateTime, release);
    now += 1000;
    tick();
    assert.equal(cancelled, 42);
    assert.equal(document.elements.countdown.hidden, true);
    assert.match(document.elements['drop-status'].textContent, /Check back/);
    assert.equal(document.elements['cd-mins'].textContent, '00');
});

test('unannounced release hides timer and creates no polling interval', () => {
    const document = documentStub();
    mountCountdown(document, null, Date.now, () => assert.fail('must not poll without a release'));
    assert.equal(document.elements.countdown.hidden, true);
    assert.equal(document.elements['release-time'].hidden, true);
    assert.equal(document.elements['drop-status'].textContent, 'Release date to be announced.');
});

test('both entry pages retain matching release markup, honest fallback, and unpublished archive metadata', () => {
    const pages = ['index.html', 'wfl-landing.html'].map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    const section = html => html.match(/        <!-- Next Drop Countdown -->[\s\S]*?(?=        <!-- Categories -->)/)[0];
    assert.equal(section(pages[0]), section(pages[1]));
    for (const page of pages) {
        assert.match(page, /<script src="countdown.js" defer><\/script>/);
        assert.match(page, /id="countdown" hidden/);
        assert.match(page, /Release date to be announced\./);
        assert.match(page, /"creativeWorkStatus": "Not yet published"/);
        assert.doesNotMatch(page, /nextDrop|next Friday drop|Issue No\. 001 — Friday/);
    }
});
