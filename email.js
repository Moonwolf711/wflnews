'use strict';

// type=email is ASCII-only and allows dotless domains. One rule for the page
// and the server: trim, compose, case-fold, and require a dotted domain.
// Unquoted mailbox atoms, then hostname labels. A mailto prefix, bracket,
// comma, or hyphen at a label edge cannot be delivered.
const atom = "[\\p{L}\\p{M}\\p{N}!#$%&'*+\\-/=?^_`{|}~\\u2018\\u2019]";
const label = "[\\p{L}\\p{N}](?:[\\p{L}\\p{M}\\p{N}-]*[\\p{L}\\p{M}\\p{N}])?";
const deliverable = new RegExp(`^${atom}+(?:\\.${atom}+)*@${label}(?:\\.${label})+$`, 'u');

function canonicalEmail(value) {
    if (typeof value !== 'string') return '';
    const email = value.trim().normalize('NFC').toLowerCase();
    if (email.length === 0 || email.length > 254) return '';
    // Dots must separate non-empty labels. A trailing or doubled dot cannot be delivered.
    if (!deliverable.test(email)) return '';
    // Format, control, and bidi characters would store one address that looks like another.
    if (/\p{Cc}|\p{Cf}/u.test(email)) return '';
    return email;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { canonicalEmail };
