/* Accueil — titre « On transforme vos idées en impact. »
   - « vos idées » : les lettres flottent d'abord comme des bulles nacrees, puis se transforment en texte net
   - « impact. » : les lettres tombent et frappent, avec une onde de choc qui repousse les petits blobs
   - au survol : les lettres proches du curseur se soulevent, « idées » s'envole un instant,
     « impact. » refrappe (aussi au toucher sur mobile)
   prefers-reduced-motion : rien ne bouge. */
(function(){
  'use strict';
  var h=document.querySelector('#accueil h1');
  if(!h||!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var FINE=matchMedia('(hover:hover) and (pointer:fine)').matches;
  var grad=h.querySelector('.grad');
  var textNode=null;
  for(var n=0;n<h.childNodes.length;n++){var nd=h.childNodes[n];if(nd.nodeType===3&&nd.textContent.trim()){textNode=nd;break;}}
  if(!grad||!textNode) return;
  var rnd=Math.random;

  /* styles */
  var css=document.createElement('style');
  css.textContent=[
    '#accueil h1{position:relative}',
    '.ht-w{display:inline-block;white-space:nowrap}',
    '.ht-c{display:inline-block;will-change:transform}',
    '.ht-rise{opacity:0;transform:translateY(.5em);filter:blur(5px)}',
    'h1.ht-go .ht-rise{opacity:1;transform:none;filter:none;transition:opacity .7s ease var(--d),transform .95s cubic-bezier(.22,1,.36,1) var(--d),filter .7s ease var(--d)}',
    // idees : bulles qui flottent puis se transforment
    '.ht-idea{opacity:0;transform:translate(var(--x),var(--y)) scale(.5);filter:blur(7px);color:#AEACF2}',
    '.ht-idea>i{display:inline-block;font-style:normal}',
    'h1.ht-float .ht-idea{opacity:.9;transform:translate(var(--x),var(--y)) scale(.8);filter:blur(1.5px);text-shadow:0 0 18px rgba(185,166,255,.9);',
    '  transition:opacity .6s ease var(--d),transform 1s cubic-bezier(.3,.8,.3,1) var(--d),filter .6s ease var(--d)}',
    'h1.ht-float .ht-idea>i{animation:htBob 1.6s ease-in-out infinite alternate;animation-delay:calc(var(--d) * -3)}',
    'h1.ht-snap .ht-idea{opacity:1;transform:none;filter:none;color:inherit;text-shadow:none;',
    '  transition:transform .55s cubic-bezier(.2,1.4,.4,1) var(--s),color .5s ease var(--s),text-shadow .6s ease var(--s),filter .4s ease var(--s),opacity .3s ease var(--s);',
    '  animation:htFlash .7s ease var(--s) both}',
    'h1.ht-snap .ht-idea>i{animation:none}',
    '@keyframes htBob{from{transform:translateY(-5px) rotate(-4deg)}to{transform:translateY(5px) rotate(4deg)}}',
    '@keyframes htFlash{0%{filter:brightness(1)}35%{filter:brightness(1.9) drop-shadow(0 0 10px rgba(255,220,250,.9))}100%{filter:none}}',
    // impact : chute et frappe
    '.ht-imp{opacity:0}',
    '.grad.ht-gr{background:none!important}',
    '.ht-g{background-image:var(--grad-text);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;padding-right:.07em;margin-right:-.07em}',
    'h1.ht-fall .ht-imp{animation:htFall .62s cubic-bezier(.55,0,.9,.45) var(--d) both}',
    'h1.ht-done .ht-imp{opacity:1;animation:none}',
    '@keyframes htFall{0%{opacity:0;transform:translateY(-1.7em) rotate(var(--r))}55%{opacity:1}',
    '  72%{transform:translateY(.07em) scale(1.1,.82);animation-timing-function:cubic-bezier(.2,.8,.3,1)}',
    '  86%{transform:translateY(-.1em) scale(.95,1.06)}100%{opacity:1;transform:none}}',
    '.ht-ring{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;pointer-events:none;z-index:-1;',
    '  border:2px solid rgba(185,166,255,.8);box-shadow:0 0 22px rgba(185,166,255,.65),inset 0 0 14px rgba(255,190,240,.55);',
    '  animation:htRing 1.05s cubic-bezier(.15,.75,.3,1) forwards}',
    '@keyframes htRing{0%{transform:scale(.2);opacity:.95}100%{transform:scale(var(--k,9));opacity:0}}',
    'h1.ht-shake{animation:htShake .32s ease}',
    '@keyframes htShake{20%{transform:translate(2px,1px)}40%{transform:translate(-2px,-1px)}60%{transform:translate(1px,-1px)}80%{transform:translate(-1px,1px)}}'
  ].join('\n');
  document.head.appendChild(css);

  /* decoupage */
  var letters=[],ideaLetters=[],impLetters=[],ideaWord=null;
  function mkWord(word,kind,wi){
    var w=document.createElement('span');w.className='ht-w';
    Array.prototype.forEach.call(word,function(ch,ci){
      var c=document.createElement('span');c.className='ht-c';
      if(kind==='idea'){
        c.className+=' ht-idea';var i=document.createElement('i');i.textContent=ch;c.appendChild(i);
        c.style.setProperty('--x',((rnd()*2-1)*28).toFixed(1)+'px');
        c.style.setProperty('--y',(-(22+rnd()*46)).toFixed(1)+'px');
        c.style.setProperty('--d',(ci*.07).toFixed(2)+'s');
        c.style.setProperty('--s',(ci*.05).toFixed(2)+'s');
        ideaLetters.push(c);
      }else if(kind==='imp'){
        c.className+=' ht-imp ht-g';c.textContent=ch;
        c.style.setProperty('--d',(ci*.07).toFixed(2)+'s');
        c.style.setProperty('--r',((rnd()*2-1)*24).toFixed(1)+'deg');
        impLetters.push(c);
      }else{
        c.className+=' ht-rise';c.textContent=ch;
        c.style.setProperty('--d',(wi*.09+ci*.025).toFixed(3)+'s');
      }
      w.appendChild(c);letters.push(c);
    });
    return w;
  }
  var words=textNode.textContent.replace(/\s+/g,' ').trim().split(' ');
  var frag=document.createDocumentFragment();
  words.forEach(function(wd,wi){
    var kind=/^id[ée]es$/i.test(wd)?'idea':'rise';
    var w=mkWord(wd,kind,wi);if(kind==='idea') ideaWord=w;
    frag.appendChild(w);frag.appendChild(document.createTextNode(' '));
  });
  textNode.parentNode.replaceChild(frag,textNode);
  var impText=grad.textContent.trim();grad.textContent='';grad.classList.add('ht-gr');
  var impWord=mkWord(impText,'imp',0);grad.appendChild(impWord);
  // l'ordre de « en » : il arrive juste avant « impact. »
  var riseAfterIdea=[],seenIdea=false;
  h.querySelectorAll('.ht-w').forEach(function(w){if(w===ideaWord){seenIdea=true;return;}
    if(seenIdea&&w!==impWord) riseAfterIdea.push(w);});
  riseAfterIdea.forEach(function(w){w.querySelectorAll('.ht-rise').forEach(function(c,ci){c.style.setProperty('--d',(1.25+ci*.03).toFixed(2)+'s');});});

  // degrade continu sur « impact. »
  function off(el){var x=0,y=0;while(el){x+=el.offsetLeft;y+=el.offsetTop;el=el.offsetParent;}return [x,y];}
  function layoutGrad(){
    var o=off(grad),w=grad.offsetWidth,hh=grad.offsetHeight;
    impLetters.forEach(function(c){var p=off(c);c.style.backgroundSize=w+'px '+hh+'px';c.style.backgroundPosition=(o[0]-p[0])+'px '+(o[1]-p[1])+'px';});
    centers=null;
  }
  var centers=null;
  layoutGrad();
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(layoutGrad);

  /* onde de choc */
  var lastHit=0;
  function impact(power){
    var now=performance.now();if(now-lastHit<850) return;lastHit=now;
    var hr=h.getBoundingClientRect(),wr=impWord.getBoundingClientRect();
    var cx=wr.left+wr.width*.45,cy=wr.top+wr.height*.62;
    [[0,9],[120,6],[240,3.6]].forEach(function(r){setTimeout(function(){
      var ring=document.createElement('span');ring.className='ht-ring';ring.setAttribute('aria-hidden','true');
      ring.style.left=(cx-hr.left)+'px';ring.style.top=(cy-hr.top)+'px';ring.style.setProperty('--k',r[1]*(power<1?.75:1));
      h.appendChild(ring);setTimeout(function(){ring.remove();},1200);
    },r[0]);});
    h.classList.remove('ht-shake');void h.offsetWidth;h.classList.add('ht-shake');
    try{window.dispatchEvent(new CustomEvent('wf-impact',{detail:{x:cx,y:cy,power:power}}));}catch(e){}
  }
  function bounceImpact(){
    if(performance.now()-lastHit<850) return;
    impLetters.forEach(function(c,i){
      if(!c.animate) return;
      c.animate([{transform:'none'},{transform:'translateY(-.32em) rotate('+((rnd()*2-1)*10).toFixed(1)+'deg)',offset:.35},
        {transform:'translateY(.06em) scale(1.1,.84)',offset:.62},{transform:'translateY(-.05em) scale(.97,1.04)',offset:.8},{transform:'none'}],
        {duration:620,delay:i*35,easing:'ease-in-out'});
    });
    setTimeout(function(){impact(.75);},250);
  }
  function scatterIdea(){
    ideaLetters.forEach(function(c,i){
      if(!c.animate) return;
      c.animate([{transform:'none'},
        {transform:'translate('+((rnd()*2-1)*16).toFixed(1)+'px,'+(-(10+rnd()*22)).toFixed(1)+'px) rotate('+((rnd()*2-1)*14).toFixed(1)+'deg) scale(1.06)',offset:.4,color:'#AEACF2'},
        {transform:'none'}],{duration:1300,delay:i*45,easing:'cubic-bezier(.3,.7,.3,1)'});
    });
  }

  /* chronologie de l'arrivee */
  var live=false;
  requestAnimationFrame(function(){requestAnimationFrame(function(){
    h.classList.add('ht-go');
    setTimeout(function(){h.classList.add('ht-float');},350);
    setTimeout(function(){h.classList.add('ht-snap');},1350);
    setTimeout(function(){h.classList.add('ht-fall');},1700);
    setTimeout(function(){lastHit=0;impact(1);},1700+430+impLetters.length*35);
    setTimeout(function(){h.classList.remove('ht-fall');h.classList.add('ht-done');live=true;},1700+700+impLetters.length*70);
  });});

  /* survol */
  var mx=0,my=0,inside=false,raf=0,cur=new Float32Array(letters.length*2);
  function measure(){var o=off(h);centers=letters.map(function(c){var p=off(c);return [p[0]-o[0]+c.offsetWidth/2,p[1]-o[1]+c.offsetHeight/2];});}
  function tick(){
    raf=0;if(!live) return;
    if(!centers) measure();
    var hr=h.getBoundingClientRect(),moving=false;
    for(var i=0;i<letters.length;i++){
      var ty=0,tx=0;
      if(inside){var dx=centers[i][0]+hr.left-mx,dy=centers[i][1]+hr.top-my,d=Math.sqrt(dx*dx+dy*dy);
        if(d<150){var f=1-d/150;f=f*f*(3-2*f);ty=-11*f;tx=(d>1?dx/d:0)*5*f;}}
      var o=i*2;cur[o]+=(tx-cur[o])*.18;cur[o+1]+=(ty-cur[o+1])*.18;
      if(Math.abs(cur[o])+Math.abs(cur[o+1])>.03) moving=true;else cur[o]=cur[o+1]=0;
      letters[i].style.transform=(cur[o]||cur[o+1])?'translate('+cur[o].toFixed(2)+'px,'+cur[o+1].toFixed(2)+'px)':'';
    }
    if(moving||inside) raf=requestAnimationFrame(tick);
  }
  if(FINE){
    h.addEventListener('pointermove',function(e){mx=e.clientX;my=e.clientY;inside=true;if(!raf) raf=requestAnimationFrame(tick);},{passive:true});
    h.addEventListener('pointerleave',function(){inside=false;if(!raf) raf=requestAnimationFrame(tick);});
    impWord.addEventListener('pointerenter',function(){if(live) bounceImpact();});
    if(ideaWord) ideaWord.addEventListener('pointerenter',function(){if(live) scatterIdea();});
  }
  impWord.addEventListener('click',function(){if(live) bounceImpact();});
  var rzT=0;window.addEventListener('resize',function(){clearTimeout(rzT);rzT=setTimeout(layoutGrad,150);});
})();
