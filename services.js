/* Wanderful — Service pages shared JS */

// Animate include cards on scroll
const cards = document.querySelectorAll('.include-card, .step');
const obs = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
      }, i * 80);
    }
  });
}, { threshold: 0.1 });

cards.forEach(c => {
  c.style.opacity = '0';
  c.style.transform = 'translateY(20px)';
  c.style.transition = 'opacity .4s ease, transform .4s cubic-bezier(.34,1.4,.64,1)';
  obs.observe(c);
});
