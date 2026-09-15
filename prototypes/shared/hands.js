/* hands.js — the six-primitive gesture grammar, from a webcam or from the mouse.
 *
 * One source of truth for all five prototypes (see docs/gesture-grammar.md). Each frame
 * `state` carries, per hand: 21 landmarks in normalised camera space (x,y in 0..1, mirrored
 * so it feels like a mirror; z is relative depth), plus the primitives derived from them.
 * Without a camera the mouse stands in, using the mapping in the grammar doc.
 *
 *   const hands = createHands({ onReady, mirror:true });
 *   await hands.startCamera();      // optional; falls back to the mouse if it fails
 *   ...per frame: hands.state.right.pinch, hands.state.spread, hands.state.left.indexTip
 *
 * Primitives:
 *   pinch        0..1  thumb tip ↔ index tip, 1.0 under ~25 mm (scaled by hand size)
 *   fist         bool  mean finger curl
 *   palmNormal   [x,y,z] unit, palmVel [x,y,z] per second, palmPush = max(0, dot(n, v))
 *   indexTip     [x,y,z]; indexExtended bool; trace = indexTip stream while others curled
 *   pointDwell   bool  index extended and tip speed < threshold for > 400 ms
 *   spread       0..∞  inter-hand distance (both hands pinching) relative to first pinch
 * Latency: `state.latencyMs` is camera-frame → callback, measured, so each sim can show it.
 */
(function(){
  const MP_VERSION = "0.4.1675469240";
  function dist(a,b){ return Math.hypot(a[0]-b[0], a[1]-b[1], (a[2]||0)-(b[2]||0)); }
  function sub(a,b){ return [a[0]-b[0], a[1]-b[1], (a[2]||0)-(b[2]||0)]; }
  function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function norm(a){ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; }
  function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

  function emptyHand(){ return {present:false, landmarks:null, pinch:0, fist:false, palmNormal:[0,0,-1], palmVel:[0,0,0], palmPush:0,
    indexTip:[0.5,0.5,0], indexExtended:false, trace:false, pointDwell:false, curl:[0,0,0,0,0], size:0.1, _prevPalm:null, _prevT:0, _dwellSince:0}; }

  function deriveHand(h, lm, t){
    h.present = true; h.landmarks = lm;
    const wrist=lm[0], idxMcp=lm[5], pinkyMcp=lm[17], midMcp=lm[9];
    h.size = dist(wrist, midMcp);                                  // hand scale, for mm-ish thresholds
    // pinch: thumb tip (4) ↔ index tip (8); 25 mm ≈ 0.25 hand lengths
    const p = dist(lm[4], lm[8]) / h.size;
    h.pinch = Math.max(0, Math.min(1, (0.45 - p) / 0.25));
    // curl per finger: tip closer to wrist than pip → curled
    const fingers = [[4,3,2],[8,6,5],[12,10,9],[16,14,13],[20,18,17]];
    h.curl = fingers.map(([tip,pip,mcp]) => { const a=dist(lm[tip],wrist), b=dist(lm[pip],wrist); return Math.max(0,Math.min(1,(b-a)/(0.35*h.size)+0.5)); });
    h.fist = h.curl.slice(1).reduce((a,b)=>a+b,0)/4 > 0.6 && h.curl[0] > 0.3;
    h.indexExtended = h.curl[1] < 0.35;
    h.trace = h.indexExtended && h.curl[2] > 0.5 && h.curl[3] > 0.5 && h.curl[4] > 0.5;
    // palm normal from wrist→index-mcp × wrist→pinky-mcp
    const n = norm(cross(sub(idxMcp,wrist), sub(pinkyMcp,wrist)));
    const palm = [(wrist[0]+idxMcp[0]+pinkyMcp[0])/3, (wrist[1]+idxMcp[1]+pinkyMcp[1])/3, (wrist[2]+idxMcp[2]+pinkyMcp[2])/3];
    if (h._prevPalm && t > h._prevT){ const dt=(t-h._prevT)/1000; h.palmVel = sub(palm,h._prevPalm).map(v=>v/dt); }
    h._prevPalm = palm; h._prevT = t; h.palmNormal = n;
    h.palmPush = Math.max(0, dot(n, h.palmVel));
    // index tip + dwell
    const tip = lm[8];
    const speed = h.landmarks && h._prevTip ? dist(tip, h._prevTip) / Math.max(1e-3,(t-h._prevTipT)/1000) : 0;
    h._prevTip = tip; h._prevTipT = t;
    h.indexTip = tip; h.tipSpeed = speed;
    if (h.indexExtended && speed < 0.15){ if (!h._dwellSince) h._dwellSince = t; h.pointDwell = (t - h._dwellSince) > 400; }
    else { h._dwellSince = 0; h.pointDwell = false; }
  }

  window.createHands = function(opts={}){
    const state = {left:emptyHand(), right:emptyHand(), spread:1, spreading:false, source:"mouse", latencyMs:null, cameraError:null, t:0};
    let spreadBase = null;
    const listeners = [];
    function tick(t){
      state.t = t;
      const L=state.left, R=state.right;
      if (L.present && R.present && L.pinch>0.7 && R.pinch>0.7){ const d=dist(L.indexTip,R.indexTip); if (spreadBase===null) spreadBase=d||1; state.spread = d/spreadBase; state.spreading=true; }
      else { spreadBase=null; state.spread=1; state.spreading=false; }
      for (const f of listeners) f(state);
    }

    // ---- mouse / touch stand-in --------------------------------------------------------
    // Grammar doc mapping: left button = pinch, wheel = palm push, two-finger pinch = spread,
    // right button = fist. The pointer is the right hand's index tip.
    const mouse = {x:0.5,y:0.5,down:false,right:false,wheel:0,prevX:0.5,prevY:0.5,prevT:0};
    function mouseFrame(t){
      const h = state.right; h.present = true; h.landmarks = null;
      const dt = Math.max(1e-3,(t-mouse.prevT)/1000);
      h.tipSpeed = Math.hypot(mouse.x-mouse.prevX, mouse.y-mouse.prevY)/dt;
      h.palmVel = [(mouse.x-mouse.prevX)/dt, (mouse.y-mouse.prevY)/dt, 0];
      mouse.prevX=mouse.x; mouse.prevY=mouse.y; mouse.prevT=t;
      h.indexTip = [mouse.x, mouse.y, 0]; h.indexExtended = true; h.trace = !mouse.down && !mouse.right;
      h.pinch = mouse.down ? 1 : 0; h.fist = mouse.right; h.size = 0.12;
      h.palmPush = Math.max(0, mouse.wheel); mouse.wheel *= 0.6;
      if (h.tipSpeed < 0.15){ if (!h._dwellSince) h._dwellSince=t; h.pointDwell = (t-h._dwellSince)>400; } else { h._dwellSince=0; h.pointDwell=false; }
      state.left.present = false;
    }
    const target = opts.target || window;
    target.addEventListener("pointermove", e => { const r = (opts.bounds||document.documentElement).getBoundingClientRect(); mouse.x = (e.clientX-r.left)/r.width; mouse.y = (e.clientY-r.top)/r.height; });
    target.addEventListener("pointerdown", e => { if (e.button===2) mouse.right=true; else mouse.down=true; });
    target.addEventListener("pointerup", e => { if (e.button===2) mouse.right=false; else mouse.down=false; });
    target.addEventListener("pointercancel", () => { mouse.down=false; mouse.right=false; });
    target.addEventListener("wheel", e => { mouse.wheel = Math.min(3, mouse.wheel + Math.abs(e.deltaY)/60); }, {passive:true});
    target.addEventListener("contextmenu", e => e.preventDefault());

    let camOn = false, video = null, mp = null, rafId = 0;
    function loop(t){ if (!camOn) mouseFrame(t); tick(t); rafId = requestAnimationFrame(loop); }
    rafId = requestAnimationFrame(loop);

    // ---- webcam via MediaPipe Hands -----------------------------------------------------
    function loadScript(src){ return new Promise((res,rej) => { const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=()=>rej(new Error("failed "+src)); document.head.appendChild(s); }); }
    async function startCamera(){
      try {
        if (!window.Hands) await loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_VERSION}/hands.js`);
        video = document.createElement("video"); video.playsInline = true; video.muted = true;
        const stream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:"user"}, audio:false});
        video.srcObject = stream; await video.play();
        mp = new window.Hands({locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${MP_VERSION}/${f}`});
        mp.setOptions({maxNumHands:2, modelComplexity:0, minDetectionConfidence:0.6, minTrackingConfidence:0.5, selfieMode:false});
        let sentAt = 0;
        mp.onResults(res => {
          const t = performance.now(); state.latencyMs = t - sentAt;
          state.left.present = false; state.right.present = false;
          (res.multiHandLandmarks||[]).forEach((lm,i) => {
            const label = res.multiHandedness[i].label;                 // "Left"/"Right" as seen by the camera
            const mirror = opts.mirror !== false;
            const pts = lm.map(p => [mirror ? 1-p.x : p.x, p.y, p.z]);
            // with the image mirrored, the camera's "Left" is the user's right hand
            const h = ((label === "Left") === mirror) ? state.right : state.left;
            deriveHand(h, pts, t);
          });
          state.source = "camera";
        });
        camOn = true;
        (async function pump(){ while (camOn){ sentAt = performance.now(); await mp.send({image:video}); } })();
        state.cameraError = null; return true;
      } catch (e){ state.cameraError = e.message || String(e); camOn = false; state.source = "mouse"; return false; }
    }
    function stopCamera(){ camOn = false; if (video && video.srcObject) video.srcObject.getTracks().forEach(t=>t.stop()); state.source="mouse"; state.latencyMs=null; }
    return {state, startCamera, stopCamera, onFrame: f => listeners.push(f), get video(){ return video; }, get cameraOn(){ return camOn; }};
  };
})();
