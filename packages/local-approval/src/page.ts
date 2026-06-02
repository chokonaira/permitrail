// Self-contained dark approval page. Polls /api/pending, renders each pending
// action, and posts approve/deny. Matches the sandbox console aesthetic.
export const APPROVAL_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PermitRail local approval</title>
<style>
  :root{--bg:#0d1117;--bg2:#010409;--line:#21262d;--line2:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#3fb950;--red:#f85149;--mono:ui-monospace,"SF Mono",Menlo,monospace}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13.5px/1.6 var(--mono);padding:24px}
  h1{font-size:15px;margin:0 0 4px}.sub{color:var(--muted);font-size:12px;margin:0 0 18px}
  .banner{border:1px solid var(--line2);border-radius:8px;background:#161b22;color:var(--muted);font-size:11.5px;padding:10px 12px;margin-bottom:18px}
  .card{border:1px solid var(--line);border-radius:10px;background:var(--bg2);padding:16px;margin-bottom:12px}
  .tool{color:var(--green);font-weight:700}.row{color:var(--muted);font-size:12px;margin-top:6px}
  pre{background:#0b0e14;border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:10px 0}
  .btns{display:flex;gap:8px;margin-top:10px}button{font:600 12.5px var(--mono);border-radius:7px;padding:9px 16px;cursor:pointer;border:1px solid var(--line2);background:#161b22;color:var(--text)}
  .approve{background:var(--green);color:#04130a;border-color:var(--green)}.deny{border-color:var(--red);color:var(--red)}
  .empty{color:var(--muted)}
</style></head><body>
<h1>PermitRail local approval</h1>
<p class="sub">Pending agent tool calls routed through PermitRail.</p>
<div class="banner">Local approval. Single user, in memory, localhost only. For demos and internal tools, not production auth.</div>
<div id="list"><p class="empty">Waiting for pending actions...</p></div>
<script>
const list=document.getElementById('list');
const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function refresh(){
  const r=await fetch('/api/pending');const items=await r.json();
  if(!items.length){list.innerHTML='<p class="empty">No pending actions.</p>';return}
  list.innerHTML=items.map((c)=>'<div class="card"><div><span class="tool">'+esc(c.tool)+'</span></div>'+
    '<div class="row">audience: '+esc(c.audience)+' &middot; subject: '+esc(c.subject)+(c.risk?(' &middot; risk: '+esc(c.risk)):'')+'</div>'+
    '<div class="row">'+esc(c.purpose)+'</div>'+
    '<pre>'+esc(JSON.stringify(c.input??{},null,2))+'</pre>'+
    '<div class="btns"><button class="approve" data-a="'+c.id+'">Approve</button>'+
    '<button class="deny" data-d="'+c.id+'">Deny</button></div></div>').join('');
}
document.addEventListener('click',async(e)=>{
  const a=e.target.getAttribute&&e.target.getAttribute('data-a');
  const d=e.target.getAttribute&&e.target.getAttribute('data-d');
  if(a){await fetch('/api/approve/'+a,{method:'POST',headers:{'content-type':'application/json'},body:'{"approvedBy":"local-user"}'});refresh()}
  if(d){await fetch('/api/deny/'+d,{method:'POST',headers:{'content-type':'application/json'},body:'{"reason":"Denied from local approval page"}'});refresh()}
});
refresh();setInterval(refresh,1000);
</script></body></html>`;
