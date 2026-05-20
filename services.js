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

// === PORTFOLIO VIDEO SOUND TOGGLE ===
// Adds a sound button to each portfolio video. When clicked, unmutes that video
// and pauses/mutes all others (only one with sound at a time).
document.querySelectorAll('.portfolio-item video').forEach(video => {
  const item = video.closest('.portfolio-item');
  const btn = document.createElement('button');
  btn.className = 'video-sound-btn';
  btn.type = 'button';
  btn.innerHTML = '🔇';
  btn.setAttribute('aria-label', 'Activer le son');
  item.appendChild(btn);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.muted) {
      // Mute all other videos first
      document.querySelectorAll('.portfolio-item video').forEach(v => {
        if (v !== video) {
          v.muted = true;
          const otherBtn = v.parentElement.querySelector('.video-sound-btn');
          if (otherBtn) otherBtn.innerHTML = '🔇';
        }
      });
      video.muted = false;
      video.currentTime = 0; // restart from beginning so user hears full audio
      video.play();
      btn.innerHTML = '🔊';
      btn.setAttribute('aria-label', 'Couper le son');
    } else {
      video.muted = true;
      btn.innerHTML = '🔇';
      btn.setAttribute('aria-label', 'Activer le son');
    }
  });
});
