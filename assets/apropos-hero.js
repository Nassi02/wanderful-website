/* A propos — premier ecran.
   1. Le titre s'anime : « De la creativite. » arrive en desordre (lettres eparpillees qui se posent),
      « Une vraie reflexion derriere. » arrive en ordre (mots qui montent un par un).
   2. Au survol, les lettres proches du curseur se soulevent doucement.
   3. Des gouttes nacrees flottent derriere le texte ; pres du curseur elles se rangent en orbite
      autour de lui (la creativite qui s'organise), puis repartent librement.
   prefers-reduced-motion : rien ne bouge, le titre reste tel quel. */
(function(){
  'use strict';
  var hero=document.getElementById('apHero');
  var h=hero&&hero.querySelector('.ap-h');
  if(!h||!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var FINE=matchMedia('(hover:hover) and (pointer:fine)').matches&&!matchMedia('(max-width:860px)').matches;
  var rnd=Math.random;

  /* ---------- 1. decoupage du titre ---------- */
  var gradSrc=h.querySelector('.ap-grad');
  var l1=(h.firstChild&&h.firstChild.nodeType===3)?h.firstChild.textContent.trim():'De la créativité.';
  var l2=gradSrc?gradSrc.textContent.trim():'';
  h.setAttribute('aria-label',(l1+' '+l2).trim());
  h.textContent='';
  var letters=[],gradLetters=[],words2=[];
  function addWords(text,line,isGrad){
    var ws=text.split(/\s+/);
    ws.forEach(function(w,wi){
      var wrap=document.createElement('span');wrap.className='aph-w'+(isGrad?' aph-mask':'');
      var inner=wrap;
      if(isGrad){inner=document.createElement('span');inner.className='aph-wi';wrap.appendChild(inner);words2.push(inner);}
      Array.prototype.forEach.call(w,function(ch){
        var c=document.createElement('span');c.className='aph-c'+(isGrad?' aph-g':' aph-s');c.textContent=ch;
        if(!isGrad){
          // desordre de depart : chaque lettre part d'un endroit different
          c.style.setProperty('--x',((rnd()*2-1)*60).toFixed(1)+'px');
          c.style.setProperty('--y',((rnd()*2-1)*46).toFixed(1)+'px');
          c.style.setProperty('--r',((rnd()*2-1)*32).toFixed(1)+'deg');
          c.style.setProperty('--d',(.05+rnd()*.55).toFixed(2)+'s');
        }
        inner.appendChild(c);letters.push(c);if(isGrad) gradLetters.push(c);
      });
      line.appendChild(wrap);
      if(wi<ws.length-1) line.appendChild(document.createTextNode(' '));
    });
  }
  var s1=document.createElement('span');s1.className='aph-l1';s1.setAttribute('aria-hidden','true');addWords(l1,s1,false);
  h.appendChild(s1);h.appendChild(document.createElement('br'));
  var s2=document.createElement('span');s2.className='aph-l2';s2.setAttribute('aria-hidden','true');addWords(l2,s2,true);
  h.appendChild(s2);
  words2.forEach(function(w,i){w.style.setProperty('--d',(.75+i*.11).toFixed(2)+'s');});

  // degrade continu sur toute la deuxieme ligne, meme decoupee en lettres
  function off(el){var x=0,y=0;while(el){x+=el.offsetLeft;y+=el.offsetTop;el=el.offsetParent;}return [x,y];}
  function layoutGrad(){
    var o=off(s2),w=s2.offsetWidth,hh=s2.offsetHeight;
    gradLetters.forEach(function(c){var p=off(c);
      c.style.backgroundSize=w+'px '+hh+'px';c.style.backgroundPosition=(o[0]-p[0])+'px '+(o[1]-p[1])+'px';});
    centers=null;
  }
  layoutGrad();
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(layoutGrad);

  // lancement de l'animation
  requestAnimationFrame(function(){requestAnimationFrame(function(){h.classList.add('aph-go');});});
  var INTRO_END=2400,live=false;
  setTimeout(function(){h.classList.add('aph-live');live=true;},INTRO_END);

  /* ---------- 2. lettres qui se soulevent au survol ---------- */
  var mx=-1e4,my=-1e4,inside=false,centers=null,cur=new Float32Array(letters.length*3),raf=0;
  function measure(){
    var hr=h.getBoundingClientRect(),o=off(h);
    centers=letters.map(function(c){var p=off(c);return [p[0]-o[0]+c.offsetWidth/2,p[1]-o[1]+c.offsetHeight/2];});
    return hr;
  }
  function tick(){
    raf=0;if(!live) return;
    var hr=h.getBoundingClientRect();if(!centers) measure();
    var moving=false;
    for(var i=0;i<letters.length;i++){
      var tx=0,ty=0,ts=0;
      if(inside){
        var dx=centers[i][0]+hr.left-mx,dy=centers[i][1]+hr.top-my,d=Math.sqrt(dx*dx+dy*dy);
        if(d<150){var f=1-d/150;f=f*f*(3-2*f);ty=-12*f;tx=(d>1?dx/d:0)*5*f;ts=.09*f;}
      }
      var o=i*3;
      cur[o]+=(tx-cur[o])*.18;cur[o+1]+=(ty-cur[o+1])*.18;cur[o+2]+=(ts-cur[o+2])*.18;
      if(Math.abs(cur[o])+Math.abs(cur[o+1])+Math.abs(cur[o+2])*40>.02) moving=true;
      else{cur[o]=cur[o+1]=cur[o+2]=0;}
      letters[i].style.transform=(cur[o]||cur[o+1]||cur[o+2])?'translate('+cur[o].toFixed(2)+'px,'+cur[o+1].toFixed(2)+'px) scale('+(1+cur[o+2]).toFixed(3)+')':'';
    }
    if(moving||inside) raf=requestAnimationFrame(tick);
  }
  if(FINE){
    hero.addEventListener('pointermove',function(e){mx=e.clientX;my=e.clientY;inside=true;if(!raf) raf=requestAnimationFrame(tick);},{passive:true});
    hero.addEventListener('pointerleave',function(){inside=false;if(!raf) raf=requestAnimationFrame(tick);});
  }
  var rzT=0;
  window.addEventListener('resize',function(){clearTimeout(rzT);rzT=setTimeout(function(){layoutGrad();if(field) field.layout();},150);});

  /* ---------- 3. gouttes nacrees ---------- */
  var field=null;
  (function(){
    var c=document.createElement('canvas');
    c.className='aph-field';c.setAttribute('aria-hidden','true');
    var g=c.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,depth:true});
    if(!g) return;
    var vs='attribute vec3 aP;uniform mat3 uR;uniform vec2 uCv;uniform vec3 uPS;uniform mediump float uSeed;uniform mediump float uTime;'+
      'varying vec3 vN;varying float vF;'+
      'void main(){vec3 k1=vec3(1.9,1.3,-1.1),k2=vec3(-1.2,2.1,1.7);'+
      'float a1=dot(k1,aP)+uSeed*6.3+uTime*.35,a2=dot(k2,aP)+uSeed*11.+uTime*.27;'+
      'float f=.17*sin(a1)+.11*sin(a2);vec3 gr=.17*cos(a1)*k1+.11*cos(a2)*k2;'+
      'vec3 P=aP*(1.+f);vec3 N=normalize(aP-(gr-dot(gr,aP)*aP));'+
      'vec3 pv=uR*P;vN=uR*N;vF=f;'+
      'vec2 d=uPS.xy+vec2(pv.x,-pv.y)*uPS.z;'+
      'gl_Position=vec4(d.x/uCv.x*2.-1.,1.-d.y/uCv.y*2.,-pv.z*.2,1.);}';
    var fs='precision mediump float;uniform float uSeed;uniform float uTime;uniform float uAlpha;varying vec3 vN;varying float vF;'+
      'void main(){vec3 n=normalize(vN);float fr=1.-clamp(n.z,0.,1.);'+
      'vec3 r=vec3(2.*n.z*n.x,2.*n.z*n.y,2.*n.z*n.z-1.);'+
      'float ph=n.y*.5+n.x*.34+fr*.8+uSeed;'+
      'vec3 pal=vec3(.79,.70,.97)+vec3(.17,.10,.03)*cos(6.2832*(ph*.95+vec3(0.,.36,.62)));'+
      'float cv=clamp(-vF*4.,0.,1.);pal=mix(pal,vec3(.40,.33,.90),cv*.6);'+
      'pal*=mix(.9,1.04,smoothstep(.1,.95,r.y*.5+.5));'+
      'float b1=smoothstep(.5,.98,sin(r.y*3.1+sin(r.x*2.2+1.3)*1.2+r.z*1.3+uSeed*5.)*.5+.5);'+
      'vec3 col=pal+vec3(1.,.97,1.)*b1*.26*(1.-cv*.8);'+
      'col=mix(col,vec3(1.,.95,1.),pow(fr,3.5)*.55);'+
      'gl_FragColor=vec4(min(col,1.)*uAlpha,uAlpha);}';
    function mk(t,src){var o=g.createShader(t);g.shaderSource(o,src);g.compileShader(o);return g.getShaderParameter(o,g.COMPILE_STATUS)?o:null;}
    var a=mk(g.VERTEX_SHADER,vs),b=mk(g.FRAGMENT_SHADER,fs);if(!a||!b) return;
    var pg=g.createProgram();g.attachShader(pg,a);g.attachShader(pg,b);g.linkProgram(pg);
    if(!g.getProgramParameter(pg,g.LINK_STATUS)) return;
    g.useProgram(pg);
    // icosphere
    var t=(1+Math.sqrt(5))/2,V=[-1,t,0,1,t,0,-1,-t,0,1,-t,0,0,-1,t,0,1,t,0,-1,-t,0,1,-t,t,0,-1,t,0,1,-t,0,-1,-t,0,1];
    var F=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];
    var q;for(q=0;q<V.length;q+=3){var l=Math.sqrt(V[q]*V[q]+V[q+1]*V[q+1]+V[q+2]*V[q+2]);V[q]/=l;V[q+1]/=l;V[q+2]/=l;}
    for(var it=0;it<3;it++){
      var cache={},F2=[];
      var mid=function(i,j){var key=i<j?i+'_'+j:j+'_'+i;if(cache[key]!==undefined) return cache[key];
        var x=V[i*3]+V[j*3],y=V[i*3+1]+V[j*3+1],z=V[i*3+2]+V[j*3+2],l=Math.sqrt(x*x+y*y+z*z);V.push(x/l,y/l,z/l);return cache[key]=V.length/3-1;};
      for(q=0;q<F.length;q+=3){var i0=F[q],i1=F[q+1],i2=F[q+2],m0=mid(i0,i1),m1=mid(i1,i2),m2=mid(i2,i0);F2.push(i0,m0,m2,i1,m1,m0,i2,m2,m1,m0,m1,m2);}
      F=F2;
    }
    var vb=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,vb);g.bufferData(g.ARRAY_BUFFER,new Float32Array(V),g.STATIC_DRAW);
    var la=g.getAttribLocation(pg,'aP');g.enableVertexAttribArray(la);g.vertexAttribPointer(la,3,g.FLOAT,false,0,0);
    var ib=g.createBuffer();g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,ib);g.bufferData(g.ELEMENT_ARRAY_BUFFER,new Uint16Array(F),g.STATIC_DRAW);
    g.enable(g.DEPTH_TEST);g.enable(g.BLEND);g.blendFunc(g.ONE,g.ONE_MINUS_SRC_ALPHA);g.clearColor(0,0,0,0);
    var u={};['uR','uCv','uPS','uSeed','uTime','uAlpha'].forEach(function(nm){u[nm]=g.getUniformLocation(pg,nm);});

    var N=FINE?48:18,items=[],W=0,H=0,txt=null;
    for(q=0;q<N;q++) items.push({seed:rnd(),u:rnd(),v:rnd(),size:0,alpha:.9,ph:rnd()*6.2832,w1:.18+rnd()*.3,w2:.15+rnd()*.25,
      amp:10+rnd()*22,spin:(rnd()*2-1)*.5,tilt:rnd()*1.2-.6,ang:rnd()*6.2832,ring:70+rnd()*120,orb:(rnd()<.5?-1:1)*(.35+rnd()*.35),
      x:0,y:0,init:false,delay:.25+q*.03+rnd()*.5,depth:.3+rnd()*.7});
    hero.insertBefore(c,hero.firstChild);
    var m3=new Float32Array(9);
    function place(){
      // moins de gouttes, et plus petites, la ou se trouve le texte
      var tr=hero.querySelector('.ap-me-txt').getBoundingClientRect(),hr=hero.getBoundingClientRect();
      txt=[tr.left-hr.left,tr.top-hr.top,tr.right-hr.left,tr.bottom-hr.top];
      items.forEach(function(o){
        var x,y,k=0;
        do{x=o.u*W;y=o.v*H;var inT=x>txt[0]-20&&x<txt[2]+20&&y>txt[1]-20&&y<txt[3]+20;
          if(!inT||k>3) break;o.u=rnd();o.v=rnd();k++;}while(true);
        o.inText=x>txt[0]&&x<txt[2]&&y>txt[1]&&y<txt[3];
        o.size=(o.inText?5:7)+rnd()*rnd()*(o.inText?14:30);
        o.alpha=o.inText?.55:.9;
      });
    }
    field={
      layout:function(){
        var dpr=Math.min(window.devicePixelRatio||1,FINE?2:1.5);
        W=hero.clientWidth;H=hero.clientHeight;
        c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);
        g.viewport(0,0,c.width,c.height);g.uniform2f(u.uCv,W,H);
        place();
      }
    };
    field.layout();

    var t0=0,last=0,frame=0,visible=true;
    function draw(now){
      frame=0;
      if(!t0){t0=now;last=now;}
      var T=(now-t0)/1000,dt=Math.min((now-last)/1000,1/30);last=now;
      var hr=hero.getBoundingClientRect(),lmx=mx-hr.left,lmy=my-hr.top,sc=Math.max(0,-hr.top);
      g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);g.uniform1f(u.uTime,T);
      var e=1-Math.exp(-dt*2.6);
      for(var i=0;i<items.length;i++){
        var o=items[i],k=(T-o.delay)/1.1;if(k<=0) continue;if(k>1) k=1;k=k*k*(3-2*k);
        // position libre : derive lente
        var fx=o.u*W+Math.sin(T*o.w1+o.ph)*o.amp,fy=o.v*H+Math.cos(T*o.w2+o.ph*1.7)*o.amp-sc*.25*o.depth;
        var tx=fx,ty=fy;
        if(inside&&FINE){
          // pres du curseur : les gouttes se rangent en orbite autour de lui
          var dx=fx-lmx,dy=fy-lmy,d=Math.sqrt(dx*dx+dy*dy);
          if(d<340){var w=1-d/340;w=w*w*(3-2*w);
            var an=o.ang+T*o.orb,rx=lmx+Math.cos(an)*o.ring,ry=lmy+Math.sin(an)*o.ring*.72;
            tx=fx+(rx-fx)*w;ty=fy+(ry-fy)*w;}
        }
        if(!o.init){o.x=tx;o.y=ty;o.init=true;}
        o.x+=(tx-o.x)*e;o.y+=(ty-o.y)*e;
        var ay=T*o.spin+o.ph,ax=o.tilt,cy=Math.cos(ay),sy=Math.sin(ay),cx=Math.cos(ax),sx=Math.sin(ax);
        m3[0]=cy;m3[1]=0;m3[2]=-sy;m3[3]=sy*sx;m3[4]=cx;m3[5]=cy*sx;m3[6]=sy*cx;m3[7]=-sx;m3[8]=cy*cx;
        g.uniformMatrix3fv(u.uR,false,m3);
        g.uniform3f(u.uPS,o.x,o.y,o.size*(.4+.6*k));g.uniform1f(u.uSeed,o.seed);g.uniform1f(u.uAlpha,o.alpha*k);
        g.drawElements(g.TRIANGLES,F.length,g.UNSIGNED_SHORT,0);
      }
      if(visible&&!document.hidden) frame=requestAnimationFrame(draw);
    }
    function play(){if(!frame&&visible&&!document.hidden){last=performance.now();frame=requestAnimationFrame(draw);}}
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(es){visible=es[0].isIntersecting;if(visible) play();},{rootMargin:'40px'}).observe(hero);
    }
    document.addEventListener('visibilitychange',play);
    c.addEventListener('webglcontextlost',function(ev){ev.preventDefault();c.remove();});
    play();
  })();
})();
