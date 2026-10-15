'use strict';

// type=email is ASCII-only and allows dotless domains. One rule for the page
// and the server: trim, compose, case-fold, and require a dotted domain.
function canonicalEmail(value) {
    if (typeof value !== 'string') return '';
    const email = value.trim().normalize('NFC').toLowerCase();
    if (email.length === 0 || email.length > 254) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
    // Format and bidi characters would store one address that looks like another.
    if (/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/.test(email)) return '';
    return email;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { canonicalEmail };
