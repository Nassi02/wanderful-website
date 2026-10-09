/* Animations des illustrations "En coulisses" (realisations.html + en/case-studies.html) */
(function(){
  var grid = document.querySelector('.work-grid');
  if (!grid || !window.IntersectionObserver) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var NS = 'http://www.w3.org/2000/svg';
  var V = '#8D7EF2', V2 = '#B4A6F3', INK = '#352B52';

  var css = ''
  + '.wa .wa-draw{transition:stroke-dashoffset var(--t,1.1s) cubic-bezier(.65,0,.35,1) var(--d,0s);}'
  + '.wa.wa-in .wa-draw{stroke-dashoffset:0!important;}'
  + '.wa .wa-pop,.wa .wa-grow,.wa .wa-drop,.wa .wa-fade{transform-box:fill-box;opacity:0;}'
  + '.wa .wa-pop{transform-origin:center;transform:scale(0);}'
  + '.wa .wa-grow{transform-origin:50% 100%;transform:scaleY(0);opacity:1;}'
  + '.wa .wa-drop{transform:translateY(-34px);}'
  + '.wa .wa-fade{transform:translateY(14px);}'
  + '.wa.wa-in .wa-pop{animation:waPop .75s cubic-bezier(.34,1.7,.64,1) var(--d,0s) forwards;}'
  + '.wa.wa-in .wa-grow{animation:waGrow .9s cubic-bezier(.34,1.5,.64,1) var(--d,0s) forwards,waBreath 2.6s ease-in-out calc(var(--d,0s) + 1.4s) infinite;}'
  + '.wa.wa-in .wa-drop{animation:waDrop .9s cubic-bezier(.34,1.6,.64,1) var(--d,0s) forwards;}'
  + '.wa.wa-in .wa-fade{animation:waFade 1.2s ease var(--d,0s) forwards;}'
  + '@keyframes waPop{to{transform:scale(1);opacity:1}}'
  + '@keyframes waGrow{to{transform:scaleY(1)}}'
  + '@keyframes waBreath{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.86)}}'
  + '@keyframes waDrop{to{transform:translateY(0);opacity:1}}'
  + '@keyframes waFade{to{transform:translateY(0);opacity:1}}'
  + '.work .viz{position:relative;}'
  + '.work .viz::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.7) 50%,transparent 70%);transform:translateX(-130%);}'
  + '.work .viz.wa-sheen::after{animation:waSheen 1.3s ease .2s;}'
  + '.work:hover .viz::after{animation:waSheen 1s ease;}'
  + '@keyframes waSheen{to{transform:translateX(130%)}}'
  + '.work:hover .wa{transform:scale(1.04);}'
  + '.work .viz svg.wa{transition:transform .5s cubic-bezier(.34,1.56,.64,1);}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function mk(tag, attrs, parent){
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function d(n, s){ n.style.setProperty('--d', s + 's'); return n; }
  function cls(n, c, s){ n.classList.add(c); return d(n, s); }
  function draw(n, s, t){
    var len = n.tagName === 'line'
      ? Math.hypot(n.x2.baseVal.value - n.x1.baseVal.value, n.y2.baseVal.value - n.y1.baseVal.value)
      : n.getTotalLength();
    n.style.strokeDasharray = len; n.style.strokeDashoffset = len;
    if (t) n.style.setProperty('--t', t + 's');
    return cls(n, 'wa-draw', s);
  }
  function glow(svg, id){
    var defs = svg.querySelector('defs') || mk('defs', {}, svg);
    var f = mk('filter', {id: id, x: '-100%', y: '-100%', width: '300%', height: '300%'}, defs);
    mk('feGaussianBlur', {stdDeviation: '2.6', result: 'b'}, f);
    var m = mk('feMerge', {}, f); mk('feMergeNode', {in: 'b'}, m); mk('feMergeNode', {in: 'SourceGraphic'}, m);
    return 'url(#' + id + ')';
  }
  /* Particule qui suit un trajet en boucle */
  function particle(svg, path, dur, begin, r, filt){
    var c = mk('circle', {r: r || 3.6, fill: '#fff', stroke: V, 'stroke-width': 2, opacity: 0}, svg);
    if (filt) c.setAttribute('filter', filt);
    mk('animateMotion', {path: path, dur: dur + 's', begin: begin + 's', repeatCount: 'indefinite', calcMode: 'paced'}, c);
    mk('animate', {attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;.12;.85;1', dur: dur + 's', begin: begin + 's', repeatCount: 'indefinite'}, c);
    return c;
  }
  /* Onde qui s'élargit en boucle */
  function ripple(svg, cx, cy, r0, r1, period, begin, color){
    var c = mk('circle', {cx: cx, cy: cy, r: r0, fill: 'none', stroke: color || V, 'stroke-width': 2, opacity: 0}, svg);
    mk('animate', {attributeName: 'r', values: r0 + ';' + r1 + ';' + r1, keyTimes: '0;.55;1', dur: period + 's', begin: begin + 's', repeatCount: 'indefinite'}, c);
    mk('animate', {attributeName: 'opacity', values: '.85;0;0', keyTimes: '0;.55;1', dur: period + 's', begin: begin + 's', repeatCount: 'indefinite'}, c);
    return c;
  }

  var builders = [
    /* 0 · SEO : la courbe se trace, une comète la parcourt, onde à l'arrivée */
    function(svg, k){
      var p = svg.querySelectorAll('path'), dot = svg.querySelector('circle');
      if (p.length < 2 || !dot) return;
      cls(p[0], 'wa-fade', .5);
      draw(p[1], 0, 1.3);
      cls(dot, 'wa-pop', 1.15);
      var g = glow(svg, 'waG' + k);
      var dd = p[1].getAttribute('d');
      ripple(svg, 282, 20, 5, 26, 2.4, 3.8);
      particle(svg, dd, 2.4, 1.4, 4, g);
      svg.appendChild(dot);
    },
    /* 1 · Ads : barres qui poussent façon égaliseur, fléchette dans la cible */
    function(svg, k){
      var bars = svg.querySelectorAll('rect'), cs = svg.querySelectorAll('circle');
      if (bars.length < 4 || cs.length < 2) return;
      for (var i = 0; i < bars.length; i++) cls(bars[i], 'wa-grow', i * .12);
      cls(cs[0], 'wa-pop', .55); cls(cs[1], 'wa-pop', .7);
      ripple(svg, 256, 30, 13, 30, 2.4, 2.05);
      var outer = mk('g', {transform: 'translate(256,30) rotate(-22)'}, svg);
      var dart = mk('g', {opacity: 0}, outer);
      mk('line', {x1: -34, y1: 0, x2: -6, y2: 0, stroke: INK, 'stroke-width': 3, 'stroke-linecap': 'round'}, dart);
      mk('polygon', {points: '-2,0 -11,-5 -11,5', fill: INK}, dart);
      mk('polygon', {points: '-34,0 -42,-6 -38,0 -42,6', fill: V2}, dart);
      mk('animateTransform', {attributeName: 'transform', type: 'translate', values: '-130 0;0 0;0 0', keyTimes: '0;.35;1', dur: '2.4s', begin: '1.2s', repeatCount: 'indefinite', calcMode: 'spline', keySplines: '.5 0 .9 .6;0 0 1 1'}, dart);
      mk('animate', {attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;.12;.8;1', dur: '2.4s', begin: '1.2s', repeatCount: 'indefinite'}, dart);
    },
    /* 2 · GA4 : l'aiguille balaie la jauge avec rebond puis "vit" en temps réel */
    function(svg, k, state){
      var p = svg.querySelectorAll('path'), needle = svg.querySelector('line'), hub = svg.querySelector('g circle');
      if (p.length < 2 || !needle) return;
      var arc = p[1], len = arc.getTotalLength();
      arc.style.strokeDasharray = len;
      var SW = 135;
      function set(a){ /* a : 0 = position finale, -135 = tout à gauche */
        needle.setAttribute('transform', 'rotate(' + a + ')');
        var prog = Math.max(0, Math.min(1, (a + SW) / SW));
        arc.style.strokeDashoffset = len * (1 - prog);
      }
      set(-SW);
      if (hub) { cls(hub, 'wa-pop', 0); hub.parentNode.appendChild(hub); }
      function elastic(t){ return t === 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * Math.PI * 3.2); }
      state.start = function(){
        var t0 = performance.now(), raf;
        function loop(now){
          var t = (now - t0) / 1000, a;
          if (t < 1.8) a = -SW + SW * elastic(t / 1.8);
          else { var u = t - 1.8; a = -9 + 6 * Math.sin(u * 1.4) + 3 * Math.sin(u * 3.7); a *= Math.min(1, u); }
          set(a);
          if (state.visible) raf = requestAnimationFrame(loop); else state.running = false;
        }
        state.running = true; raf = requestAnimationFrame(loop);
        state.resume = function(){ if (!state.running){ state.running = true; requestAnimationFrame(loop); } };
      };
    },
    /* 3 · Automatisation : les liens se tracent, des données circulent en continu */
    function(svg, k){
      var ls = svg.querySelectorAll('line'), cs = svg.querySelectorAll(':scope > circle');
      if (ls.length < 4 || cs.length < 4) return;
      draw(ls[0], .15, .5); draw(ls[1], .15, .5); draw(ls[2], .6, .5); draw(ls[3], .6, .5);
      cls(cs[0], 'wa-pop', 0); cls(cs[1], 'wa-pop', .45); cls(cs[2], 'wa-pop', .5); cls(cs[3], 'wa-pop', .95);
      var g = glow(svg, 'waG' + k);
      var A = 'M58,60 L150,32 L242,60', B = 'M58,60 L150,88 L242,60';
      ripple(svg, 58, 60, 15, 28, 1.8, 1.3, V2);
      ripple(svg, 242, 60, 15, 30, 1.8, 3.0);
      [[cs[1], 1.3], [cs[2], 1.6]].forEach(function(x){
        mk('animate', {attributeName: 'fill', values: '#fff;#fff;#CFC5FA;#fff', keyTimes: '0;.44;.52;1', dur: '1.8s', begin: x[1] + 's', repeatCount: 'indefinite'}, x[0]);
      });
      particle(svg, A, 1.8, 1.3, 3.6, g);
      particle(svg, B, 1.8, 1.6, 3.6, g);
      for (var i = 0; i < 4; i++) svg.appendChild(cs[i]);
      svg.querySelectorAll(':scope > circle[r="3.6"]').forEach(function(c){ svg.appendChild(c); });
    },
    /* 4 · Backlinks : le réseau se déploie, les liens convergent vers le site */
    function(svg, k){
      var ls = svg.querySelectorAll('line'), sats = svg.querySelectorAll('g circle'), hub = svg.querySelector(':scope > circle');
      if (ls.length < 5 || sats.length < 5 || !hub) return;
      cls(hub, 'wa-pop', 0);
      for (var i = 0; i < ls.length; i++) draw(ls[i], .25 + i * .1, .55);
      for (var j = 0; j < sats.length; j++) cls(sats[j], 'wa-pop', .6 + j * .1);
      var g = glow(svg, 'waG' + k);
      ripple(svg, 150, 60, 17, 34, 1.6, 1.9);
      for (var s = 0; s < sats.length; s++){
        var cx = sats[s].getAttribute('cx'), cy = sats[s].getAttribute('cy');
        particle(svg, 'M' + cx + ',' + cy + ' L150,60', 1.4, 1.5 + s * .32, 3.4, g);
      }
      svg.appendChild(hub);
    },
    /* 5 · Tunnel : les étages tombent en place, des prospects descendent l'entonnoir */
    function(svg, k){
      var ps = svg.querySelectorAll('polygon');
      if (ps.length < 3) return;
      for (var i = 0; i < ps.length; i++) cls(ps[i], 'wa-drop', i * .16);
      var g = glow(svg, 'waG' + k);
      var xs = [70, 230, 110, 195, 140, 90, 215];
      for (var j = 0; j < xs.length; j++){
        var x = xs[j];
        particle(svg, 'M' + x + ',-6 L' + (150 + (x - 150) * .55) + ',30 L150,70 L150,124', 2.2, 1.1 + j * .31, 3.3, g);
      }
      ripple(svg, 150, 112, 3, 16, 1.1, 1.1 + 2.2 * .85, V);
    }
  ];

  var cards = grid.querySelectorAll('.work');
  cards.forEach(function(card, i){
    var svg = card.querySelector('.viz svg'); if (!svg || !builders[i]) return;
    var state = {};
    try { svg.classList.add('wa'); builders[i](svg, i, state); } catch(e){ svg.classList.remove('wa'); return; }
    if (svg.pauseAnimations) svg.pauseAnimations();
    var started = false;
    new IntersectionObserver(function(es){
      es.forEach(function(e){
        state.visible = e.isIntersecting;
        if (e.isIntersecting){
          if (!started){
            started = true;
            setTimeout(function(){
              svg.classList.add('wa-in');
              svg.parentNode.classList.add('wa-sheen');
              if (svg.setCurrentTime) svg.setCurrentTime(0);
              if (svg.unpauseAnimations) svg.unpauseAnimations();
              if (state.start) state.start();
            }, (i % 3) * 160);
          } else {
            if (svg.unpauseAnimations) svg.unpauseAnimations();
            if (state.resume) state.resume();
          }
        } else if (started && svg.pauseAnimations) svg.pauseAnimations();
      });
    }, {threshold: .35}).observe(card);
  });
})();
