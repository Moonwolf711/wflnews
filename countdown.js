'use strict';

// Set only after the release is confirmed: YYYY-MM-DDTHH:mm:ssZ (UTC).
// No calendar date or publisher timezone has been announced for Issue 001.
const RELEASE_AT = null;

function releaseState(releaseAt, now = Date.now()) {
    const target = typeof releaseAt === 'string' ? Date.parse(releaseAt) : NaN;
    const valid = typeof releaseAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(releaseAt) &&
        Number.isFinite(target) && new Date(target).toISOString() === releaseAt.replace('Z', '.000Z');
    if (!valid) return { status: 'unscheduled' };
    if (now >= target) return { status: 'due', days: 0, hours: 0, minutes: 0 };
    // Round up so a future release never appears to have reached zero early.
    const minutes = Math.ceil((target - now) / 60000);
    return { status: 'scheduled', days: Math.floor(minutes / 1440),
        hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60 };
}

function mountCountdown(document, releaseAt, clock = Date.now, schedule = setInterval, cancel = clearInterval) {
    const countdown = document.getElementById('countdown');
    const status = document.getElementById('drop-status');
    const releaseTime = document.getElementById('release-time');
    let timer;
    function update() {
        const state = releaseState(releaseAt, clock());
        countdown.hidden = state.status !== 'scheduled';
        if (state.status === 'unscheduled') {
            status.textContent = 'Release date to be announced.';
            releaseTime.hidden = true;
        } else {
            releaseTime.hidden = false;
            releaseTime.dateTime = releaseAt;
            releaseTime.textContent = new Intl.DateTimeFormat('en-US', {
                timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long',
                day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
            }).format(new Date(releaseAt));
            const message = state.status === 'due'
                ? 'The scheduled release time has arrived. Check back for Issue No. 001.'
                : 'Scheduled release:';
            if (status.textContent !== message) status.textContent = message;
            document.getElementById('cd-days').textContent = String(state.days);
            document.getElementById('cd-hours').textContent = String(state.hours).padStart(2, '0');
            document.getElementById('cd-mins').textContent = String(state.minutes).padStart(2, '0');
        }
        if (state.status !== 'scheduled' && timer !== undefined) cancel(timer);
        return state.status;
    }
    if (update() === 'scheduled') timer = schedule(update, 1000);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { releaseState, mountCountdown };
if (typeof document !== 'undefined') mountCountdown(document, RELEASE_AT);
