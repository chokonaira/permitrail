// Self-contained dark approval page. Polls /api/pending, renders each pending
// action, posts approve/deny with a spinner and confirmation, and moves the
// viewport to the action on mobile. Matches the sandbox console aesthetic.
export const APPROVAL_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>PermitRail local approval</title>
<style>
  :root{--bg:#0d1117;--bg2:#010409;--line:#21262d;--line2:#30363d;--text:#e6edf3;--muted:#8b949e;--green:#3fb950;--red:#f85149;--mono:ui-monospace,"SF Mono",Menlo,monospace}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:13.5px/1.6 var(--mono);padding:20px;-webkit-text-size-adjust:100%}
  .wrap{max-width:720px;margin:0 auto}
  h1{font-size:15px;margin:0 0 4px}.sub{color:var(--muted);font-size:12px;margin:0 0 16px}
  .banner{border:1px solid var(--line2);border-radius:8px;background:#161b22;color:var(--muted);font-size:11.5px;padding:10px 12px;margin-bottom:16px}
  .card{border:1px solid var(--line);border-radius:10px;background:var(--bg2);padding:16px;margin-bottom:12px;min-width:0}
  .tool{color:var(--green);font-weight:700;overflow-wrap:anywhere}
  .row{color:var(--muted);font-size:12px;margin-top:6px;overflow-wrap:anywhere}
  pre{background:#0b0e14;border:1px solid var(--line);border-radius:8px;padding:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:10px 0}
  .btns{display:flex;gap:8px;margin-top:12px}
  button{font:600 13px var(--mono);border-radius:8px;padding:11px 18px;cursor:pointer;border:1px solid var(--line2);background:#161b22;color:var(--text);display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px}
  button:disabled{opacity:.65;cursor:default}
  .approve{background:var(--green);color:#04130a;border-color:var(--green)}
  .deny{border-color:var(--red);color:var(--red)}
  .result{margin-top:12px;font-size:12.5px;font-weight:700;padding:11px 12px;border-radius:8px}
  .result.ok{color:var(--green);border:1px solid var(--green);background:rgba(63,185,80,.12)}
  .result.no{color:var(--red);border:1px solid var(--red);background:rgba(248,81,73,.12)}
  .spin{width:13px;height:13px;border:2px solid rgba(0,0,0,.25);border-top-color:currentColor;border-radius:50%;display:inline-block;animation:spin .6s linear infinite}
  .deny .spin{border-color:rgba(248,81,73,.3);border-top-color:var(--red)}
  .empty{color:var(--muted)}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:640px){
    body{padding:14px}
    .btns{flex-direction:column}
    button{width:100%;min-height:50px}
  }
</style></head><body>
<div class="wrap">
<h1>PermitRail local approval</h1>
<p class="sub">Pending agent tool calls routed through PermitRail.</p>
<div class="banner">Local approval. Single user, in memory, localhost only. For demos and internal tools, not production auth.</div>
<div id="list"><p class="empty">Waiting for pending actions...</p></div>
</div>
<script>
const list=document.getElementById('list');
const seen=new Set();
let busy=false;
const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const isMobile=()=>matchMedia('(max-width:640px)').matches;
function card(c){
  return '<div class="card" id="c-'+c.id+'">'+
    '<div class="tool">'+esc(c.tool)+'</div>'+
    '<div class="row">audience: '+esc(c.audience)+' &middot; subject: '+esc(c.subject)+(c.risk?(' &middot; risk: '+esc(c.risk)):'')+'</div>'+
    '<div class="row">'+esc(c.purpose)+'</div>'+
    '<pre>'+esc(JSON.stringify((c.input==null?{}:c.input),null,2))+'</pre>'+
    '<div class="btns">'+
      '<button class="approve" data-act="approve" data-id="'+c.id+'">Approve</button>'+
      '<button class="deny" data-act="deny" data-id="'+c.id+'">Deny</button>'+
    '</div></div>';
}
async function refresh(){
  if(busy)return;
  let items=[];
  try{items=await (await fetch('/api/pending')).json();}catch(e){return;}
  if(!items.length){list.innerHTML='<p class="empty">No pending actions.</p>';return;}
  list.innerHTML=items.map(card).join('');
  const fresh=items.find((c)=>!seen.has(c.id));
  items.forEach((c)=>seen.add(c.id));
  if(fresh&&isMobile()){const el=document.getElementById('c-'+fresh.id);if(el)el.scrollIntoView({behavior:'smooth',block:'center'});}
}
async function act(id,action){
  if(busy)return;busy=true;
  const cardEl=document.getElementById('c-'+id);
  const btns=cardEl&&cardEl.querySelector('.btns');
  if(btns){
    for(const b of btns.querySelectorAll('button'))b.disabled=true;
    const target=btns.querySelector('[data-act="'+action+'"]');
    if(target)target.innerHTML='<span class="spin"></span>'+(action==='approve'?'Approving':'Denying');
  }
  if(cardEl&&isMobile())cardEl.scrollIntoView({behavior:'smooth',block:'center'});
  try{
    const body=action==='approve'?'{"approvedBy":"local-user"}':'{"reason":"Denied from local approval page"}';
    await fetch('/api/'+action+'/'+id,{method:'POST',headers:{'content-type':'application/json'},body});
    if(btns)btns.outerHTML='<div class="result '+(action==='approve'?'ok':'no')+'">'+(action==='approve'?'Approved &middot; proof signed':'Denied &middot; receipt sealed')+'</div>';
  }catch(e){
    if(btns)btns.outerHTML='<div class="result no">Could not reach the server, try again</div>';
  }
  setTimeout(()=>{busy=false;refresh();},1100);
}
document.addEventListener('click',(e)=>{
  const btn=e.target&&e.target.closest?e.target.closest('button[data-act]'):null;
  if(!btn)return;
  act(btn.getAttribute('data-id'),btn.getAttribute('data-act'));
});
refresh();setInterval(refresh,1200);
</script></body></html>`;
