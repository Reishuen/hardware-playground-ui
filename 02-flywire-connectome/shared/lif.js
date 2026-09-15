/* lif.js — the harness's LIF simulator + synthetic connectome + demo specs, ported to JS.
   Shared by the control room (index.html) and the cinema page. */
/* =====================================================================================
   Live LIF simulation — a port of harness/sim.py + harness/synthetic.py + the demos'
   population specs. Same constants, same structure, JS RNG.
   ===================================================================================== */
const P = {tau_mem:0.020, tau_syn:0.005, v_reset:0, v_th:0.010, refractory:0.0022, dt:0.0001, w_syn:2.75e-4};
const N = 4000, PER_TYPE = 24, MEAN_OUT = 40, INHIB = 0.35, PATHWAY_W = 0.0015;
const CELL_TYPES = ["LC4","LC11","LC15","LPLC2","P1_a","pC1","pIP10","hg1","hg2","hg3","KCg-m","KCab-c","MBON01","MBON11","PPL101","PAM11","DNa02","DNp09"];
const PATHWAYS = [[["LC11","LC15"],["KCg-m","KCab-c"]],[["KCg-m","KCab-c"],["MBON01","MBON11"]],[["LC4"],["DNa02"]],[["LPLC2"],["DNp09"]],[["P1_a","pC1"],["pIP10"]],[["pIP10"],["hg1","hg2","hg3"]]];

// Demo population specs, verbatim from harness/demos/*.py (name, cell types, role, drive).
const SPECS = {
  doomscroll:{frame:1/30, pops:[["visual",["LC11","LC15"],"sensory",2.4],["kenyon",["KCg-m","KCab-c"],"sensory",0],["mbon",["MBON01","MBON11"],"motor",0],["dan",["PPL101","PAM11"],"reward",2.0]],
    stim:[["visual","salience"],["dan","reward"]],
    decode:r=>({engaged:r.mbon>8, scroll:r.mbon>8, engagement:+r.mbon.toFixed(1)})},
  stonks:{frame:0.1, pops:[["visual",["LC11","LC15","LC4"],"sensory",2.4],["mbon",["MBON01","MBON11"],"motor",0],["dan_reward",["PAM11"],"reward",2.0],["dan_punish",["PPL101"],"reward",2.0]],
    stim:[["visual","chart contrast"],["dan_reward","P&L reward"],["dan_punish","P&L punish"]],
    decode:r=>({side:r.mbon>10?"buy":"hold", confidence:+Math.min(1,r.mbon/20).toFixed(2), paper:true})},
  doom:{frame:1/35, pops:[["visual_left",["LC4"],"sensory",2.6],["visual_right",["LPLC2"],"sensory",2.6],["dn_turn",["DNa02"],"motor",0],["dn_forward",["DNp09"],"motor",0],["p1_command",["P1_a"],"modulatory",2.4],["dan",["PPL101"],"reward",2.0]],
    stim:[["visual_left","enemy left"],["visual_right","enemy right"],["p1_command","arousal"],["dan","reward"]],
    decode:r=>({turn:+((r.dn_turn-r.dn_forward)/60).toFixed(2), forward:r.dn_forward>15, shoot:r.p1_command>30})},
  beatsaber:{frame:1/90, pops:[["visual_loom",["LC4","LPLC2"],"sensory",2.4],["p1_command",["P1_a","pC1"],"modulatory",2.4],["pip10",["pIP10"],"motor",0],["wing_motor",["hg1","hg2","hg3"],"motor",0]],
    stim:[["visual_loom","loom"],["p1_command","arousal"]],
    decode:r=>({swing:r.wing_motor>15, strength:+Math.min(1,r.pip10/60).toFixed(2)})},
};

// ---- synthetic connectome --------------------------------------------------------
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function buildConnectome(seed=0){
  const rnd = mulberry32(seed);
  const gauss = () => { let u=1-rnd(), v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
  const cellType = new Array(N);
  for (let i=0;i<N;i++) cellType[i] = "generic_"+(i%97);
  CELL_TYPES.forEach((ct,k) => { for (let i=k*PER_TYPE;i<(k+1)*PER_TYPE;i++) cellType[i]=ct; });
  const isDemo = cellType.map(c => CELL_TYPES.includes(c));
  const inhib = new Uint8Array(N);
  for (let i=0;i<N;i++) inhib[i] = (!isDemo[i] && rnd() < INHIB) ? 1 : 0;
  // edge lists
  const nnz = N*MEAN_OUT;
  const rows = [], cols = [], vals = [];
  for (let e=0;e<nnz;e++){
    const i = Math.floor(rnd()*N), j = Math.floor(rnd()*N);
    if (i===j) continue;                                   // setdiag(0)
    const syn = Math.max(1, Math.exp(1.2 + 0.9*gauss()));   // log-normal synapse count
    rows.push(i); cols.push(j); vals.push((inhib[i]?-1:1)*syn*P.w_syn);
  }
  const byType = {}; cellType.forEach((c,i) => { (byType[c] ||= []).push(i); });
  for (const [pre,post] of PATHWAYS){
    const a = pre.flatMap(c => byType[c]), b = post.flatMap(c => byType[c]);
    for (const i of a) for (const j of b){ rows.push(i); cols.push(j); vals.push(PATHWAY_W); }
  }
  // CSR
  const rowPtr = new Int32Array(N+1);
  for (const i of rows) rowPtr[i+1]++;
  for (let i=0;i<N;i++) rowPtr[i+1] += rowPtr[i];
  const colIdx = new Int32Array(rows.length), val = new Float32Array(rows.length), fill = rowPtr.slice(0,N);
  for (let e=0;e<rows.length;e++){ const k = fill[rows[e]]++; colIdx[k]=cols[e]; val[k]=vals[e]; }
  return {cellType, byType, rowPtr, colIdx, val, nnz:rows.length};
}

// ---- LIF network ------------------------------------------------------------------
class LIF {
  constructor(c){ this.c=c; this.v=new Float32Array(N).fill(P.v_reset); this.isyn=new Float32Array(N); this.refUntil=new Float32Array(N).fill(-Infinity); this.t=0; this.dead=new Uint8Array(N);
    this.dSyn=Math.exp(-P.dt/P.tau_syn); this.dMem=Math.exp(-P.dt/P.tau_mem); this.spikeCount=new Int32Array(N); }
  reset(){ this.v.fill(P.v_reset); this.isyn.fill(0); this.refUntil.fill(-Infinity); this.t=0; }
  step(ext){                                   // ext: Float32Array in threshold units, or null
    const {v,isyn,refUntil,dead,c}=this, {rowPtr,colIdx,val}=c;
    for (let i=0;i<N;i++) isyn[i]*=this.dSyn;
    const spiked=[];
    for (let i=0;i<N;i++){
      if (this.t < refUntil[i] || dead[i]) continue;
      const drive = isyn[i] + (ext ? ext[i]*P.v_th : 0);
      v[i] = drive + (v[i]-drive)*this.dMem;
      if (v[i] >= P.v_th){ v[i]=P.v_reset; refUntil[i]=this.t+P.refractory; spiked.push(i); }
    }
    for (const i of spiked){ for (let k=rowPtr[i];k<rowPtr[i+1];k++) isyn[colIdx[k]] += val[k]; }
    this.t += P.dt;
    return spiked;
  }
  advance(duration, ext){                      // returns per-neuron spike counts over the window
    const n=Math.max(1,Math.round(duration/P.dt)); this.spikeCount.fill(0);
    for (let s=0;s<n;s++){ const sp=this.step(ext); for (const i of sp) this.spikeCount[i]++; }
    return n*P.dt;
  }
}

