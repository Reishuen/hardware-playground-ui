/* env.js — the four task environments and the procedural fly. Expects globals: cssv, hist, HISTLEN. */
/* A procedural fly, drawn on any canvas. `flap` 0..1 drives the wings, `look` the head angle. */
function drawFly(g,x,y,sz,flap,look=0,facing=1){
  g.save(); g.translate(x,y); g.scale(facing*sz,sz);
  const wa=0.25+0.9*flap*Math.abs(Math.sin(performance.now()/22));
  g.fillStyle="rgba(180,190,205,0.45)"; for (const sgn of [-1,1]){ g.save(); g.rotate(-0.9-wa*sgn*0.5); g.beginPath(); g.ellipse(-8,-10*sgn,16,6,0,0,7); g.fill(); g.restore(); }
  g.fillStyle="#3b3f4a"; g.beginPath(); g.ellipse(-4,0,14,7,0,0,7); g.fill();                    // abdomen
  g.fillStyle="#2a2e38"; g.beginPath(); g.ellipse(6,-1,7,6,0,0,7); g.fill();                     // thorax
  g.save(); g.translate(13,-2); g.rotate(look); g.fillStyle="#2a2e38"; g.beginPath(); g.arc(0,0,5,0,7); g.fill();
  g.fillStyle="#c85a50"; g.beginPath(); g.arc(2,-2,2.6,0,7); g.fill(); g.beginPath(); g.arc(2,2,2.6,0,7); g.fill(); g.restore();  // compound eyes
  g.strokeStyle="#2a2e38"; g.lineWidth=1.2; for (let i=0;i<3;i++){ g.beginPath(); g.moveTo(2+i*3,4); g.lineTo(-2+i*5,12); g.stroke(); }
  g.restore();
}
const ENV = {
  /* ---- doomscroll: a phone showing short-form reels; the fly perched beside it ---- */
  doomscroll:{ init(){ this.posts=[]; this.y=0; this.score=0; this.t=0; for(let i=0;i<4;i++) this.spawn(i); },
    spawn(i){ this.posts.push({y:(this.posts.length?Math.max(...this.posts.map(p=>p.y)):-1)+1, nov:0.35+Math.random()*0.65, seen:0, hue:Math.floor(Math.random()*360), kind:Math.floor(Math.random()*3), seed:Math.random()*100}); },
    observe(){ const p=this.posts.find(q=>q.y>-0.5)||this.posts[0]; return {visual:p?Math.max(0,p.nov):0}; },
    step(a){ this.t++; const top=this.posts.find(q=>q.y>-0.5); if(top){ top.seen+=1; top.nov*=0.992; }
      this.low = a.scroll ? 0 : (this.low||0)+1; const advance = this.low > 6 ? 0.045 : 0;
      for(const p of this.posts) p.y-=advance; this.posts=this.posts.filter(p=>p.y>-1.2); while(this.posts.length<5) this.spawn(); if(advance) this.score+=1; },
    draw(g,W,H){ const ph=H*0.94, pw=ph*0.5, px=W*0.5-pw/2, py=H*0.03;   // phone
      g.fillStyle="#1e2532"; g.beginPath(); g.roundRect(px-8,py-8,pw+16,ph+16,18); g.fill(); g.save(); g.beginPath(); g.roundRect(px,py,pw,ph,12); g.clip();
      for(const p of this.posts){ const y=py+p.y*ph; if(y>py+ph||y+ph<py) continue;    // procedural "reel": animated pattern, brightness = novelty
        const t=this.t/30+p.seed; g.fillStyle=`hsl(${p.hue},45%,${8+p.nov*22}%)`; g.fillRect(px,y,pw,ph);
        g.globalAlpha=0.35+0.65*p.nov;
        if(p.kind===0){ for(let i=0;i<7;i++){ g.fillStyle=`hsl(${(p.hue+i*40)%360},70%,60%)`; const r=pw*0.12*(1+0.4*Math.sin(t*2+i)); g.beginPath(); g.arc(px+pw*(0.2+0.6*((i*0.37+t*0.1)%1)), y+ph*(0.2+0.6*((i*0.61+t*0.07)%1)), r,0,7); g.fill(); } }
        else if(p.kind===1){ for(let i=0;i<10;i++){ g.fillStyle=`hsl(${(p.hue+i*25)%360},70%,${50+20*Math.sin(t*3+i)}%)`; g.fillRect(px+pw*(i/10), y+ph*0.5+Math.sin(t*2+i*0.8)*ph*0.25, pw/10-2, ph*0.1); } }
        else { g.strokeStyle=`hsl(${(p.hue+180)%360},80%,65%)`; g.lineWidth=4; g.beginPath(); for(let i=0;i<=40;i++){ const u=i/40; const xx=px+pw*u, yy=y+ph*0.5+Math.sin(u*9+t*3)*ph*0.2*Math.cos(t+u*3); i?g.lineTo(xx,yy):g.moveTo(xx,yy); } g.stroke(); }
        g.globalAlpha=1; g.fillStyle="rgba(255,255,255,0.8)"; g.font="12px IBM Plex Sans"; g.fillText(`novelty ${p.nov.toFixed(2)}`, px+12, y+ph-14); }
      g.restore();
      drawFly(g, px-58, py+ph*0.55, 1.6, Math.min(1,(hist.mbon?hist.mbon[HISTLEN-1]:0)/60), -0.35, 1);
      g.fillStyle=cssv("--ink-mute"); g.font="12px IBM Plex Mono"; g.textAlign="left"; g.fillText(`reels advanced: ${this.score}`, 16, 24); g.fillText(`the fly watches while MBON novelty is high`, 16, 42); } },
  /* ---- stonks: candlestick chart, position marker, the fly at the desk ------------- */
  stonks:{ init(){ this.c=[]; let v=100; for(let i=0;i<48;i++){ const o=v; v+=Math.random()*2-1; this.c.push({o,h:Math.max(o,v)+Math.random(),l:Math.min(o,v)-Math.random(),c:v}); } this.cur={o:v,h:v,l:v,c:v,n:0}; this.pos=0; this.cash=0; this.trend=0; this.last=null; },
    observe(){ const k=this.c.slice(-6); const rng=Math.max(...k.map(x=>x.h))-Math.min(...k.map(x=>x.l)); return {visual:Math.min(1,rng/4), dan_reward:Math.max(0,this.last||0), dan_punish:Math.max(0,-(this.last||0))}; },
    step(a){ if(Math.random()<0.02) this.trend=(Math.random()*2-1)*0.5; const d=this.trend+Math.random()*1.2-0.6; const nv=this.cur.c+d; this.cur.c=nv; this.cur.h=Math.max(this.cur.h,nv); this.cur.l=Math.min(this.cur.l,nv); this.cur.n++;
      if(this.cur.n>=6){ this.c.push({...this.cur}); if(this.c.length>60) this.c.shift(); this.cur={o:nv,h:nv,l:nv,c:nv,n:0}; }
      this.pos = a.side==="buy"?1:0; const pnl=this.pos*d; this.cash+=pnl; this.last=Math.max(-1,Math.min(1,pnl)); },
    draw(g,W,H){ const all=[...this.c,this.cur]; const lo=Math.min(...all.map(x=>x.l)), hi=Math.max(...all.map(x=>x.h)); const X=i=>W*0.08+i/(all.length)*(W*0.7), Y=v=>H*0.9-(v-lo)/(hi-lo+1e-9)*(H*0.75); const cw=Math.max(3,(W*0.7)/all.length*0.6);
      g.strokeStyle=cssv("--rule-soft"); for(let k=0;k<=4;k++){ const y=H*0.15+k*H*0.75/4; g.beginPath(); g.moveTo(W*0.06,y); g.lineTo(W*0.8,y); g.stroke(); }
      all.forEach((k,i)=>{ const up=k.c>=k.o; g.strokeStyle=g.fillStyle= up?cssv("--ok"):cssv("--crit"); g.beginPath(); g.moveTo(X(i),Y(k.h)); g.lineTo(X(i),Y(k.l)); g.stroke(); g.fillRect(X(i)-cw/2, Y(Math.max(k.o,k.c)), cw, Math.max(1,Math.abs(Y(k.o)-Y(k.c)))); });
      g.fillStyle=this.pos?cssv("--ok"):cssv("--ink-mute"); g.font="600 13px IBM Plex Sans"; g.textAlign="left"; g.fillText(this.pos?"LONG":"flat", W*0.82, Y(this.cur.c)+4);
      g.fillStyle=cssv("--ink-mute"); g.font="12px IBM Plex Mono"; g.fillText(`BTC-USDC (synthetic)  paper P&L ${this.cash>=0?"+":""}${this.cash.toFixed(1)}  ·  ${this.cur.c.toFixed(2)}`, 16, 24);
      drawFly(g, W*0.9, H*0.72, 1.7, 0.2+0.8*(this.pos), -0.6, -1); } },
  /* ---- doom: first-person raycast corridor; the fly is you ------------------------- */
  doom:{ MAP:["##########","#........#","#..##....#","#..#.....#","#....#...#","#..###...#","#........#","#.#....#.#","#........#","##########"],
    init(){ this.px=1.5;this.py=1.5;this.a=0.3; this.ex=7.5;this.ey=6.5;this.et=Math.random()*7; this.shots=0;this.hits=0;this.flash=0;this.hurt=0; },
    wall(x,y){ const r=this.MAP[Math.floor(y)]; return !r || r[Math.floor(x)]!=="."; },
    observe(){ const dx=this.ex-this.px, dy=this.ey-this.py; let b=Math.atan2(dy,dx)-this.a; b=Math.atan2(Math.sin(b),Math.cos(b)); const dist=Math.hypot(dx,dy); const near=Math.max(0,1-dist/7); const vis=Math.abs(b)<0.8?1:0.15;
      return {visual_left:vis*(Math.max(0,Math.sin(-b))*0.7+near*0.3), visual_right:vis*(Math.max(0,Math.sin(b))*0.7+near*0.3), p1_command:0.4+0.6*near, dan:this.flash>0?1:0}; },
    step(a){ this.a+=a.turn*0.09; if(a.forward){ const nx=this.px+Math.cos(this.a)*0.05, ny=this.py+Math.sin(this.a)*0.05; if(!this.wall(nx,this.py)) this.px=nx; if(!this.wall(this.px,ny)) this.py=ny; }
      this.et+=0.02; const tx=5.5+2.5*Math.cos(this.et), ty=4.5+2*Math.sin(this.et*0.8); if(!this.wall(tx,ty)){ this.ex=tx; this.ey=ty; }
      this.flash=Math.max(0,this.flash-1); this.hurt=Math.max(0,this.hurt-1);
      if(a.shoot && Math.random()<0.07){ this.shots++; const dx=this.ex-this.px,dy=this.ey-this.py; let b=Math.atan2(dy,dx)-this.a; b=Math.atan2(Math.sin(b),Math.cos(b)); this.muzzle=6; if(Math.abs(b)<0.18){ this.hits++; this.flash=14; this.ex=1.5+Math.random()*7; this.ey=1.5+Math.random()*7; if(this.wall(this.ex,this.ey)){ this.ex=7.5; this.ey=6.5; } } }
      this.muzzle=Math.max(0,(this.muzzle||0)-1); },
    draw(g,W,H){ const cols=Math.min(240,W>>1), fov=1.05, cw=W/cols; const depth=new Float32Array(cols);
      g.fillStyle="#141a24"; g.fillRect(0,0,W,H/2); g.fillStyle="#1b2130"; g.fillRect(0,H/2,W,H/2);
      for(let c=0;c<cols;c++){ const ra=this.a-fov/2+fov*(c/cols); let t=0, hit=false, side=0; const sx=Math.cos(ra), sy=Math.sin(ra);
        while(t<12&&!hit){ t+=0.02; const x=this.px+sx*t, y=this.py+sy*t; if(this.wall(x,y)){ hit=true; side=Math.abs((x%1)-0.5)>Math.abs((y%1)-0.5)?1:0; } }
        const d=t*Math.cos(ra-this.a); depth[c]=d; const hh=Math.min(H,H*0.9/Math.max(0.2,d)); const sh=Math.max(0.12,1-d/9)*(side?0.85:1);
        g.fillStyle=`rgb(${Math.floor(90*sh)},${Math.floor(105*sh)},${Math.floor(130*sh)})`; g.fillRect(c*cw,(H-hh)/2,cw+1,hh); }
      // enemy sprite (billboard), depth-tested against walls
      { const dx=this.ex-this.px, dy=this.ey-this.py; const dist=Math.hypot(dx,dy); let b=Math.atan2(dy,dx)-this.a; b=Math.atan2(Math.sin(b),Math.cos(b));
        if(Math.abs(b)<fov/2+0.3){ const sxp=W/2+Math.tan(b)/Math.tan(fov/2)*W/2; const sz=Math.min(H,H*0.6/Math.max(0.3,dist)); const col=Math.floor(sxp/cw); if(col>=0&&col<cols&&depth[col]>dist*0.95 || col<0||col>=cols){
          g.fillStyle=this.flash?cssv("--warn"):"#c85a50"; g.beginPath(); g.ellipse(sxp,H/2+sz*0.15,sz*0.28,sz*0.4,0,0,7); g.fill(); g.fillStyle="#f0d0a0"; g.beginPath(); g.arc(sxp-sz*0.08,H/2-sz*0.05,sz*0.05,0,7); g.arc(sxp+sz*0.08,H/2-sz*0.05,sz*0.05,0,7); g.fill(); } } }
      // crosshair + muzzle + the fly (you) at the bottom, wings beating with P1 arousal
      g.strokeStyle="rgba(232,236,241,0.8)"; g.lineWidth=1.5; g.beginPath(); g.moveTo(W/2-10,H/2); g.lineTo(W/2+10,H/2); g.moveTo(W/2,H/2-10); g.lineTo(W/2,H/2+10); g.stroke();
      if(this.muzzle){ g.fillStyle=`rgba(255,220,120,${this.muzzle/8})`; g.beginPath(); g.arc(W/2,H*0.86,30+this.muzzle*4,0,7); g.fill(); }
      drawFly(g, W/2, H*0.9, 2.6, Math.min(1,(hist.p1_command?hist.p1_command[HISTLEN-1]:0)/60), 0, 1);
      g.fillStyle=cssv("--ink-mute"); g.font="12px IBM Plex Mono"; g.textAlign="left"; g.fillText(`shots ${this.shots}  hits ${this.hits}  ·  ViZDoom stand-in: raycast corridor, one enemy`, 16, 24); } },
  /* ---- beatsaber: a 3D lane; the fly at the bottom with two sabers ------------------ */
  beatsaber:{ init(){ this.tiles=[]; this.t=0; this.hits=0; this.miss=0; this.swing=0; },
    observe(){ const n=this.tiles.filter(t=>t.z>0).sort((a,b)=>a.z-b.z)[0]; const loom=n?Math.max(0,1-n.z/400):0; return {visual_loom:loom, p1_command:0.6+0.4*loom}; },
    step(a){ this.t++; if(this.t%70===0) this.tiles.push({z:400,lane:Math.random()<0.5?0:1,hit:false}); for(const t of this.tiles) t.z-=3.2; this.swing=Math.max(0,this.swing-1);
      if(a.swing && this.swing===0){ this.swing=12; for(const t of this.tiles) if(!t.hit && t.z>0 && t.z<50){ t.hit=true; this.hits++; } }
      for(const t of this.tiles) if(!t.hit && t.z<-5 && !t.counted){ t.counted=true; this.miss++; } this.tiles=this.tiles.filter(t=>t.z>-40); },
    draw(g,W,H){ const cx=W/2, hz=H*0.8, horizon=H*0.18; g.fillStyle="#141a24"; g.fillRect(0,0,W,horizon);
      for(let i=0;i<=10;i++){ const u=i/10; const y=horizon+(hz-horizon)*u*u; g.strokeStyle=`rgba(167,139,236,${0.08+0.25*u})`; g.beginPath(); g.moveTo(cx-(40+W*0.3*u),y); g.lineTo(cx+(40+W*0.3*u),y); g.stroke(); }
      g.strokeStyle="rgba(167,139,236,.5)"; g.beginPath(); g.moveTo(cx-40,horizon); g.lineTo(cx-W*0.3-40,hz); g.moveTo(cx+40,horizon); g.lineTo(cx+W*0.3+40,hz); g.moveTo(cx,horizon); g.lineTo(cx,hz); g.stroke();
      g.strokeStyle=cssv("--accent"); g.setLineDash([6,6]); g.beginPath(); g.moveTo(cx-W*0.3-40,hz-8); g.lineTo(cx+W*0.3+40,hz-8); g.stroke(); g.setLineDash([]);
      for(const t of this.tiles.slice().sort((a,b)=>b.z-a.z)){ const u=1-Math.max(0.02,t.z/400); const y=horizon+(hz-horizon)*u*u; const w=(40+W*0.3*u); const x=cx+(t.lane?1:-1)*w*0.5; const sz=6+30*u; g.fillStyle=t.hit?cssv("--ok"):(t.lane?"#e0776a":"#68a8d6"); g.globalAlpha=t.hit?0.35:0.95; g.fillRect(x-sz/2,y-sz/2,sz,sz); g.globalAlpha=1; }
      // the fly, with two sabers; swing arcs when the wing-motor readout fires
      const sw=this.swing/12; for(const sgn of [-1,1]){ g.strokeStyle=sgn<0?"#e0776a":"#68a8d6"; g.lineWidth=5; g.lineCap="round"; g.beginPath(); g.moveTo(cx+sgn*26,H*0.9); g.lineTo(cx+sgn*(26+70*Math.cos(0.6-sw*1.6)), H*0.9-70*Math.sin(0.6+sw*1.2)); g.stroke(); }
      drawFly(g, cx, H*0.92, 2.4, Math.min(1,(hist.pip10?hist.pip10[HISTLEN-1]:0)/60), 0, 1);
      g.fillStyle=cssv("--ink-mute"); g.font="12px IBM Plex Mono"; g.textAlign="left"; g.fillText(`hits ${this.hits}  missed ${this.miss}  ·  swing = wing-motor rate > 15 Hz`, 16, 24); } },
};
if(!CanvasRenderingContext2D.prototype.roundRect){ CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){ this.moveTo(x+r,y); this.arcTo(x+w,y,x+w,y+h,r); this.arcTo(x+w,y+h,x,y+h,r); this.arcTo(x,y+h,x,y,r); this.arcTo(x,y,x+w,y,r); this.closePath(); }; }
