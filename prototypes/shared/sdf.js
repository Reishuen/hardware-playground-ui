/* sdf.js — a signed-distance voxel field, raymarched in WebGL2.
 *
 * The air-CAD notes: represent the model as an SDF, not a mesh, because then carving is
 * max(d, -brush) and slicing is a clip in the shader — one line each, instead of runtime
 * CSG booleans. Air-painting is the same engine with the operator flipped to min.
 *
 *   const v = createSDF(canvas, {N:96, init:(x,y,z)=>sdf});   // init in world units, box is [-0.5,0.5]^3
 *   v.brush([x,y,z], r, "carve" | "add");                     // edits the field + uploads the region
 *   v.slice = 0.1 | null;  v.orbit(dTheta, dPhi);  v.dist *= k;  v.render(brushPos, brushR);
 *   v.pick(nx, ny)  → world point on the surface under normalised screen coords (or null)
 *
 * Storage: R8 texture, distance clamped to ±RANGE (4 voxels) so linear filtering works
 * everywhere and each voxel costs one byte. 96^3 = 884k voxels ≈ 0.9 MB.
 */
(function(){
  const VS = `#version 300 es
  in vec2 p; out vec2 v; void main(){ v=p; gl_Position=vec4(p,0.,1.); }`;
  const FS = `#version 300 es
  precision highp float; precision highp sampler3D;
  in vec2 v; out vec4 o;
  uniform sampler3D uF; uniform mat3 uRot; uniform float uDist, uAspect, uRange, uSlice, uBrushR, uVox;
  uniform int uSliceOn; uniform vec3 uBrush, uBg, uCol, uCut, uPaint; uniform int uMode;
  float fld(vec3 p){ return (texture(uF, p+0.5).r*2.0-1.0)*uRange; }
  float map(vec3 p){ float d=fld(p); if(uSliceOn==1) d=max(d, p.x-uSlice); return d; }
  vec3 nrm(vec3 p){ vec2 e=vec2(uVox*0.75,0.); return normalize(vec3(map(p+e.xyy)-map(p-e.xyy), map(p+e.yxy)-map(p-e.yxy), map(p+e.yyx)-map(p-e.yyx))); }
  vec2 box(vec3 ro, vec3 rd){ vec3 m=1./rd; vec3 n=m*ro; vec3 k=abs(m)*0.5; vec3 t1=-n-k, t2=-n+k; return vec2(max(max(t1.x,t1.y),t1.z), min(min(t2.x,t2.y),t2.z)); }
  void main(){
    vec3 ro = uRot*vec3(0.,0.,uDist);
    vec3 rd = uRot*normalize(vec3(v.x*uAspect*0.55, v.y*0.55, -1.));
    vec2 tb = box(ro, rd);
    vec3 col = uBg;
    float t = max(tb.x, 0.0); bool hit=false; vec3 p;
    if (tb.y > t){
      for (int i=0;i<200;i++){ p = ro+rd*t; float d = map(p); if (d < uVox*0.35){ hit=true; break; } t += max(d*0.8, uVox*0.25); if (t > tb.y) break; }
    }
    if (hit){
      vec3 n = nrm(p);
      bool cut = uSliceOn==1 && (p.x - uSlice) > fld(p) - uVox*0.5;
      vec3 base = cut ? uCut : uCol;
      vec3 l1 = normalize(uRot*vec3(0.5,0.8,0.6)); vec3 l2 = normalize(uRot*vec3(-0.6,0.2,-0.4));
      float dif = max(0., dot(n,l1))*0.85 + max(0., dot(n,l2))*0.35 + 0.18;
      float rim = pow(1.0-max(0.,dot(n,-rd)), 3.0)*0.25;
      col = base*dif + rim;
      // faint contour lines every 0.05 world units on the cut face, like a section drawing
      if (cut){ float g = abs(fract((p.y+p.z)*20.0)-0.5); col *= 0.85+0.15*smoothstep(0.02,0.06,g); }
    }
    // brush: translucent sphere, always visible
    vec3 oc = ro-uBrush; float b=dot(oc,rd); float c=dot(oc,oc)-uBrushR*uBrushR; float h=b*b-c;
    if (h>0.0){ float tb1=-b-sqrt(h); if (!hit || tb1 < t){ col = mix(col, uPaint, 0.45); } else col = mix(col, uPaint, 0.12); }
    o = vec4(col,1.);
  }`;
  function compile(gl, type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  const hex = h => { const n=parseInt(h.replace("#",""),16); return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]; };

  window.createSDF = function(canvas, opts={}){
    const N = opts.N || 96, RANGE = 4/N, VOX = 1/N;
    const gl = canvas.getContext("webgl2", {antialias:false, alpha:false});
    if (!gl) throw new Error("WebGL2 is required");
    const prog = gl.createProgram(); gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; for (const n of ["uF","uRot","uDist","uAspect","uRange","uSlice","uBrushR","uVox","uSliceOn","uBrush","uBg","uCol","uCut","uPaint","uMode"]) U[n]=gl.getUniformLocation(prog,n);

    const field = new Float32Array(N*N*N), bytes = new Uint8Array(N*N*N);
    const idx = (x,y,z) => x + N*(y + N*z);
    const toByte = d => Math.max(0, Math.min(255, Math.round((Math.max(-RANGE, Math.min(RANGE, d))/RANGE*0.5+0.5)*255)));
    const init = opts.init || (() => RANGE);
    for (let z=0;z<N;z++) for (let y=0;y<N;y++) for (let x=0;x<N;x++){ const d = init((x+0.5)/N-0.5, (y+0.5)/N-0.5, (z+0.5)/N-0.5); const i=idx(x,y,z); field[i]=d; bytes[i]=toByte(d); }
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);

    const api = { N, RANGE, VOX, dist: 1.9, theta: 0.6, phi: 1.1, slice: null, colors: {bg:"#0a0d12", col:"#b0bac6", cut:"#d3a03a", paint:"#a78bec"}, edits:0, voxelsTouched:0 };
    function rot(){ const ct=Math.cos(api.theta), st=Math.sin(api.theta), cp=Math.cos(api.phi), sp=Math.sin(api.phi);
      // camera orbit: R = Ry(theta) * Rx(phi - pi/2); columns are camera axes in world space
      const ry = [ct,0,-st, 0,1,0, st,0,ct]; const a = api.phi - Math.PI/2; const rx = [1,0,0, 0,Math.cos(a),Math.sin(a), 0,-Math.sin(a),Math.cos(a)];
      const m = new Float32Array(9); for (let i=0;i<3;i++) for (let j=0;j<3;j++){ let s=0; for (let k=0;k<3;k++) s += ry[i*3+k]*rx[k*3+j]; m[j*3+i]=s; } return m; }   // column-major for GL
    api.rotMatrix = rot;
    api.orbit = (dth, dph) => { api.theta += dth; api.phi = Math.max(0.05, Math.min(Math.PI-0.05, api.phi + dph)); };
    api.brush = (c, r, op) => {
      const lo = c.map(v => Math.max(0, Math.floor((v - r - RANGE + 0.5)*N))), hi = c.map(v => Math.min(N-1, Math.ceil((v + r + RANGE + 0.5)*N)));
      if (lo.some((v,i)=>v>hi[i])) return;
      const w=hi[0]-lo[0]+1, h=hi[1]-lo[1]+1, dpt=hi[2]-lo[2]+1, sub = new Uint8Array(w*h*dpt); let k=0, touched=0;
      for (let z=lo[2]; z<=hi[2]; z++) for (let y=lo[1]; y<=hi[1]; y++) for (let x=lo[0]; x<=hi[0]; x++){
        const px=(x+0.5)/N-0.5, py=(y+0.5)/N-0.5, pz=(z+0.5)/N-0.5; const sd = Math.hypot(px-c[0], py-c[1], pz-c[2]) - r; const i=idx(x,y,z);
        const nd = op==="carve" ? Math.max(field[i], -sd) : Math.min(field[i], sd); if (nd!==field[i]) touched++; field[i]=nd; sub[k++]=toByte(nd); }
      gl.bindTexture(gl.TEXTURE_3D, tex); gl.texSubImage3D(gl.TEXTURE_3D, 0, lo[0], lo[1], lo[2], w, h, dpt, gl.RED, gl.UNSIGNED_BYTE, sub);
      api.edits++; api.voxelsTouched += touched;
    };
    api.sample = p => { const x=Math.round((p[0]+0.5)*N-0.5), y=Math.round((p[1]+0.5)*N-0.5), z=Math.round((p[2]+0.5)*N-0.5); if (x<0||y<0||z<0||x>=N||y>=N||z>=N) return RANGE; return field[idx(x,y,z)]; };
    api.ray = (nx, ny) => { const m=rot(); const aspect = canvas.width/canvas.height; const dx=nx*aspect*0.55, dy=ny*0.55, dz=-1; const l=Math.hypot(dx,dy,dz);
      const dir=[ (m[0]*dx+m[3]*dy+m[6]*dz)/l, (m[1]*dx+m[4]*dy+m[7]*dz)/l, (m[2]*dx+m[5]*dy+m[8]*dz)/l ]; const ro=[m[6]*api.dist, m[7]*api.dist, m[8]*api.dist]; return {ro, dir}; };
    api.pick = (nx, ny, maxT=6) => { const {ro,dir}=api.ray(nx,ny); let t=0; for (let i=0;i<300;i++){ const p=[ro[0]+dir[0]*t, ro[1]+dir[1]*t, ro[2]+dir[2]*t]; if (Math.max(Math.abs(p[0]),Math.abs(p[1]),Math.abs(p[2]))<0.5){ let d=api.sample(p); if (api.slice!==null) d=Math.max(d, p[0]-api.slice); if (d < VOX*0.5) return p; t += Math.max(d*0.8, VOX*0.3); } else t += VOX*2; if (t>maxT) break; } return null; };
    api.pointAtDepth = (nx, ny, depth) => { const {ro,dir}=api.ray(nx,ny); const t = api.dist - depth; return [ro[0]+dir[0]*t, ro[1]+dir[1]*t, ro[2]+dir[2]*t]; };
    api.render = (brushPos=[9,9,9], brushR=0) => {
      const W=canvas.clientWidth|0, H=canvas.clientHeight|0; const s=Math.min(1.5, devicePixelRatio||1); if (canvas.width!==Math.floor(W*s)){ canvas.width=Math.floor(W*s); canvas.height=Math.floor(H*s); }
      gl.viewport(0,0,canvas.width,canvas.height); gl.useProgram(prog);
      gl.uniform1i(U.uF, 0); gl.uniformMatrix3fv(U.uRot, false, rot()); gl.uniform1f(U.uDist, api.dist); gl.uniform1f(U.uAspect, canvas.width/canvas.height);
      gl.uniform1f(U.uRange, RANGE); gl.uniform1f(U.uVox, VOX); gl.uniform1i(U.uSliceOn, api.slice===null?0:1); gl.uniform1f(U.uSlice, api.slice===null?0:api.slice);
      gl.uniform3fv(U.uBrush, brushPos); gl.uniform1f(U.uBrushR, brushR);
      gl.uniform3fv(U.uBg, hex(api.colors.bg)); gl.uniform3fv(U.uCol, hex(api.colors.col)); gl.uniform3fv(U.uCut, hex(api.colors.cut)); gl.uniform3fv(U.uPaint, hex(api.colors.paint));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    return api;
  };
  // handy primitives for init()
  window.sdfBox = (p, c, b) => { const q=[Math.abs(p[0]-c[0])-b[0], Math.abs(p[1]-c[1])-b[1], Math.abs(p[2]-c[2])-b[2]]; const m=q.map(v=>Math.max(v,0)); return Math.hypot(m[0],m[1],m[2]) + Math.min(Math.max(q[0],Math.max(q[1],q[2])),0); };
  window.sdfCylY = (p, c, r, h) => { const d=[Math.hypot(p[0]-c[0],p[2]-c[2])-r, Math.abs(p[1]-c[1])-h]; const m=d.map(v=>Math.max(v,0)); return Math.min(Math.max(d[0],d[1]),0)+Math.hypot(m[0],m[1]); };
  window.sdfCylX = (p, c, r, h) => { const d=[Math.hypot(p[1]-c[1],p[2]-c[2])-r, Math.abs(p[0]-c[0])-h]; const m=d.map(v=>Math.max(v,0)); return Math.min(Math.max(d[0],d[1]),0)+Math.hypot(m[0],m[1]); };
})();
