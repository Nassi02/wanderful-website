/* Accueil — bande « Ils nous font confiance pour briller »
   - les cartes logos s'inclinent vers le curseur, avec un reflet nacre qui suit la souris
   - de petites etincelles apparaissent autour de la carte survolee (au toucher sur mobile)
   - le mot « briller » scintille
   prefers-reduced-motion : rien ne bouge. */
(function(){
  'use strict';
  var strip=document.querySelector('.trust');
  if(!strip||!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var cards=[].slice.call(strip.querySelectorAll('.logos > span'));
  if(!cards.length) return;
  var FINE=matchMedia('(hover:hover) and (pointer:fine)').matches;

  var css=document.createElement('style');
  css.textContent=[
    '.trust .logos{perspective:900px}',
    '.tf-card{position:relative!important;overflow:visible!important;transform-style:preserve-3d;',
    '  transition:transform .5s cubic-bezier(.2,.9,.3,1),box-shadow .45s ease,border-color .45s ease;will-change:transform}',
    '.tf-card>img{position:relative;z-index:1;transition:transform .5s cubic-bezier(.2,.9,.3,1),filter .4s ease}',
    '.tf-card .tf-sheen{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:2;opacity:0;transition:opacity .4s ease}',
    '.tf-card .tf-sheen::before{content:"";position:absolute;inset:-40%;',
    '  background:radial-gradient(closest-side at var(--mx,50%) var(--my,50%),rgba(255,255,255,.75),rgba(246,214,240,.45) 38%,rgba(206,208,242,.25) 58%,transparent 72%);',
    '  mix-blend-mode:soft-light}',
    '.tf-card .tf-sheen::after{content:"";position:absolute;inset:0;border-radius:inherit;',
    '  background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.55) 46%,rgba(214,200,255,.4) 50%,transparent 64%);',
    '  background-size:250% 100%;background-position:var(--sx,120%) 0;mix-blend-mode:overlay}',
    '.tf-card.tf-on{border-color:rgba(185,166,255,.9)!important;',
    '  box-shadow:0 26px 60px -24px rgba(141,126,242,.75),0 0 0 1px rgba(214,200,255,.6),0 0 34px -6px rgba(246,190,240,.55)!important}',
    '.tf-card.tf-on .tf-sheen{opacity:1}',
    '.tf-spark{position:absolute;width:var(--s,12px);height:var(--s,12px);pointer-events:none;z-index:3;',
    '  margin:calc(var(--s,12px) / -2) 0 0 calc(var(--s,12px) / -2);animation:tfSpark .9s cubic-bezier(.2,.8,.3,1) forwards}',
    '.tf-spark svg{display:block;width:100%;height:100%;filter:drop-shadow(0 0 4px rgba(214,180,255,.9))}',
    '@keyframes tfSpark{0%{transform:scale(0) rotate(0deg);opacity:0}30%{opacity:1;transform:scale(1) rotate(45deg)}',
    '  100%{transform:translate(var(--dx,0),var(--dy,-14px)) scale(.2) rotate(140deg);opacity:0}}',
    '.tf-shine{background:linear-gradient(100deg,var(--muted) 0%,var(--muted) 40%,#B98DF2 46%,#F2B8E8 50%,#9794F2 54%,var(--muted) 60%,var(--muted) 100%);',
    '  background-size:300% 100%;background-position:100% 0;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;',
    '  animation:tfShine 4.5s ease-in-out infinite}',
    '.trust:hover .tf-shine{animation-duration:1.6s}',
    '@keyframes tfShine{0%,35%{background-position:100% 0}75%,100%{background-position:0 0}}'
  ].join('\n');
  document.head.appendChild(css);

  // « briller » scintille
  var lbl=strip.querySelector('.lbl');
  if(lbl&&/briller/i.test(lbl.textContent)){
    lbl.innerHTML=lbl.innerHTML.replace(/(briller)/i,'<span class="tf-shine">$1</span>');
  }

  var STAR='<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="tfg" x1="0" y1="0" x2="1" y2="1">'+
    '<stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#E9C8F5"/><stop offset="1" stop-color="#AEACF2"/></linearGradient></defs>'+
    '<path d="M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z" fill="url(#tfg)"/></svg>';

  function spark(card,x,y){
    var s=document.createElement('span');s.className='tf-spark';s.setAttribute('aria-hidden','true');s.innerHTML=STAR;
    var sz=7+Math.random()*11;
    s.style.setProperty('--s',sz.toFixed(1)+'px');
    s.style.left=x+'px';s.style.top=y+'px';
    s.style.setProperty('--dx',((Math.random()*2-1)*16).toFixed(1)+'px');
    s.style.setProperty('--dy',(-(8+Math.random()*20)).toFixed(1)+'px');
    card.appendChild(s);setTimeout(function(){s.remove();},950);
  }
  function sparkAround(card,n){
    var w=card.offsetWidth,h=card.offsetHeight;
    for(var i=0;i<n;i++){
      // sur le pourtour de la carte, un peu a l'exterieur
      var side=Math.random()*4|0,t=Math.random(),x,y,o=6+Math.random()*10;
      if(side===0){x=t*w;y=-o;}else if(side===1){x=w+o;y=t*h;}else if(side===2){x=t*w;y=h+o;}else{x=-o;y=t*h;}
      (function(x,y,d){setTimeout(function(){spark(card,x,y);},d);})(x,y,i*70);
    }
  }

  cards.forEach(function(card){
    card.classList.add('tf-card');
    var sheen=document.createElement('span');sheen.className='tf-sheen';sheen.setAttribute('aria-hidden','true');card.appendChild(sheen);
    var img=card.querySelector('img');
    var lastSpark=0,raf=0,tx=0,ty=0,px=.5,py=.5;
    function apply(){
      raf=0;
      card.style.transform='translateY(-6px) scale(1.04) rotateX('+(-ty*9).toFixed(2)+'deg) rotateY('+(tx*11).toFixed(2)+'deg)';
      if(img) img.style.transform='translate('+(tx*7).toFixed(2)+'px,'+(ty*5).toFixed(2)+'px) translateZ(20px)';
      card.style.setProperty('--mx',(px*100).toFixed(1)+'%');card.style.setProperty('--my',(py*100).toFixed(1)+'%');
      card.style.setProperty('--sx',(120-px*140).toFixed(1)+'%');
    }
    if(FINE){
      card.addEventListener('pointerenter',function(){card.classList.add('tf-on');sparkAround(card,5);lastSpark=performance.now();});
      card.addEventListener('pointermove',function(e){
        var r=card.getBoundingClientRect();px=(e.clientX-r.left)/r.width;py=(e.clientY-r.top)/r.height;
        tx=px*2-1;ty=py*2-1;if(!raf) raf=requestAnimationFrame(apply);
        var now=performance.now();if(now-lastSpark>260){lastSpark=now;sparkAround(card,1);}
      },{passive:true});
      card.addEventListener('pointerleave',function(){
        card.classList.remove('tf-on');card.style.transform='';if(img) img.style.transform='';
      });
    }else{
      card.addEventListener('click',function(){
        card.classList.add('tf-on');sparkAround(card,6);
        setTimeout(function(){card.classList.remove('tf-on');},900);
      });
    }
  });
})();
