// Nav toggle
const toggle = document.querySelector('.nav-toggle');
const links  = document.querySelector('.nav-links');
toggle.addEventListener('click', () => links.classList.toggle('open'));
links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));

// Scroll fade-in
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.06 });

document.querySelectorAll(
  '.char-card, .scene-item, .interact-card, .culture-card, .env-item, .stat-card, .arc-step'
).forEach(el => {
  el.classList.add('fade-target');
  observer.observe(el);
});

// Navbar hide on scroll down, show on scroll up
let lastY = 0;
const nav = document.getElementById('navbar');
nav.style.transition = 'transform 0.35s ease';
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  nav.style.transform = (y > 80 && y > lastY) ? 'translateY(-100%)' : 'translateY(0)';
  lastY = y;
}, { passive: true });

// Random flicker on scene numbers
document.querySelectorAll('.scene-number').forEach(el => {
  el.style.transition = 'opacity 0.08s';
  setInterval(() => {
    if (Math.random() < 0.05) {
      el.style.opacity = '0.15';
      setTimeout(() => el.style.opacity = '', 60 + Math.random() * 100);
    }
  }, 1500 + Math.random() * 3500);
});
