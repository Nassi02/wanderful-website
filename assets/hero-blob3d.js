/* Hero : blob holographique en vraie 3D (WebGL, sans librairie).
   - assets/blob-3d.bin : forme du blob (modele 3D genere a partir de blob-hero.png, allege)
   - la matiere nacree est calculee en temps reel ; l'image d'origine est projetee sur la face avant
   - le blob est decoupe en eclats : introduction a l'arrivee, repulsion sous le curseur, retour exact
   - mobile / tactile, ou 3D indisponible : on passe la main a hero-fragments.js (version image)
   - prefers-reduced-motion : rien, l'image reste affichee telle quelle */
(function(){
  'use strict';
  var root=document.documentElement;
  var base=(document.currentScript&&document.currentScript.src||'/assets/hero-blob3d.js').replace(/[^\/]*$/,'');
  function unhide(){root.classList.remove('blob-intro');}
  var fellBack=false;
  function fallback(){
    if(fellBack) return;fellBack=true;
    var s=document.createElement('script');s.src=base+'hero-fragments.js';s.onerror=unhide;document.head.appendChild(s);
  }
  var visual=document.querySelector('.hero-visual');
  var img=visual&&visual.querySelector('img');
  if(!visual||!img||!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches){unhide();return;}
  if(!matchMedia('(hover:hover) and (pointer:fine)').matches||matchMedia('(max-width:980px)').matches||!window.fetch){fallback();return;}

  /* reglages */
  var SHARDS=440;       // nombre d'eclats
  var KPX=579,CX=726.5,CY=342.5; // placement du modele dans l'image source : px par unite, centre du blob
  var PERSP=.22;        // force de la perspective
  var RADIUS=.21;       // rayon d'influence du curseur (unites modele, ~120 px image)
  var PUSH=.13;         // ecartement maximal
  var LIFT=.3;          // avancee vers l'oeil
  var K_OUT=95,K_BACK=20; // raideur : depart vif, retour lent
  var DAMP=.92;         // 1 = amortissement critique (pas de rebond)
  var SWEEP=1.5;        // part de la vitesse du curseur transmise aux eclats
  var PAD=110;          // marge du canvas autour de l'image (px ecran)
  var SHADOW_PAD=170;
  var INTRO=3.2,INTRO_STAGGER=1;   // duree totale de l'introduction et decalage maximal entre eclats (s)
  var SPIN=.39;         // rotation continue du blob sur lui-meme (rad/s, ~1 tour en 16 s)
  var TURN_X=.3,TURN_Y=.17; // rotation du blob vers le curseur (rad)

  var VS='attribute vec3 aPos;attribute vec3 aNrm;attribute vec3 aCen;attribute vec3 aOff;attribute vec3 aRot;attribute float aCav;attribute float aFade;'+
    'uniform mat3 uR;uniform vec2 uImg;uniform vec2 uCanvas;uniform vec2 uShift;uniform vec2 uC;uniform float uScale;uniform vec2 uPad;uniform float uK;'+
    'varying vec3 vN;varying vec2 vUv;varying float vFront;varying float vCav;varying float vFade;'+
    'vec3 rod(vec3 p,vec3 r){float a=length(r);if(a<.0001)return p;vec3 k=r/a;float c=cos(a),s=sin(a);return p*c+cross(k,p)*s+k*dot(k,p)*(1.-c);}'+
    'void main(){'+
    'vec3 p=aCen+rod(aPos-aCen,aRot)+aOff;vec3 pv=uR*p;vN=uR*rod(aNrm,aRot);'+
    'float ps=1./(1.-pv.z*'+PERSP.toFixed(3)+');'+
    'vec2 d=(uC+vec2(pv.x,-pv.y)*uK*ps)*uScale+uPad+uShift;'+
    'gl_Position=vec4(d.x/uCanvas.x*2.-1.,1.-d.y/uCanvas.y*2.,-pv.z*.35,1.);'+
    'float rs=1./(1.-aPos.z*'+PERSP.toFixed(3)+');'+
    'vUv=(uC+vec2(aPos.x,-aPos.y)*uK*rs)/uImg;vFront=aNrm.z;vCav=aCav;vFade=aFade;}';
  var FS='precision mediump float;uniform sampler2D uTex;uniform float uTime;'+
    'varying vec3 vN;varying vec2 vUv;varying float vFront;varying float vCav;varying float vFade;'+
    'void main(){'+
    'vec3 n=normalize(vN);vec3 col;'+
    'if(gl_FrontFacing){'+
      'float ndv=clamp(n.z,0.,1.);float fr=pow(1.-ndv,2.2);'+
      // nacre : palette lilas / rose / bleu glace qui glisse selon l'angle de vue
      'float t=n.y*.34+n.x*.26+fr*.55+uTime*.015;'+
      'vec3 pal=vec3(.80,.74,.98)+vec3(.13,.12,.03)*cos(6.2832*(t+vec3(0.,.33,.6)));'+
      'pal=mix(pal,vec3(.49,.43,.96),clamp(vCav*1.6,0.,1.)*.7);'+          // violet profond dans les plis
      'vec3 l1=normalize(vec3(-.45,.65,.62));'+
      'pal*=mix(.86,1.05,.5+.5*dot(n,l1));'+
      'float sp=pow(max(dot(n,normalize(l1+vec3(0.,0.,1.))),0.),26.)*.5+pow(max(dot(n,normalize(vec3(.5,.2,.85))),0.),60.)*.3;'+
      // l'image d'origine, projetee sur la face avant, garde les couleurs exactes du blob
      'vec4 tx=texture2D(uTex,vUv);float w=tx.a*smoothstep(.05,.45,vFront)*.78;'+
      'col=mix(pal,tx.rgb/max(tx.a,.001),w);'+
      'col+=sp*(1.-w*.55);'+
      'col=mix(col,vec3(1.,.94,1.),fr*.42);'+
    '}else{'+
      // interieur des eclats : lueur lilas / rose
      'float k=clamp(-n.z,0.,1.);col=mix(vec3(.63,.56,.97),vec3(.96,.82,.99),k);'+
    '}'+
    'gl_FragColor=vec4(min(col,1.)*vFade,vFade);}';

  var ready=0,bin=null;
  function go(){if(++ready===2){try{start();}catch(e){fallback();}}}
  fetch(base+'blob-3d.bin').then(function(r){if(!r.ok) throw 0;return r.arrayBuffer();}).then(function(b){bin=b;go();}).catch(fallback);
  if(img.complete&&img.naturalWidth) go();
  else{img.addEventListener('load',go,{once:true});img.addEventListener('error',unhide,{once:true});}

  function start(){
    var IW=img.naturalWidth,IH=img.naturalHeight;
    if(!IW||!IH){unhide();return;}
    var playIntro=root.classList.contains('blob-intro')&&window.scrollY<visual.offsetHeight*.6;

    /* 1. modele : sommets partages -> eclats (cellules de Voronoi sur la surface) */
    var dv=new DataView(bin),nv=dv.getUint32(0,true),nt=dv.getUint32(4,true);
    var oN=8+((nv*6+3)&~3),oI=oN+((nv*4+3)&~3);
    var P16=new Int16Array(bin,8,nv*3),N8=new Int8Array(bin,oN,nv*4),IDX=new Uint16Array(bin,oI,nt*3);
    var i,j,k,s;
    var tcx=new Float32Array(nt),tcy=new Float32Array(nt),tcz=new Float32Array(nt);
    for(i=0;i<nt;i++){
      var a=IDX[i*3]*3,b=IDX[i*3+1]*3,c=IDX[i*3+2]*3;
      tcx[i]=(P16[a]+P16[b]+P16[c])/196602;tcy[i]=(P16[a+1]+P16[b+1]+P16[c+1])/196602;tcz[i]=(P16[a+2]+P16[b+2]+P16[c+2])/196602;
    }
    var S=Math.min(SHARDS,nt),sx=new Float32Array(S),sy=new Float32Array(S),sz=new Float32Array(S);
    for(s=0;s<S;s++){var r=(Math.random()*nt)|0;sx[s]=tcx[r];sy[s]=tcy[r];sz[s]=tcz[r];}
    var owner=new Uint16Array(nt),count=new Uint32Array(S);
    for(i=0;i<nt;i++){
      var bd=1e9,bs=0,x=tcx[i],y=tcy[i],z=tcz[i];
      for(s=0;s<S;s++){var dx=x-sx[s],dy=y-sy[s],dz=z-sz[s],d=dx*dx+dy*dy+dz*dz;if(d<bd){bd=d;bs=s;}}
      owner[i]=bs;count[bs]++;
    }
    // triangles ranges par eclat : chaque eclat occupe une plage continue de sommets
    var first=new Uint32Array(S+1);for(s=0;s<S;s++) first[s+1]=first[s]+count[s];
    var fill=new Uint32Array(S),order=new Uint32Array(nt);
    for(i=0;i<nt;i++){s=owner[i];order[first[s]+fill[s]++]=i;}
    var cenX=new Float32Array(S),cenY=new Float32Array(S),cenZ=new Float32Array(S);
    var nrX=new Float32Array(S),nrY=new Float32Array(S),nrZ=new Float32Array(S);
    for(s=0;s<S;s++){
      var n=count[s]||1,ax=0,ay=0,az=0,bx=0,by=0,bz=0;
      for(j=first[s];j<first[s+1];j++){
        var t=order[j];ax+=tcx[t];ay+=tcy[t];az+=tcz[t];
        for(k=0;k<3;k++){var vi=IDX[t*3+k]*4;bx+=N8[vi];by+=N8[vi+1];bz+=N8[vi+2];}
      }
      cenX[s]=ax/n;cenY[s]=ay/n;cenZ[s]=az/n;
      var bl=Math.sqrt(bx*bx+by*by+bz*bz)||1;nrX[s]=bx/bl;nrY[s]=by/bl;nrZ[s]=bz/bl;
    }
    var NV=nt*3,SST=10,DST=7;
    var stat=new Float32Array(NV*SST);      // aPos(3) aNrm(3) aCav(1) aCen(3)
    var dyn=new Float32Array(NV*DST);       // aOff(3) aRot(3) aFade(1)
    for(j=0;j<nt;j++){
      var tt=order[j],so=owner[tt];
      for(k=0;k<3;k++){
        var v=IDX[tt*3+k],o=(j*3+k)*SST;
        stat[o]=P16[v*3]/65534;stat[o+1]=P16[v*3+1]/65534;stat[o+2]=P16[v*3+2]/65534;
        stat[o+3]=N8[v*4]/127;stat[o+4]=N8[v*4+1]/127;stat[o+5]=N8[v*4+2]/127;
        stat[o+6]=N8[v*4+3]/127;
        stat[o+7]=cenX[so];stat[o+8]=cenY[so];stat[o+9]=cenZ[so];
        dyn[(j*3+k)*DST+6]=1;
      }
    }
    // etat par eclat
    var ox=new Float32Array(S),oy=new Float32Array(S),oz=new Float32Array(S);
    var vx=new Float32Array(S),vy=new Float32Array(S),vz=new Float32Array(S);
    var rx=new Float32Array(S),ry=new Float32Array(S),rz=new Float32Array(S);
    var wx=new Float32Array(S),wy=new Float32Array(S),wz=new Float32Array(S);
    var rPush=new Float32Array(S),rK=new Float32Array(S),qx=new Float32Array(S),qy=new Float32Array(S),qz=new Float32Array(S);
    var awake=new Uint8Array(S);
    function rndUnit(out,s){var u=Math.random()*2-1,ph=Math.random()*6.2832,q=Math.sqrt(1-u*u);out[0][s]=q*Math.cos(ph);out[1][s]=q*Math.sin(ph);out[2][s]=u;}
    for(s=0;s<S;s++){rPush[s]=.55+Math.random()*.9;rK[s]=.6+Math.random()*.9;rndUnit([qx,qy,qz],s);}

    /* 2. WebGL */
    var cv=document.createElement('canvas');
    cv.setAttribute('aria-hidden','true');
    cv.style.cssText='position:absolute;pointer-events:none;display:block;';
    var gl=cv.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,depth:true,powerPreference:'high-performance'});
    if(!gl){fallback();return;}
    function sh(type,src){var o=gl.createShader(type);gl.shaderSource(o,src);gl.compileShader(o);return gl.getShaderParameter(o,gl.COMPILE_STATUS)?o:null;}
    var v1=sh(gl.VERTEX_SHADER,VS),f1=sh(gl.FRAGMENT_SHADER,FS);
    if(!v1||!f1){fallback();return;}
    var pr=gl.createProgram();gl.attachShader(pr,v1);gl.attachShader(pr,f1);gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr,gl.LINK_STATUS)){fallback();return;}
    gl.useProgram(pr);
    var U={};['uR','uImg','uCanvas','uShift','uC','uScale','uPad','uK','uTex','uTime'].forEach(function(nm){U[nm]=gl.getUniformLocation(pr,nm);});
    function attr(nm,size,stride,off){var l=gl.getAttribLocation(pr,nm);if(l<0) return;gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,size,gl.FLOAT,false,stride*4,off*4);}
    var bs0=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bs0);gl.bufferData(gl.ARRAY_BUFFER,stat,gl.STATIC_DRAW);
    attr('aPos',3,SST,0);attr('aNrm',3,SST,3);attr('aCav',1,SST,6);attr('aCen',3,SST,7);
    stat=null;
    var bd0=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bd0);gl.bufferData(gl.ARRAY_BUFFER,dyn,gl.DYNAMIC_DRAW);
    attr('aOff',3,DST,0);attr('aRot',3,DST,3);attr('aFade',1,DST,6);
    var tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.uTex,0);gl.uniform2f(U.uImg,IW,IH);gl.uniform2f(U.uC,CX,CY);gl.uniform1f(U.uK,KPX);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);

    /* 3. calques fixes : ombre portee, decor (anneaux, spheres, etoiles de l'image d'origine) */
    var shd=document.createElement('canvas');
    shd.setAttribute('aria-hidden','true');
    shd.style.cssText='position:absolute;pointer-events:none;display:block;will-change:transform,opacity;';
    var deco=new Image();
    deco.alt='';deco.setAttribute('aria-hidden','true');deco.decoding='async';
    deco.style.cssText='position:absolute;pointer-events:none;display:block;max-width:none;filter:none;animation:none;will-change:transform,opacity;opacity:0;transition:opacity .6s;';
    deco.onload=function(){deco.style.opacity='1';};
    deco.src=base+'blob-deco.png';
    // conteneur borne a la largeur de la page : les marges des canvas ne creent aucun debordement horizontal
    var clip=document.createElement('div');
    clip.setAttribute('aria-hidden','true');
    clip.style.cssText='position:absolute;overflow:hidden;pointer-events:none;';
    clip.appendChild(shd);clip.appendChild(deco);clip.appendChild(cv);

    // pendant l'introduction le canvas couvre toute la page visible (les eclats arrivent de tous les bords),
    // puis il se resserre autour du visuel
    var scale=1,cssW=0,cssH=0,padL=PAD,padT=PAD,imgW=0,imgH=0,pgL=0,pgT=0,big=playIntro;
    function pageLeft(el){var x=0;while(el){x+=el.offsetLeft;el=el.offsetParent;}return x;}
    function pageTop(el){var y=0;while(el){y+=el.offsetTop;el=el.offsetParent;}return y;}
    function layout(){
      var w=img.offsetWidth,h=img.offsetHeight;
      if(!w||!h) return false;
      imgW=w;imgH=h;scale=w/IW;
      var dpr=Math.min(window.devicePixelRatio||1,2);
      var vl=pageLeft(visual),cw=document.documentElement.clientWidth;
      pgL=vl+img.offsetLeft;pgT=pageTop(visual)+img.offsetTop;
      var padR=PAD,padB=PAD;padL=PAD;padT=PAD;
      if(big){padL=Math.max(PAD,pgL);padR=Math.max(PAD,cw-pgL-w);padT=Math.max(PAD,pgT);padB=Math.max(PAD,window.innerHeight-pgT-h);}
      var TP=Math.max(SHADOW_PAD,padT),BP=Math.max(SHADOW_PAD,padB);
      cssW=w+padL+padR;cssH=h+padT+padB;
      clip.style.left=(-vl)+'px';clip.style.width=cw+'px';
      clip.style.top=(img.offsetTop-TP)+'px';clip.style.height=(h+TP+BP)+'px';
      cv.style.left=(pgL-padL)+'px';cv.style.top=(TP-padT)+'px';
      cv.style.width=cssW+'px';cv.style.height=cssH+'px';
      cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);
      gl.viewport(0,0,cv.width,cv.height);
      gl.uniform2f(U.uCanvas,cssW,cssH);gl.uniform1f(U.uScale,scale);gl.uniform2f(U.uPad,padL,padT);
      deco.style.left=pgL+'px';deco.style.top=TP+'px';
      deco.style.width=w+'px';deco.style.height=h+'px';
      var q=.5,sw=w+SHADOW_PAD*2,shh=h+SHADOW_PAD*2;
      shd.style.left=(pgL-SHADOW_PAD)+'px';shd.style.top=(TP-SHADOW_PAD)+'px';
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
    var inIntro=null,iDelay,iDur,isx,isy,isz,irx,iry,irz,introLeft=0,introStart=0;
    if(playIntro){
      inIntro=new Uint8Array(S);iDelay=new Float32Array(S);iDur=new Float32Array(S);
      isx=new Float32Array(S);isy=new Float32Array(S);isz=new Float32Array(S);
      irx=new Float32Array(S);iry=new Float32Array(S);irz=new Float32Array(S);
      // bords de la page visible, en unites du modele (origine : centre du blob)
      var xL=(-pgL/scale-CX)/KPX,xR=((document.documentElement.clientWidth-pgL)/scale-CX)/KPX;
      var yT=(pgT/scale+CY)/KPX,yB=-((window.innerHeight-pgT)/scale-CY)/KPX;
      for(s=0;s<S;s++){
        // chaque eclat entre par un point au hasard du pourtour de la page
        var th=Math.random()*6.2832,ddx=Math.cos(th),ddy=Math.sin(th);
        var tE=Math.min(ddx>0?xR/ddx:xL/ddx,ddy>0?yT/ddy:yB/ddy)*(1.05+Math.random()*.3);
        isz[s]=Math.random()*.45;
        var pz0=1-(cenZ[s]+isz[s])*PERSP;            // compense la perspective pour partir du bord
        isx[s]=ddx*tE*pz0-cenX[s];isy[s]=ddy*tE*pz0-cenY[s];
        var ra=1.2+Math.random()*1.8;irx[s]=qy[s]*ra;iry[s]=qz[s]*ra;irz[s]=qx[s]*ra;
        var dc=Math.sqrt(cenX[s]*cenX[s]+cenY[s]*cenY[s]+cenZ[s]*cenZ[s])/.55;
        iDelay[s]=INTRO_STAGGER*(.3*Math.min(1,dc)+.7*Math.random());
        iDur[s]=INTRO-INTRO_STAGGER-Math.random()*.25;
        inIntro[s]=1;
      }
      introLeft=S;
      shd.style.opacity='0';
    }

    /* 5. curseur */
    var ptrX=0,ptrY=0,ptrIn=false,mx=0,my=0,pmx=0,pmy=0,mvx=0,mvy=0,hadMouse=false;
    window.addEventListener('pointermove',function(e){ptrX=e.clientX;ptrY=e.clientY;ptrIn=true;},{passive:true});
    document.documentElement.addEventListener('pointerleave',function(){ptrIn=false;});
    window.addEventListener('blur',function(){ptrIn=false;});

    /* 6. boucle */
    var raf=0,visible=true,last=0,t0=0,shiftX=0,shiftY=0,scr=0,tAx=0,tAy=0,spin=0,spinK=0,shown=false,dead=false;
    var hero=document.getElementById('accueil')||visual;
    var R=new Float32Array(9),dirty0=NV,dirty1=0;

    function put(s,x,y,z,a,b,c,fade){
      var v0=first[s]*3,v1=first[s+1]*3;
      for(var v=v0;v<v1;v++){var o=v*DST;dyn[o]=x;dyn[o+1]=y;dyn[o+2]=z;dyn[o+3]=a;dyn[o+4]=b;dyn[o+5]=c;dyn[o+6]=fade;}
      if(v0<dirty0) dirty0=v0;if(v1>dirty1) dirty1=v1;
    }

    function frame(now){
      raf=0;
      if(dead) return;
      if(!shown){
        t0=now;introStart=now;last=now-16;
        // page ouverte en arriere-plan : l'image a deja ete affichee, on ne rejoue pas l'intro
        if(introLeft&&!root.classList.contains('blob-intro')){
          for(var q0=0;q0<S;q0++){inIntro[q0]=0;put(q0,0,0,0,0,0,0,1);}
          introLeft=0;playIntro=false;shd.style.opacity='1';
          if(big){big=false;layout();}
        }
      }
      var dt=Math.min((now-last)/1000,1/30);last=now;
      if(dt<=0) dt=1/60;
      var T=(now-t0)/1000,e=1-Math.exp(-dt*6),e2=1-Math.exp(-dt*3.2);

      // flottement (identique a l'animation d'origine), oscillation lente, effet au scroll
      var fl=-10*(1-Math.cos(T/8*6.2832));
      var sp=Math.max(0,Math.min(1,window.scrollY/Math.max(1,hero.offsetHeight)));
      scr+=(sp-scr)*e;shiftX=scr*14;shiftY=scr*38;
      var sy0=shiftY+fl;

      // le blob se tourne doucement vers le curseur, ou qu'il soit sur la page
      var rect=cv.getBoundingClientRect(),wantX=0,wantY=0;
      if(ptrIn){
        wantX=Math.max(-1,Math.min(1,(ptrX-(rect.left+padL+imgW/2))/(window.innerWidth*.5)))*TURN_X;
        wantY=Math.max(-1,Math.min(1,(ptrY-(rect.top+padT+imgH/2))/(window.innerHeight*.5)))*TURN_Y;
      }
      tAx+=(wantX-tAx)*e2;tAy+=(wantY-tAy)*e2;
      // une fois assemble, le blob tourne lentement sur lui-meme (demarrage progressif)
      if(!introLeft){spinK+=(1-spinK)*(1-Math.exp(-dt*.9));spin+=SPIN*spinK*dt;}
      var ay=spin+tAx+.1*Math.sin(T/7*6.2832)+scr*.55,ax=tAy+.06*Math.sin(T/9.5*6.2832);
      var cy_=Math.cos(ay),sy_=Math.sin(ay),cx_=Math.cos(ax),sx_=Math.sin(ax);
      // R = Ry(ay) * Rx(ax), en colonnes
      R[0]=cy_;R[1]=0;R[2]=-sy_;
      R[3]=sy_*sx_;R[4]=cx_;R[5]=cy_*sx_;
      R[6]=sy_*cx_;R[7]=-sx_;R[8]=cy_*cx_;

      // curseur dans le plan de vue du modele
      var active=false;
      if(ptrIn){
        var lx=ptrX-rect.left,ly=ptrY-rect.top;
        if(lx>=0&&ly>=0&&lx<=rect.width&&ly<=rect.height){
          mx=((lx-padL-shiftX)/scale-CX)/KPX;my=-((ly-padT-sy0)/scale-CY)/KPX;
          active=true;
        }
      }
      if(active&&hadMouse){
        var ivx=(mx-pmx)/dt,ivy=(my-pmy)/dt,sp2=Math.sqrt(ivx*ivx+ivy*ivy);
        if(sp2>2.4){ivx*=2.4/sp2;ivy*=2.4/sp2;}
        mvx+=(ivx-mvx)*.35;mvy+=(ivy-mvy)*.35;
      }else{mvx=0;mvy=0;}
      pmx=mx;pmy=my;hadMouse=active;

      var it=(now-introStart)/1000;
      for(var s=0;s<S;s++){
        if(introLeft&&inIntro[s]){
          var u=(it-iDelay[s])/iDur[s];
          if(u<=0){put(s,isx[s],isy[s],isz[s],irx[s],iry[s],irz[s],0);continue;}
          if(u<1){
            var w=1-u;w=w*w;                 // ralentissement doux a l'arrivee
            put(s,isx[s]*w,isy[s]*w,isz[s]*w,irx[s]*w,iry[s]*w,irz[s]*w,u<.1?u/.1:1);
            continue;
          }
          inIntro[s]=0;introLeft--;put(s,0,0,0,0,0,0,1);   // position exacte
          continue;
        }
        var tx=0,ty=0,tz=0,ta=0,tb=0,tc=0,kk=K_BACK*rK[s],f=0;
        if(active){
          // normale et centre de l'eclat dans le repere de vue
          var nz=R[2]*nrX[s]+R[5]*nrY[s]+R[8]*nrZ[s];
          if(nz>.05){
            var X=cenX[s],Y=cenY[s],Z=cenZ[s];
            var px=R[0]*X+R[3]*Y+R[6]*Z,py=R[1]*X+R[4]*Y+R[7]*Z,pz=R[2]*X+R[5]*Y+R[8]*Z;
            var ps=1/(1-pz*PERSP),dx=px*ps-mx,dy=py*ps-my,d2=dx*dx+dy*dy;
            if(d2<RADIUS*RADIUS){
              var d=Math.sqrt(d2);f=1-d/RADIUS;f*=f;f*=Math.min(1,nz*3);
              var ux,uy;if(d>.004){ux=dx/d;uy=dy/d;}else{ux=qx[s];uy=qy[s];}
              ux=ux*.8+qx[s]*.2;uy=uy*.8+qy[s]*.2;
              var p=PUSH*f*rPush[s],gx=ux*p,gy=uy*p,gz=LIFT*f*rPush[s];
              // cible et elan ramenes dans le repere du modele (R transposee)
              tx=R[0]*gx+R[1]*gy+R[2]*gz;ty=R[3]*gx+R[4]*gy+R[5]*gz;tz=R[6]*gx+R[7]*gy+R[8]*gz;
              var a2=1.5*f;ta=qy[s]*a2;tb=qz[s]*a2;tc=qx[s]*a2;kk=K_OUT;
              var hx=mvx*f*SWEEP*dt*rPush[s],hy=mvy*f*SWEEP*dt*rPush[s];
              vx[s]+=R[0]*hx+R[1]*hy;vy[s]+=R[3]*hx+R[4]*hy;vz[s]+=R[6]*hx+R[7]*hy;
              awake[s]=1;
            }
          }
        }
        if(!awake[s]) continue;
        var cc=2*Math.sqrt(kk)*DAMP;
        vx[s]+=(kk*(tx-ox[s])-cc*vx[s])*dt;ox[s]+=vx[s]*dt;
        vy[s]+=(kk*(ty-oy[s])-cc*vy[s])*dt;oy[s]+=vy[s]*dt;
        vz[s]+=(kk*(tz-oz[s])-cc*vz[s])*dt;oz[s]+=vz[s]*dt;
        wx[s]+=(kk*(ta-rx[s])-cc*wx[s])*dt;rx[s]+=wx[s]*dt;
        wy[s]+=(kk*(tb-ry[s])-cc*wy[s])*dt;ry[s]+=wy[s]*dt;
        wz[s]+=(kk*(tc-rz[s])-cc*wz[s])*dt;rz[s]+=wz[s]*dt;
        if(f===0&&Math.abs(ox[s])<.0002&&Math.abs(oy[s])<.0002&&Math.abs(oz[s])<.0002&&
           Math.abs(rx[s])<.002&&Math.abs(ry[s])<.002&&Math.abs(rz[s])<.002&&
           Math.abs(vx[s])<.002&&Math.abs(vy[s])<.002&&Math.abs(vz[s])<.002){
          // retour exact a la position d'origine
          ox[s]=oy[s]=oz[s]=vx[s]=vy[s]=vz[s]=rx[s]=ry[s]=rz[s]=wx[s]=wy[s]=wz[s]=0;awake[s]=0;
        }
        put(s,ox[s],oy[s],oz[s],rx[s],ry[s],rz[s],1);
      }

      if(big&&!introLeft){big=false;layout();}     // intro terminee : le canvas se resserre autour du visuel
      if(dirty1>dirty0){
        gl.bufferSubData(gl.ARRAY_BUFFER,dirty0*DST*4,dyn.subarray(dirty0*DST,dirty1*DST));
        dirty0=NV;dirty1=0;
      }
      gl.uniformMatrix3fv(U.uR,false,R);
      gl.uniform2f(U.uShift,shiftX,sy0);gl.uniform1f(U.uTime,T);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES,0,NV);
      var tr='translate('+shiftX.toFixed(2)+'px,'+sy0.toFixed(2)+'px)';
      shd.style.transform=tr;deco.style.transform=tr;
      if(playIntro&&it<INTRO+.3){var so=(it-.25)/(INTRO-.25);shd.style.opacity=so<0?'0':so>1?'1':so.toFixed(3);}

      if(!shown){shown=true;window.__blobFx=true;img.style.opacity='0';img.style.animation='none';img.style.filter='none';unhide();}
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
    var rz0=0;
    window.addEventListener('resize',function(){
      clearTimeout(rz0);rz0=setTimeout(function(){
        if(dead) return;
        if(matchMedia('(max-width:980px)').matches){restore();return;}
        layout();
      },120);
    });
    cv.addEventListener('webglcontextlost',function(ev){ev.preventDefault();restore();});
    play();
  }
})();
