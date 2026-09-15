/* sdf-app.js — the interaction layer shared by air-CAD and air-painting.
 * Binds the gesture grammar to the SDF engine:
 *   TRACE      carve (CAD) / paint (painting) along the finger path   — mouse: left-drag
 *   PINCH+move grab & rotate the model                                 — mouse: right-drag (FIST) rotates; middle/shift-drag also
 *   SPREAD     scale (camera distance)                                 — mouse: wheel with shift
 *   PALM_PUSH  push the section plane through                          — mouse: wheel
 *   FIST       boolean subtract, pending 250 ms with a cancel window   — mouse: hold right button still
 *   POINT_DWELL select a face (reported, no action)
 */
window.runSDFApp = function(cfg){
  const canvas = document.getElementById("c"), hands = createHands({mirror:true, bounds:canvas});
  const view = createSDF(canvas, {N: cfg.N || 96, init: cfg.init});
  Object.assign(view.colors, cfg.colors || {});
  const op = cfg.op;                              // "carve" or "add"
  let brushR = cfg.brushR || 0.035, depth = 0.0, last = null, pending = null, strokes = 0, faceSel = null;
  const hud = document.getElementById("hudstat"), lat = document.getElementById("latstat");
  document.getElementById("cambtn").addEventListener("click", async () => { const ok = await hands.startCamera(); document.getElementById("cambtn").setAttribute("aria-pressed", String(ok)); if (ok){ const c=document.getElementById("cam"); c.hidden=false; c.appendChild(hands.video); hands.video.style.cssText="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);opacity:.85"; } });
  document.getElementById("slicebtn").addEventListener("click", e => { view.slice = view.slice===null ? 0.05 : null; e.target.setAttribute("aria-pressed", String(view.slice!==null)); });
  const rr = document.getElementById("brushr"); rr.value = brushR; rr.addEventListener("input", () => brushR = +rr.value);
  canvas.addEventListener("wheel", e => { e.preventDefault(); if (e.shiftKey) view.dist = Math.max(0.9, Math.min(4, view.dist*Math.exp(e.deltaY*0.001))); else if (view.slice!==null) view.slice = Math.max(-0.5, Math.min(0.5, view.slice - e.deltaY*0.0006)); else depth = Math.max(-0.5, Math.min(0.5, depth - e.deltaY*0.0006)); }, {passive:false});
  let prevTip = null, prevSpread = 1;
  function frame(now){
    const st = hands.state, R = st.right, L = st.left, cam = st.source==="camera";
    const cur = document.getElementById("cur"); cur.style.left=(R.indexTip[0]*canvas.clientWidth)+"px"; cur.style.top=(R.indexTip[1]*canvas.clientHeight)+"px"; cur.classList.toggle("pinch", R.pinch>0.7 || (cam && R.trace)); cur.hidden=!R.present;
    const cL = document.getElementById("curL"); cL.hidden=!L.present; if (L.present){ cL.style.left=(L.indexTip[0]*canvas.clientWidth)+"px"; cL.style.top=(L.indexTip[1]*canvas.clientHeight)+"px"; cL.classList.toggle("pinch", L.pinch>0.7); }
    const nx = R.indexTip[0]*2-1, ny = -(R.indexTip[1]*2-1);
    // depth of the finger: camera z is relative depth (negative = toward camera); scale into the box
    if (cam && R.present) depth = Math.max(-0.5, Math.min(0.5, -R.indexTip[2]*4));
    const brushPos = view.pointAtDepth(nx, ny, depth);
    // --- rotate: pinch-and-move (camera) / right-drag (mouse) ---
    const rotating = cam ? (R.present && R.pinch>0.7 && !L.present) : R.fist;
    if (rotating && prevTip){ view.orbit((R.indexTip[0]-prevTip[0])*4.5, -(R.indexTip[1]-prevTip[1])*4.5); }
    prevTip = R.present ? [R.indexTip[0], R.indexTip[1]] : null;
    // --- scale: spread ---
    if (st.spreading){ view.dist = Math.max(0.9, Math.min(4, view.dist * (prevSpread/st.spread))); } prevSpread = st.spread;
    // --- section plane: palm push ---
    if (cam && R.present && R.palmPush > 1.0 && !R.trace && R.pinch < 0.3){ if (view.slice===null) view.slice = 0.45; view.slice = Math.max(-0.5, view.slice - 0.01*R.palmPush); document.getElementById("slicebtn").setAttribute("aria-pressed","true"); }
    // --- stroke: TRACE (camera) / left-drag (mouse) ---
    const tracing = cam ? (R.present && R.trace && R.pinch < 0.3) : (R.pinch > 0.7 && !R.fist);
    if (tracing){ const p = brushPos; if (last){ const d = Math.hypot(p[0]-last[0], p[1]-last[1], p[2]-last[2]); const n = Math.max(1, Math.ceil(d/(brushR*0.35))); for (let i=1;i<=n;i++){ const q = last.map((v,k) => v + (p[k]-v)*i/n); view.brush(q, brushR, op); } } else view.brush(p, brushR, op); last = p; strokes += last ? 0 : 1; } else { if (last) strokes++; last = null; }
    // --- boolean subtract: FIST held still, pending 250 ms, cancelled if the hand opens or moves ---
    const fist = cam ? (R.present && R.fist) : (R.fist && R.pinch < 0.5 && !rotating);
    if (cfg.op === "carve"){
      if (fist && R.tipSpeed < 0.25){ if (!pending) pending = {t0: now, p: brushPos}; else if (now - pending.t0 > 250 && !pending.done){ view.brush(pending.p, brushR*2.6, "carve"); pending.done = true; } }
      else pending = null;
    }
    // --- dwell: report the face normal under the finger ---
    if (R.pointDwell){ const hit = view.pick(nx, ny); faceSel = hit ? hit.map(v=>v.toFixed(2)).join(", ") : null; }
    view.render(brushPos, brushR);
    lat.innerHTML = cam ? `input <b>webcam · ${(st.latencyMs||0).toFixed(0)} ms</b>` : `input <b>mouse</b>`; lat.className = "stat " + (cam ? ((st.latencyMs||0) < 50 ? "ok" : "crit") : "");
    hud.innerHTML = `<span class="k">field</span> ${view.N}³ voxels · ${view.edits} edits · ${(view.voxelsTouched/1000).toFixed(1)}k voxels touched<br><span class="k">brush</span> r ${brushR.toFixed(3)} · depth ${depth.toFixed(2)} · ${view.slice===null?"no section":"section x ≤ "+view.slice.toFixed(2)}${pending&&!pending.done?` · <b style="color:var(--warn)">subtract pending…</b>`:""}${faceSel?`<br><span class="k">dwell</span> face at ${faceSel}`:""}`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return view;
};
