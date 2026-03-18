// Nav toggle for mobile
const toggle = document.querySelector('.nav-toggle');
const links  = document.querySelector('.nav-links');

toggle.addEventListener('click', () => {
  links.classList.toggle('open');
});

// Close nav when a link is clicked
links.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => links.classList.remove('open'));
});

// Scroll-triggered fade-in for sections
const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.08 }
);

document.querySelectorAll(
  '.char-card, .scene-item, .interact-card, .culture-card, .env-item, .stat-card, .arc-step'
).forEach(el => {
  el.classList.add('fade-target');
  observer.observe(el);
});
