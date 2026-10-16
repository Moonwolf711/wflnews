'use strict';

// type=email is ASCII-only and allows dotless domains. One rule for the page
// and the server: trim, compose, case-fold, and require a dotted domain.
// Unquoted mailbox atoms, then hostname labels. A mailto prefix, bracket,
// comma, or hyphen at a label edge cannot be delivered.
// Fullwidth ASCII and ideographic stops look like the typed mailbox. Leaving
// them in place stores a second address, or rejects one the visitor can read.
const atom = "[\\p{L}\\p{M}\\p{N}!#$%&'*+\\-/=?^_`{|}~\\u2018\\u2019]";
const label = "[\\p{L}\\p{N}](?:[\\p{L}\\p{M}\\p{N}-]*[\\p{L}\\p{M}\\p{N}])?";
const deliverable = new RegExp(`^${atom}+(?:\\.${atom}+)*@${label}(?:\\.${label})+$`, 'u');

function foldCompatibility(value) {
    // URL hosts treat U+3002 and U+FF61 as dots. U+FF01–U+FF5E are fullwidth ASCII.
    return value.replace(/[\u3002\uFF61]|[\uFF01-\uFF5E]/gu, (ch) => {
        const code = ch.codePointAt(0);
        if (code === 0x3002 || code === 0xFF61) return '.';
        return String.fromCharCode(code - 0xFEE0);
    });
}

function canonicalEmail(value) {
    if (typeof value !== 'string') return '';
    const email = foldCompatibility(value.trim()).normalize('NFC').toLowerCase();
    if (email.length === 0 || email.length > 254) return '';
    // Dots must separate non-empty labels. A trailing or doubled dot cannot be delivered.
    if (!deliverable.test(email)) return '';
    // Controls, format characters (including bidi), and other default-ignorable marks
    // would store one address that looks like another. Controls are not all default-ignorable.
    if (/\p{Cc}|\p{Cf}|\p{Default_Ignorable_Code_Point}/u.test(email)) return '';
    return email;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { canonicalEmail };
