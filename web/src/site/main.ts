import '../fonts';
import './site.css';

// Mobile nav
const toggle = document.querySelector<HTMLButtonElement>('.nav-toggle');
const links = document.getElementById('nav-links');
toggle?.addEventListener('click', () => {
  const open = links?.classList.toggle('open') ?? false;
  toggle.setAttribute('aria-expanded', String(open));
});
links?.querySelectorAll('a').forEach((a) =>
  a.addEventListener('click', () => {
    links.classList.remove('open');
    toggle?.setAttribute('aria-expanded', 'false');
  }),
);

document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = String(new Date().getFullYear())));

// Early-access form
const form = document.getElementById('lead-form') as HTMLFormElement | null;
const msg = document.getElementById('lead-msg');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!msg) return;
  const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
  const email = data.email?.trim() ?? '';
  if (!data.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msg.className = 'form-msg err';
    msg.textContent = 'Please add your name and a valid email.';
    (form.querySelector(data.name?.trim() ? '#f-email' : '#f-name') as HTMLInputElement | null)?.focus();
    return;
  }
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Sending…';
  }
  try {
    const res = await fetch('/public/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Something went wrong. Please try again.');
    form.reset();
    msg.className = 'form-msg ok';
    msg.textContent = 'Thanks! We’ll be in touch within two working days.';
  } catch (err) {
    msg.className = 'form-msg err';
    msg.textContent = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Request early access';
    }
  }
});
