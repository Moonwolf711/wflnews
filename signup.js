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
checkbox.addEventListener('change', updateButton);
updateButton();

form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (submitting || !form.reportValidity() || !checkbox.checked) return;
    const payload = { email: emailInput.value.trim(), consent: checkbox.checked };
    const previousEmailDisabled = emailInput.disabled;
    const previousConsentDisabled = checkbox.disabled;
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
    try {
        const response = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!response.ok || (await response.json()).subscribed !== true) throw new Error('Signup failed');
        form.style.display = 'none';
        document.getElementById('success-msg').classList.add('show');
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
    }
});
