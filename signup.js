'use strict';

const form = document.getElementById('signup-form');
const checkbox = document.getElementById('agree-check');
const emailInput = document.getElementById('email-input');
const submitBtn = document.getElementById('submit-btn');
const errorMsg = document.getElementById('signup-error');
let submitting = false;

function updateButton() {
    submitBtn.disabled = submitting || !checkbox.checked;
}
checkbox.addEventListener('change', function () {
    updateButton();
    if (!checkbox.checked) return;
    checkbox.removeAttribute('aria-invalid');
    checkbox.removeAttribute('aria-describedby');
    // Enter asks for the box, then leaves that alert up after the visitor agrees.
    if (errorMsg.textContent === 'Check the box to agree to receive the Weekly Festival Lowdown by email.') {
        errorMsg.textContent = '';
    }
});
updateButton();

// Enter in the email field looks for a submit button. That button stays
// disabled until consent, so an unchecked box never hears the key.
emailInput.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || submitting || checkbox.checked) return;
    // IME uses Enter to confirm the character being composed. That is not a submit.
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (emailInput.validity && !emailInput.validity.valid) {
        if (typeof form.reportValidity === 'function') form.reportValidity();
        showEmailError(emailInput.validationMessage);
        return;
    }
    // type=text is valid for any non-empty value. Ask for the mailbox before consent.
    if (!canonicalEmail(emailInput.value)) {
        showEmailError();
        return;
    }
    errorMsg.textContent = 'Check the box to agree to receive the Weekly Festival Lowdown by email.';
    emailInput.removeAttribute('aria-invalid');
    emailInput.removeAttribute('aria-describedby');
    checkbox.setAttribute('aria-invalid', 'true');
    checkbox.setAttribute('aria-describedby', 'signup-error');
    if (typeof checkbox.focus === 'function') checkbox.focus({ preventScroll: true });
    revealError();
});

function revealError() {
    // The retry control can sit fully inside a short window while this line stays past the fold.
    // Webfonts then reflow the hero and can push the same line back out.
    if (typeof errorMsg.scrollIntoView !== 'function') return;
    const options = { block: 'nearest', inline: 'nearest', behavior: 'auto' };
    const scroll = () => {
        if (errorMsg.textContent) errorMsg.scrollIntoView(options);
    };
    scroll();
    const fonts = typeof document !== 'undefined' && document.fonts;
    if (fonts && typeof fonts.ready?.then === 'function') {
        fonts.ready.then(() => {
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
            else scroll();
        });
    }
}

function showEmailError(message) {
    errorMsg.textContent = message || 'Enter a valid email address.';
    emailInput.setAttribute('aria-invalid', 'true');
    emailInput.setAttribute('aria-describedby', 'signup-error');
    // The text now describes the address, so the agreement is no longer the error.
    checkbox.removeAttribute('aria-invalid');
    checkbox.removeAttribute('aria-describedby');
    if (typeof emailInput.focus === 'function') emailInput.focus({ preventScroll: true });
    revealError();
}

form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (submitting) return;
    // novalidate lets a required field reach here. Without it the browser
    // swallows the submit and a previous save error stays on screen.
    if (!form.reportValidity() || !checkbox.checked) {
        if (emailInput.validity && !emailInput.validity.valid) showEmailError(emailInput.validationMessage);
        return;
    }
    const email = canonicalEmail(emailInput.value);
    if (!email) {
        showEmailError();
        return;
    }
    emailInput.removeAttribute('aria-invalid');
    emailInput.removeAttribute('aria-describedby');
    const payload = { email, consent: checkbox.checked };
    const previousEmailDisabled = emailInput.disabled;
    const previousConsentDisabled = checkbox.disabled;
    // Disabling the active control moves focus to the document. Remember it.
    const returnFocus = document.activeElement;
    submitting = true;
    // Keep the visible form tied to the signup being confirmed.
    emailInput.disabled = true;
    checkbox.disabled = true;
    updateButton();
    errorMsg.textContent = '';
    form.setAttribute('aria-busy', 'true');
    const label = submitBtn.textContent;
    submitBtn.textContent = 'Signing up…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let succeeded = false;
    try {
        const response = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!response.ok || (await response.json()).subscribed !== true) throw new Error('Signup failed');
        succeeded = true;
        form.style.display = 'none';
        const success = document.getElementById('success-msg');
        success.classList.add('show');
        success.setAttribute('tabindex', '-1');
        if (typeof success.focus === 'function') success.focus({ preventScroll: true });
    } catch {
        errorMsg.textContent = 'We couldn’t save your signup. Please try again.';
    } finally {
        clearTimeout(timeout);
        submitting = false;
        emailInput.disabled = previousEmailDisabled;
        checkbox.disabled = previousConsentDisabled;
        form.removeAttribute('aria-busy');
        submitBtn.textContent = label;
        updateButton();
        if (!succeeded && returnFocus && typeof form.contains === 'function' && form.contains(returnFocus) && typeof returnFocus.focus === 'function') {
            returnFocus.focus({ preventScroll: true });
        }
        if (!succeeded && errorMsg.textContent) revealError();
    }
});
