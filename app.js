/* app.js — defensive + debug friendly version
   Fixes for:
   - chart not showing (waits for Chart.js, safe guards)
   - wallet connect failures (clear errors & messages)
   - theme controls null-safety
*/

/* ---------- HELPERS & ELEMENTS ---------- */
const connectBtn = document.getElementById("connectBtn");
const balanceBtn = document.getElementById("balanceBtn");
const signBtn = document.getElementById("signBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

const addrEl = document.getElementById("address");
const balEl = document.getElementById("balance");
const signedEl = document.getElementById("signed");
const statusPill = document.getElementById("statusPill");

const nonceEl = document.getElementById("nonce");
const txTodayEl = document.getElementById("txToday");
const refreshNonceBtn = document.getElementById("refreshNonceBtn");

const themeSelect = document.getElementById("themeSelect");
const themeToggle = document.getElementById("themeToggle");

let currentAddress = null;
function available(){ return typeof window.ethereum !== "undefined"; }

/* ---------- THEME (safe) ---------- */
function applyTheme(theme){
  try{
    document.body.classList.remove("theme-neon","theme-cyber","theme-light");
    if(theme === "cyber") document.body.classList.add("theme-cyber");
    else if(theme === "light") document.body.classList.add("theme-light");
    else document.body.classList.add("theme-neon");
    localStorage.setItem('w3_theme', theme);
    applyThemeToChart(theme);
  }catch(e){ console.warn("applyTheme error:", e); }
}
function initTheme(){
  const stored = localStorage.getItem('w3_theme') || 'neon';
  if(themeSelect) themeSelect.value = stored;
  applyTheme(stored);
}
if(themeToggle){
  themeToggle.addEventListener('click', ()=>{
    const t = (themeSelect && themeSelect.value) ? themeSelect.value : (localStorage.getItem('w3_theme') || 'neon');
    const next = t === 'neon' ? 'cyber' : (t === 'cyber' ? 'light' : 'neon');
    if(themeSelect) themeSelect.value = next;
    applyTheme(next);
  });
}
if(themeSelect){
  themeSelect.addEventListener('change', ()=> applyTheme(themeSelect.value));
}
initTheme();

/* ---------- STORAGE HELPERS (nonce/day counter) ---------- */
function keyForAddr(addr){ return `w3_nonce_state_${addr}`; }
function readState(addr){ if(!addr) return null; try{ const raw=localStorage.getItem(keyForAddr(addr)); return raw?JSON.parse(raw):{lastSeenNonce:null,dailyCounts:{}}; }catch{ return {lastSeenNonce:null,dailyCounts:{}}; } }
function writeState(addr,state){ if(!addr) return; localStorage.setItem(keyForAddr(addr), JSON.stringify(state)); }
function todayKey(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

/* ---------- UI update helper ---------- */
function setConnectedUI(addr){
  if(addr){
    if(addrEl) addrEl.textContent = addr;
    if(statusPill){ statusPill.textContent='● Connected'; statusPill.classList.remove('not'); statusPill.classList.add('yes'); }
    fetchAndUpdateNonce(addr).catch(console.error);
  } else {
    if(addrEl) addrEl.textContent = '—';
    if(statusPill){ statusPill.textContent='● Not Connected'; statusPill.classList.remove('yes'); statusPill.classList.add('not'); }
    if(nonceEl) nonceEl.textContent = '—';
    if(txTodayEl) txTodayEl.textContent = '—';
  }
}

/* ---------- WALLET FUNCTIONS (more defensive) ---------- */
async function connectWallet(){
  if(!available()){
    alert("MetaMask / Ethereum provider not detected. Install MetaMask and serve this page over http:// or https:// (Live Server).");
    console.warn("connectWallet: window.ethereum undefined");
    return;
  }
  try{
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    if(!accounts || accounts.length === 0){
      alert("No accounts returned by provider.");
      return;
    }
    currentAddress = accounts[0];
    setConnectedUI(currentAddress);
    try{ localStorage.setItem('connectedAddress', currentAddress); }catch(e){}
    console.log("Connected:", currentAddress);
  }catch(err){
    console.error("connectWallet error:", err);
    if(err && err.code === 4001) alert("Connection request rejected in wallet.");
    else alert("Connection failed. Check console for details.");
  }
}

async function showBalance(){
  if(!currentAddress){ alert("Connect your wallet first."); return; }
  try{
    const hex = await window.ethereum.request({ method:'eth_getBalance', params:[currentAddress,'latest'] });
    const wei = BigInt(hex);
    const eth = Number(wei) / 1e18;
    if(balEl) balEl.textContent = eth.toFixed(6) + " ETH";
  }catch(err){ console.error("showBalance error:", err); if(balEl) balEl.textContent = 'Error'; alert("Could not fetch balance. Check console."); }
}

async function signMessage(){
  if(!currentAddress){ alert("Connect your wallet first."); return; }
  const msg = 'Demo sign — ' + new Date().toLocaleString();
  try{
    const sig = await window.ethereum.request({ method:'personal_sign', params:[msg, currentAddress] });
    if(signedEl) signedEl.textContent = msg + '\n\n' + sig;
  }catch(err){ console.error("signMessage error:", err); if(signedEl) signedEl.textContent='Signing error'; alert("Signing failed. Check console."); }
}

function disconnectWallet(){
  currentAddress = null;
  setConnectedUI(null);
  try{ localStorage.removeItem('connectedAddress'); }catch(e){}
  console.log("Disconnected UI cleared");
}

/* attach listeners */
if(connectBtn) connectBtn.addEventListener('click', connectWallet);
if(balanceBtn) balanceBtn.addEventListener('click', showBalance);
if(signBtn) signBtn.addEventListener('click', signMessage);
if(disconnectBtn) disconnectBtn.addEventListener('click', disconnectWallet);

/* handle accountsChanged */
if(available()){
  try{
    window.ethereum.on('accountsChanged', (accounts)=>{
      console.log('accountsChanged', accounts);
      if(!accounts || accounts.length === 0) disconnectWallet();
      else { currentAddress = accounts[0]; setConnectedUI(currentAddress); }
    });
  }catch(e){ console.warn("accountsChanged attach error", e); }
}

/* ---------- NONCE + DAILY COUNT ---------- */
async function fetchNonceOnChain(addr){
  if(!available()) throw new Error('No provider');
  const hex = await window.ethereum.request({ method:'eth_getTransactionCount', params:[addr,'latest']});
  return Number(BigInt(hex));
}
async function fetchAndUpdateNonce(addr){
  if(!addr) return;
  try{
    const currentNonce = await fetchNonceOnChain(addr);
    const state = readState(addr) || {lastSeenNonce:null,dailyCounts:{}};
    const last = (typeof state.lastSeenNonce === 'number')? state.lastSeenNonce : null;
    let delta = 0;
    if(last === null) delta = 0;
    else if(currentNonce > last) delta = currentNonce - last;
    const today = todayKey();
    if(!state.dailyCounts) state.dailyCounts = {};
    if(!state.dailyCounts[today]) state.dailyCounts[today] = 0;
    if(delta>0) state.dailyCounts[today] += delta;
    state.lastSeenNonce = currentNonce;
    writeState(addr, state);
    if(nonceEl) nonceEl.textContent = String(currentNonce);
    if(txTodayEl) txTodayEl.textContent = String(state.dailyCounts[today] || 0);
    return {currentNonce, delta};
  }catch(err){ console.error("fetchAndUpdateNonce error:", err); if(nonceEl) nonceEl.textContent='Error'; if(txTodayEl) txTodayEl.textContent='Error'; return null; }
}
if(refreshNonceBtn) refreshNonceBtn.addEventListener('click', async ()=>{ if(!currentAddress) return alert('Connect first.'); await fetchAndUpdateNonce(currentAddress); alert('Nonce refreshed'); });

let nonceInterval = null;
function startNonceAutoRefresh(){ if(nonceInterval) clearInterval(nonceInterval); nonceInterval = setInterval(()=>{ if(currentAddress) fetchAndUpdateNonce(currentAddress).catch(()=>{}); }, 30000); }
function stopNonceAutoRefresh(){ if(nonceInterval) { clearInterval(nonceInterval); nonceInterval = null; } }
const originalSetConnected = setConnectedUI;
setConnectedUI = function(addr){ originalSetConnected(addr); if(addr){ fetchAndUpdateNonce(addr).catch(()=>{}); startNonceAutoRefresh(); } else stopNonceAutoRefresh(); };

/* restore connected address on load */
(function restoreConnected(){
  try{
    const stored = localStorage.getItem('connectedAddress');
    if(stored){ currentAddress = stored; setConnectedUI(currentAddress); }
  }catch(e){}
})();

/* ---------- PARTICLES ---------- */
(function particles(){
  const c = document.getElementById('particles');
  if(!c) return;
  const ctx = c.getContext('2d');
  function resize(){ c.width = innerWidth; c.height = innerHeight; }
  resize(); addEventListener('resize', resize);
  const dots = [];
  for(let i=0;i<60;i++) dots.push({ x:Math.random()*c.width, y:Math.random()*c.height, r:1+Math.random()*3, dx:(Math.random()-.5)*0.4, dy:(Math.random()-.5)*0.4 });
  (function frame(){
    ctx.clearRect(0,0,c.width,c.height);
    dots.forEach(d=>{
      d.x+=d.dx; d.y+=d.dy;
      if(d.x<0) d.x=c.width; if(d.x>c.width) d.x=0;
      if(d.y<0) d.y=c.height; if(d.y>c.height) d.y=0;
      ctx.beginPath(); ctx.fillStyle='rgba(180,220,255,0.65)'; ctx.arc(d.x,d.y,d.r,0,Math.PI*2); ctx.fill();
    });
    requestAnimationFrame(frame);
  })();
})();

/* ---------- CALCULATOR ---------- */
const calcBtn = document.getElementById('calcBtn');
const chainSelect = document.getElementById('chainSelect');
const calcAmount = document.getElementById('calcAmount');
const gasLimitInput = document.getElementById('gasLimit');
const gasPriceOut = document.getElementById('gasPriceOut');
const gasFeeOut = document.getElementById('gasFeeOut');
const totalCostOut = document.getElementById('totalCostOut');

function parseBigIntSafe(v,f=0n){ try { return BigInt(v); } catch { return f; } }

if(calcBtn) calcBtn.addEventListener('click', async ()=>{
  if(!available()) return alert('MetaMask required to fetch gas price');
  try{
    const hexGas = await window.ethereum.request({ method:'eth_gasPrice' });
    const baseGasWei = parseBigIntSafe(hexGas);
    const chain = (chainSelect && chainSelect.value) ? chainSelect.value : 'eth';
    let gasLimit = Number(gasLimitInput.value || 0); if(!gasLimit || gasLimit<=0) gasLimit = 21000;
    let num=1n, den=1n;
    if(chain==='polygon') { num=1n; den=10n; }
    if(chain==='bnb') { num=3n; den=10n; }
    const gasPriceWei = (baseGasWei * num) / den;
    const gasFeeWei = gasPriceWei * BigInt(gasLimit);
    const gasPriceGwei = Number(gasPriceWei)/1e9;
    const gasFeeNative = Number(gasFeeWei)/1e18;
    const amount = parseFloat((calcAmount && calcAmount.value) ? calcAmount.value : '0');
    const total = amount + gasFeeNative;
    if(gasPriceOut) gasPriceOut.textContent = `Gas Price: ${gasPriceGwei.toFixed(2)} Gwei`;
    if(gasFeeOut) gasFeeOut.textContent = `Gas Fee: ${gasFeeNative.toFixed(6)} (native)`;
    if(totalCostOut) totalCostOut.textContent = `Total Cost: ${total.toFixed(6)} (amount + gas)`;
  }catch(err){ console.error("calc error:", err); alert("Could not fetch gas price. Check console."); }
});

/* ---------- CHART (safe rendering) ---------- */
let chart = null;
function generateRandomPrices(points=30){
  const out=[]; let price = 3200 + Math.random()*700;
  for(let i=0;i<points;i++){
    const change = (Math.random()-0.5) * (price * 0.02);
    price = Math.max(0.1, price + change);
    out.push(Number(price.toFixed(2)));
  }
  return out;
}
function chartColorsForTheme(theme){
  if(theme === 'cyber') return { border:'#ff00b8', bg:'rgba(255,0,184,0.06)' };
  if(theme === 'light') return { border:'#3366ff', bg:'rgba(51,102,255,0.06)' };
  return { border:'#2be2c7', bg:'rgba(43,226,199,0.06)' };
}

async function waitForChartJs(timeout = 3000){
  const start = Date.now();
  while(typeof Chart === 'undefined'){
    if(Date.now() - start > timeout) return false;
    await new Promise(r=>setTimeout(r, 80));
  }
  return true;
}

async function renderMarketChart(){
  const canvas = document.getElementById('marketChart');
  if(!canvas){ console.warn("renderMarketChart: canvas #marketChart not found"); return; }

  const ok = await waitForChartJs(4000);
  if(!ok){ console.error("Chart.js not loaded within timeout (check CDN)"); return; }

  try{
    const ctx = canvas.getContext('2d');
    const values = generateRandomPrices(28);
    if(chart) chart.destroy();

    const theme = (themeSelect && themeSelect.value) ? themeSelect.value : (localStorage.getItem('w3_theme') || 'neon');
    const c = chartColorsForTheme(theme);

    chart = new Chart(ctx, {
      type:'line',
      data:{ labels: values.map(()=>''), datasets:[{ label:'Price', data: values, borderColor: c.border, borderWidth:2.5, pointRadius:0, fill:true, backgroundColor:c.bg, tension:0.35 }] },
      options:{ plugins:{ legend:{ display:false } }, scales:{ x:{ display:false }, y:{ ticks:{ color:(theme==='light' ? '#223' : '#dfeffb') }, grid:{ color:'rgba(255,255,255,0.03)' } } }, maintainAspectRatio:false, animation:{ duration:600 } }
    });
    console.log("Market chart rendered (theme: " + theme + ")");
  }catch(err){
    console.error("renderMarketChart error:", err);
  }
}

function applyThemeToChart(theme){
  try{
    if(!chart) return;
    const c = chartColorsForTheme(theme);
    chart.data.datasets[0].borderColor = c.border;
    chart.data.datasets[0].backgroundColor = c.bg;
    chart.options.scales.y.ticks.color = (theme === 'light' ? '#223' : '#dfeffb');
    chart.update();
  }catch(err){ console.warn("applyThemeToChart error:", err); }
}

const regenBtn = document.getElementById('regenChart');
if(regenBtn) regenBtn.addEventListener('click', renderMarketChart);

/* ensure chart renders after DOM loaded */
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', renderMarketChart);
} else {
  // small delay to allow Chart.js to initialize if it's still parsing
  setTimeout(renderMarketChart, 120);
}

/* END of file */
