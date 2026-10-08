/* Hero : le blob holographique s'assemble a l'arrivee, puis se fragmente sous le curseur et se reconstitue.
   Fragmentation de l'image existante (assets/blob-hero.png) en petits eclats
   triangulaires textures, avec profondeur simulee (WebGL, sans librairie).
   - ordinateur : introduction + interaction souris + leger effet au scroll
   - mobile / tactile : introduction allegee, puis retour a l'image d'origine
   - prefers-reduced-motion : rien, l'image reste affichee telle quelle */
(function(){
  'use strict';
  var root=document.documentElement;
  function unhide(){root.classList.remove('blob-intro');}
  var visual=document.querySelector('.hero-visual');
  var img=visual&&visual.querySelector('img');
  if(!visual||!img||!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches){unhide();return;}
  var LITE=!matchMedia('(hover:hover) and (pointer:fine)').matches||matchMedia('(max-width:980px)').matches;

  /* reglages */
  var CELL=LITE?34:15;  // taille d'un eclat, en px de l'image source
  var JITTER=.38;       // irregularite de la decoupe
  var RADIUS=120;       // rayon d'influence du curseur (px image)
  var PUSH=64;          // ecartement maximal (px image)
  var K_OUT=95,K_BACK=20; // raideur : depart vif, retour lent
  var DAMP=.92;         // 1 = amortissement critique (pas de rebond)
  var SWEEP=1.5;        // part de la vitesse du curseur transmise aux eclats
  var PAD=LITE?40:90;   // marge du canvas autour de l'image (px ecran)
  var SHADOW_PAD=170;
  var INTRO=LITE?1.6:2.6; // duree totale de l'introduction (s) - plus courte sur mobile
  var INTRO_STAGGER=LITE?.45:.8; // decalage maximal entre eclats (s)
  var INTRO_DIST=LITE?[60,170]:[110,330]; // distance de depart (px image)
  var INTRO_MIN_X=.12;  // les eclats ne partent jamais a gauche de cette part de l'image (cote texte)

  var VS='attribute vec2 aPos;attribute vec2 aCen;attribute vec4 aOff;attribute float aFade;'+
    'uniform vec2 uImg;uniform vec2 uCanvas;uniform vec2 uShift;uniform float uScale;uniform float uPad;uniform float uRot;'+
    'varying vec2 vUv;varying float vLift;varying float vFade;'+
    'void main(){'+
    'vec2 l=aPos-aCen;float a=aOff.w;float c=cos(a),s=sin(a);'+
    'l=vec2(c*l.x-s*l.y,s*l.x+c*l.y);l.x*=cos(a*1.6);'+   // l'eclat pivote et bascule
    'l*=1.0+aOff.z*.5;'+                                   // il avance vers l'oeil
    'vec2 p=aCen+l+aOff.xy;'+
    'vec2 q=p-uImg*.5;float cr=cos(uRot),sr=sin(uRot);'+
    'q=vec2(cr*q.x-sr*q.y,sr*q.x+cr*q.y)+uImg*.5;'+
    'vec2 d=q*uScale+uPad+uShift;'+
    'gl_Position=vec4(d.x/uCanvas.x*2.0-1.0,1.0-d.y/uCanvas.y*2.0,0.0,1.0);'+
    'vUv=aPos/uImg;vLift=min(aOff.z,1.0);vFade=aFade;}';
  var FS='precision mediump float;uniform sampler2D uTex;varying vec2 vUv;varying float vLift;varying float vFade;'+
    'void main(){vec4 t=texture2D(uTex,vUv);'+
    't.rgb+=t.a*vLift*vec3(.16,.13,.18);'+                 // reflet nacre sur les eclats souleves
    'gl_FragColor=t*vFade;}';

  function start(){
    var IW=img.naturalWidth,IH=img.naturalHeight;
    if(!IW||!IH){unhide();return;}
    // l'intro ne joue que si l'image est encore masquee (chargement normal) et que le hero est a l'ecran
    var playIntro=root.classList.contains('blob-intro')&&window.scrollY<visual.offsetHeight*.6;
    if(LITE&&!playIntro){unhide();return;}

    /* 1. decoupe : grille irreguliere, on ne garde que les cellules qui contiennent de la matiere */
    var alpha;
    try{
      var sc=document.createElement('canvas');sc.width=IW;sc.height=IH;
      var sx=sc.getContext('2d',{willReadFrequently:true});sx.drawImage(img,0,0);
      alpha=sx.getImageData(0,0,IW,IH).data;
    }catch(e){unhide();return;}
    var nx=Math.ceil(IW/CELL),ny=Math.ceil(IH/CELL),gw=IW/nx,gh=IH/ny;
    var px=new Float32Array((nx+1)*(ny+1)),py=new Float32Array((nx+1)*(ny+1));
    var i,j,k;
    for(j=0;j<=ny;j++)for(i=0;i<=nx;i++){
      var edge=(i===0||j===0||i===nx||j===ny);
      px[j*(nx+1)+i]=i*gw+(edge?0:(Math.random()*2-1)*JITTER*gw);
      py[j*(nx+1)+i]=j*gh+(edge?0:(Math.random()*2-1)*JITTER*gh);
    }
    var minX=IW,maxX=0,minY=IH,maxY=0;
    function hasInk(x0,y0,x1,y1){
      x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));
      x1=Math.min(IW,Math.ceil(x1));y1=Math.min(IH,Math.ceil(y1));
      for(var y=y0;y<y1;y++)for(var x=x0;x<x1;x++) if(alpha[(y*IW+x)*4+3]>6) return true;
      return false;
    }
    var tris=[];
    for(j=0;j<ny;j++)for(i=0;i<nx;i++){
      var a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
      if(!hasInk(Math.min(px[a],px[c]),Math.min(py[a],py[b]),Math.max(px[b],px[d]),Math.max(py[c],py[d]))) continue;
      if(Math.random()<.5) tris.push([a,b,c],[b,d,c]); else tris.push([a,b,d],[a,d,c]);
      if(px[a]<minX)minX=px[a];if(px[d]>maxX)maxX=px[d];if(py[a]<minY)minY=py[a];if(py[d]>maxY)maxY=py[d];
    }
    alpha=null;
    var N=tris.length;
    if(!N){unhide();return;}
    var ST=5;                              // aOff (x,y,z,rot) + aFade
    var stat=new Float32Array(N*3*4);      // aPos, aCen
    var dyn=new Float32Array(N*3*ST);
    var cx=new Float32Array(N),cy=new Float32Array(N);
    var ox=new Float32Array(N),oy=new Float32Array(N),oz=new Float32Array(N),or=new Float32Array(N);
    var vx=new Float32Array(N),vy=new Float32Array(N),vz=new Float32Array(N),vr=new Float32Array(N);
    var rPush=new Float32Array(N),rRot=new Float32Array(N),rK=new Float32Array(N),rAx=new Float32Array(N),rAy=new Float32Array(N);
    var awake=new Uint8Array(N);
    for(k=0;k<N;k++){
      var t=tris[k];
      cx[k]=(px[t[0]]+px[t[1]]+px[t[2]])/3;cy[k]=(py[t[0]]+py[t[1]]+py[t[2]])/3;
      for(var v=0;v<3;v++){
        var o=(k*3+v)*4;
        stat[o]=px[t[v]];stat[o+1]=py[t[v]];stat[o+2]=cx[k];stat[o+3]=cy[k];
        dyn[(k*3+v)*ST+4]=1;
      }
      rPush[k]=.55+Math.random()*.9;
      rRot[k]=(Math.random()*2-1)*1.25;
      rK[k]=.6+Math.random()*.9;
      var an=Math.random()*6.2832;rAx[k]=Math.cos(an);rAy[k]=Math.sin(an);
    }
    tris=px=py=null;

    /* 2. WebGL */
    var cv=document.createElement('canvas');
    cv.setAttribute('aria-hidden','true');
    cv.style.cssText='position:absolute;pointer-events:none;display:block;';
    var gl=cv.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,powerPreference:'low-power'});
    if(!gl){unhide();return;}
    function sh(type,src){var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return gl.getShaderParameter(s,gl.COMPILE_STATUS)?s:null;}
    var v1=sh(gl.VERTEX_SHADER,VS),f1=sh(gl.FRAGMENT_SHADER,FS);
    if(!v1||!f1){unhide();return;}
    var pr=gl.createProgram();gl.attachShader(pr,v1);gl.attachShader(pr,f1);gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr,gl.LINK_STATUS)){unhide();return;}
    gl.useProgram(pr);
    var U={};['uImg','uCanvas','uShift','uScale','uPad','uRot','uTex'].forEach(function(n){U[n]=gl.getUniformLocation(pr,n);});
    var bs=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bs);gl.bufferData(gl.ARRAY_BUFFER,stat,gl.STATIC_DRAW);
    var lp=gl.getAttribLocation(pr,'aPos'),lc=gl.getAttribLocation(pr,'aCen'),lo=gl.getAttribLocation(pr,'aOff'),lf=gl.getAttribLocation(pr,'aFade');
    gl.enableVertexAttribArray(lp);gl.vertexAttribPointer(lp,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(lc);gl.vertexAttribPointer(lc,2,gl.FLOAT,false,16,8);
    var bd=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bd);gl.bufferData(gl.ARRAY_BUFFER,dyn,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lo);gl.vertexAttribPointer(lo,4,gl.FLOAT,false,ST*4,0);
    gl.enableVertexAttribArray(lf);gl.vertexAttribPointer(lf,1,gl.FLOAT,false,ST*4,16);
    var tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);}catch(e){unhide();return;}
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.uTex,0);gl.uniform2f(U.uImg,IW,IH);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);

    /* 3. ombre portee : rendue une seule fois (remplace le drop-shadow CSS de l'image) */
    var shd=document.createElement('canvas');
    shd.setAttribute('aria-hidden','true');
    shd.style.cssText='position:absolute;pointer-events:none;display:block;will-change:transform,opacity;';

    // conteneur borne a la largeur de la page : les marges des canvas ne creent aucun debordement horizontal
    var clip=document.createElement('div');
    clip.setAttribute('aria-hidden','true');
    clip.style.cssText='position:absolute;overflow:hidden;pointer-events:none;';
    clip.appendChild(shd);clip.appendChild(cv);

    var scale=1,cssW=0,cssH=0;
    function pageLeft(el){var x=0;while(el){x+=el.offsetLeft;el=el.offsetParent;}return x;}
    function layout(){
      var w=img.offsetWidth,h=img.offsetHeight;
      if(!w||!h) return false;
      scale=w/IW;cssW=w+PAD*2;cssH=h+PAD*2;
      var dpr=Math.min(window.devicePixelRatio||1,2);
      var vl=pageLeft(visual);
      clip.style.left=(-vl)+'px';clip.style.width=document.documentElement.clientWidth+'px';
      clip.style.top=(img.offsetTop-SHADOW_PAD)+'px';clip.style.height=(h+SHADOW_PAD*2)+'px';
      cv.style.left=(vl+img.offsetLeft-PAD)+'px';cv.style.top=(SHADOW_PAD-PAD)+'px';
      cv.style.width=cssW+'px';cv.style.height=cssH+'px';
      cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);
      gl.viewport(0,0,cv.width,cv.height);
      gl.uniform2f(U.uCanvas,cssW,cssH);gl.uniform1f(U.uScale,scale);gl.uniform1f(U.uPad,PAD);
      var q=.5,sw=w+SHADOW_PAD*2,shh=h+SHADOW_PAD*2;
      shd.style.left=(vl+img.offsetLeft-SHADOW_PAD)+'px';shd.style.top='0';
      shd.style.width=sw+'px';shd.style.height=shh+'px';
      shd.width=Math.round(sw*q);shd.height=Math.round(shh*q);
      var c2=shd.getContext('2d');
      c2.clearRect(0,0,shd.width,shd.height);
      c2.shadowColor='rgba(141,126,242,.45)';c2.shadowBlur=140*q;
      c2.shadowOffsetX=shd.width*2;c2.shadowOffsetY=40*q;
      c2.drawImage(img,SHADOW_PAD*q-shd.width*2,SHADOW_PAD*q,w*q,h*q);
      return true;
    }
    if(!layout()){unhide();return;}
    visual.insertBefore(clip,img.nextSibling);

    /* 4. introduction : chaque eclat part d'un point autour du blob et rejoint sa place */
    var inIntro=null,iDelay,iDur,isx,isy,isz,isr,introLeft=0,introStart=0;
    if(playIntro){
      inIntro=new Uint8Array(N);iDelay=new Float32Array(N);iDur=new Float32Array(N);
      isx=new Float32Array(N);isy=new Float32Array(N);isz=new Float32Array(N);isr=new Float32Array(N);
      var bcx=(minX+maxX)/2,bcy=(minY+maxY)/2,brad=Math.max(maxX-minX,maxY-minY)/2||1;
      var m=(PAD-12)/scale;                 // limites : la zone du canvas, jamais cote texte
      var loX=IW*INTRO_MIN_X,hiX=IW+m,loY=-m,hiY=IH+m;
      for(k=0;k<N;k++){
        var dx=cx[k]-bcx,dy=cy[k]-bcy,dist=Math.sqrt(dx*dx+dy*dy);
        var ang=Math.atan2(dy,dx)+(Math.random()*2-1)*.9;   // plusieurs directions, autour du blob
        var far=INTRO_DIST[0]+Math.random()*(INTRO_DIST[1]-INTRO_DIST[0]);
        var tx=Math.max(loX,Math.min(hiX,cx[k]+Math.cos(ang)*far));
        var ty=Math.max(loY,Math.min(hiY,cy[k]+Math.sin(ang)*far));
        isx[k]=tx-cx[k];isy[k]=ty-cy[k];
        isz[k]=.5+Math.random()*1.5;                        // part plus pres de l'oeil
        isr[k]=(Math.random()*2-1)*2.4;
        // le coeur s'assemble en premier, les bords ensuite
        iDelay[k]=INTRO_STAGGER*(.55*Math.min(1,dist/brad)+.45*Math.random());
        iDur[k]=INTRO-INTRO_STAGGER-Math.random()*.15;
        inIntro[k]=1;
      }
      introLeft=N;
      shd.style.opacity='0';
    }

    /* 5. curseur */
    var ptrX=0,ptrY=0,ptrIn=false,mx=0,my=0,pmx=0,pmy=0,mvx=0,mvy=0,hadMouse=false;
    if(!LITE){
      window.addEventListener('pointermove',function(e){ptrX=e.clientX;ptrY=e.clientY;ptrIn=true;},{passive:true});
      document.documentElement.addEventListener('pointerleave',function(){ptrIn=false;});
      window.addEventListener('blur',function(){ptrIn=false;});
    }

    /* 6. boucle */
    var raf=0,visible=true,last=0,t0=0,shiftX=0,shiftY=0,rot=0,shown=false,dead=false;
    var hero=document.getElementById('accueil')||visual;
    var R2=RADIUS*RADIUS;

    function put(i,x,y,z,r,fade){
      for(var v=0;v<3;v++){var o=(i*3+v)*ST;dyn[o]=x;dyn[o+1]=y;dyn[o+2]=z;dyn[o+3]=r;dyn[o+4]=fade;}
    }

    function frame(now){
      raf=0;
      if(dead) return;
      if(!shown){
        t0=now;introStart=now;last=now-16;
        // page ouverte en arriere-plan : l'image a deja ete affichee, on ne rejoue pas l'intro
        if(introLeft&&!root.classList.contains('blob-intro')){
          for(var q0=0;q0<N;q0++){inIntro[q0]=0;put(q0,0,0,0,0,1);}
          introLeft=0;playIntro=false;shd.style.opacity='1';
          if(LITE){restore();return;}
        }
      }
      var dt=Math.min((now-last)/1000,1/30);last=now;
      if(dt<=0) dt=1/60;

      var sy=0,sway=0;
      if(!LITE){
        // flottement (identique a l'animation d'origine : 0 -> -20px, 8s), oscillation lente, leger effet au scroll
        var fl=-10*(1-Math.cos((now-t0)/8000*6.2832));
        sway=.02*Math.sin((now-t0)/5600*6.2832);
        var sp=Math.max(0,Math.min(1,window.scrollY/Math.max(1,hero.offsetHeight)));
        var e=1-Math.exp(-dt*6);
        rot+=(sp*.13-rot)*e;
        shiftX+=(sp*14-shiftX)*e;
        shiftY+=(sp*38-shiftY)*e;
        sy=shiftY+fl;
      }
      var R=rot+sway;

      // curseur ramene dans le repere de l'image
      var active=false;
      if(ptrIn){
        var r=cv.getBoundingClientRect();
        var lx=ptrX-r.left,ly=ptrY-r.top;
        if(lx>=0&&ly>=0&&lx<=r.width&&ly<=r.height){
          var qx=(lx-PAD-shiftX)/scale-IW/2,qy=(ly-PAD-sy)/scale-IH/2;
          var cr=Math.cos(-R),sr=Math.sin(-R);
          mx=cr*qx-sr*qy+IW/2;my=sr*qx+cr*qy+IH/2;
          active=true;
        }
      }
      if(active&&hadMouse){
        var ivx=(mx-pmx)/dt,ivy=(my-pmy)/dt,sp2=Math.sqrt(ivx*ivx+ivy*ivy);
        if(sp2>1400){ivx*=1400/sp2;ivy*=1400/sp2;}
        mvx+=(ivx-mvx)*.35;mvy+=(ivy-mvy)*.35;
      }else{mvx=0;mvy=0;}
      pmx=mx;pmy=my;hadMouse=active;

      var it=(now-introStart)/1000;
      for(var i=0;i<N;i++){
        if(introLeft&&inIntro[i]){
          var u=(it-iDelay[i])/iDur[i];
          if(u<=0){put(i,isx[i],isy[i],isz[i],isr[i],0);continue;}
          if(u<1){
            var w=1-u;w=w*w*w;               // ralentissement doux a l'arrivee
            put(i,isx[i]*w,isy[i]*w,isz[i]*w,isr[i]*w,u<.22?u/.22:1);
            continue;
          }
          inIntro[i]=0;introLeft--;put(i,0,0,0,0,1);   // position exacte
          continue;
        }
        var tx=0,ty=0,tz=0,tr=0,kk=K_BACK*rK[i],f=0;
        if(active){
          var dx=cx[i]-mx,dy=cy[i]-my,d2=dx*dx+dy*dy;
          if(d2<R2){
            var d=Math.sqrt(d2);f=1-d/RADIUS;f*=f;
            var ux,uy;if(d>2){ux=dx/d;uy=dy/d;}else{ux=rAx[i];uy=rAy[i];}
            // un peu de desordre dans la direction pour eviter un cercle trop net
            ux=ux*.8+rAx[i]*.2;uy=uy*.8+rAy[i]*.2;
            var p=PUSH*f*rPush[i];
            tx=ux*p;ty=uy*p;tz=f*rPush[i];tr=f*rRot[i];kk=K_OUT;
            vx[i]+=mvx*f*SWEEP*dt*rPush[i];vy[i]+=mvy*f*SWEEP*dt*rPush[i];
            awake[i]=1;
          }
        }
        if(!awake[i]) continue;
        var cc=2*Math.sqrt(kk)*DAMP;
        vx[i]+=(kk*(tx-ox[i])-cc*vx[i])*dt;ox[i]+=vx[i]*dt;
        vy[i]+=(kk*(ty-oy[i])-cc*vy[i])*dt;oy[i]+=vy[i]*dt;
        vz[i]+=(kk*(tz-oz[i])-cc*vz[i])*dt;oz[i]+=vz[i]*dt;
        vr[i]+=(kk*(tr-or[i])-cc*vr[i])*dt;or[i]+=vr[i]*dt;
        if(f===0&&Math.abs(ox[i])<.04&&Math.abs(oy[i])<.04&&Math.abs(oz[i])<.002&&Math.abs(or[i])<.002&&
           Math.abs(vx[i])<.6&&Math.abs(vy[i])<.6){
          // retour exact a la position d'origine
          ox[i]=oy[i]=oz[i]=or[i]=vx[i]=vy[i]=vz[i]=vr[i]=0;awake[i]=0;
        }
        put(i,ox[i],oy[i],oz[i]<0?0:oz[i],or[i],1);
      }

      gl.bufferSubData(gl.ARRAY_BUFFER,0,dyn);
      gl.uniform2f(U.uShift,shiftX,sy);gl.uniform1f(U.uRot,R);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES,0,N*3);
      shd.style.transform='translate('+shiftX.toFixed(2)+'px,'+sy.toFixed(2)+'px) rotate('+R.toFixed(4)+'rad)';
      if(playIntro&&it<INTRO+.3){var so=(it-.25)/(INTRO-.25);shd.style.opacity=so<0?'0':so>1?'1':so.toFixed(3);}

      if(!shown){shown=true;window.__blobFx=true;img.style.opacity='0';img.style.animation='none';img.style.filter='none';unhide();}
      if(LITE&&!introLeft&&it>INTRO+.05){restore();return;}   // mobile : on rend la main a l'image d'origine
      if(visible) raf=requestAnimationFrame(frame);
    }
    function play(){if(!dead&&!raf&&visible&&!document.hidden){last=performance.now();raf=requestAnimationFrame(frame);}}
    function stop(){if(raf){cancelAnimationFrame(raf);raf=0;}}
    function restore(){
      if(dead) return;
      dead=true;stop();unhide();
      img.style.opacity=img.style.animation=img.style.filter='';
      clip.remove();
      var ext=gl.getExtension('WEBGL_lose_context');if(ext) ext.loseContext();
    }

    // pause hors ecran et onglet masque
    if('IntersectionObserver' in window){
      new IntersectionObserver(function(es){visible=es[0].isIntersecting;if(visible) play(); else stop();},{rootMargin:'60px'}).observe(visual);
    }
    document.addEventListener('visibilitychange',function(){if(document.hidden) stop(); else play();});
    var rz=0;
    window.addEventListener('resize',function(){
      clearTimeout(rz);rz=setTimeout(function(){
        if(dead) return;
        if(!LITE&&matchMedia('(max-width:980px)').matches){restore();return;}
        layout();
      },120);
    });
    cv.addEventListener('webglcontextlost',function(ev){ev.preventDefault();restore();});
    play();
  }

  if(img.complete&&img.naturalWidth) start();
  else{img.addEventListener('load',start,{once:true});img.addEventListener('error',unhide,{once:true});}
})();
