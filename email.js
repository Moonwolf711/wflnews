'use strict';

// type=email is ASCII-only and allows dotless domains. One rule for the page
// and the server: trim, compose, case-fold, and require a dotted domain.
// Unquoted mailbox atoms, then hostname labels. A mailto prefix, bracket,
// comma, or hyphen at a label edge cannot be delivered.
// Fullwidth ASCII and ideographic stops look like the typed mailbox. Leaving
// them in place stores a second address, or rejects one the visitor can read.
// Halfwidth katakana (U+FF66–U+FF9F) is the same mailbox as the fullwidth kana
// it shows. The middle dot U+FF65 is not one of those letters.
// Halfwidth hangul (U+FFA1–U+FFDC) is the same mailbox as the compatibility
// jamo it shows. Full NFKC keeps going to a conjoining jamo and can glue a
// syllable those letters do not show.
// Kangxi radicals (U+2F00–U+2FD5) and CJK radical supplements U+2E9F and
// U+2EF3 are drawn as the unified ideograph. The symbol is not a letter, so
// the address the visitor can read is rejected.
// The one-dot leader (U+2024) and the small stop, plus, hyphen, and at
// (U+FE52, U+FE62, U+FE63, U+FE6B) are drawn as those mailbox signs.
// The vertical ideographic stop (U+FE12) sits above the line and is not a dot.
const atom = "[\\p{L}\\p{M}\\p{N}!#$%&'*+\\-/=?^_`{|}~\\u2018\\u2019]";
const label = "[\\p{L}\\p{N}](?:[\\p{L}\\p{M}\\p{N}-]*[\\p{L}\\p{M}\\p{N}])?";
const deliverable = new RegExp(`^${atom}+(?:\\.${atom}+)*@${label}(?:\\.${label})+$`, 'u');

function shownHalfwidthHangul(code) {
    // Unicode <narrow> targets. Not NFKC: that continues to conjoining jamo.
    const ranges = [
        [0xFFA0, 0xFFA0, 0x3164],
        [0xFFA1, 0xFFBE, 0x3131],
        [0xFFC2, 0xFFC7, 0x314F],
        [0xFFCA, 0xFFCF, 0x3155],
        [0xFFD2, 0xFFD7, 0x315B],
        [0xFFDA, 0xFFDC, 0x3161]
    ];
    for (const [start, end, shown] of ranges) {
        if (code >= start && code <= end) return String.fromCodePoint(shown + (code - start));
    }
}

function foldCompatibility(value) {
    // URL hosts treat U+3002 and U+FF61 as dots. U+FF01–U+FF5E are fullwidth ASCII.
    // U+FF66–U+FF9F unfold to fullwidth kana; NFC then composes voiced marks.
    // U+FFA0–U+FFDC unfold to the compatibility jamo those glyphs show.
    // Radicals unfold one character at a time. NFKC of the whole address would
    // also turn halfwidth hangul into conjoining jamo. Small signs fold after
    // that pass, each to the single ASCII character the glyph shows.
    const folded = value.replace(/[\u3002\uFF61\uFF66-\uFF9F\uFFA0-\uFFDC]|[\uFF01-\uFF5E]/gu, (ch) => {
        const code = ch.codePointAt(0);
        if (code === 0x3002 || code === 0xFF61) return '.';
        if (code <= 0xFF5E) return String.fromCharCode(code - 0xFEE0);
        if (code <= 0xFF9F) return ch.normalize('NFKC');
        return shownHalfwidthHangul(code) || ch;
    });
    return folded
        .replace(/[\u2E80-\u2EF3\u2F00-\u2FD5]/gu, (ch) => ch.normalize('NFKC'))
        .replace(/[\u2024\uFE52\uFE62\uFE63\uFE6B]/gu, (ch) => {
            const code = ch.codePointAt(0);
            if (code === 0xFE6B) return '@';
            if (code === 0xFE62) return '+';
            if (code === 0xFE63) return '-';
            return '.';
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
