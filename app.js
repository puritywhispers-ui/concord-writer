'use strict';
/* Concord Writer — offline novel studio. All data in IndexedDB on this device. */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const countWords=t=>(t.match(/[\p{L}\p{N}'’-]+/gu)||[]).length;
const htmlText=h=>{const d=document.createElement('div');d.innerHTML=h||'';d.querySelectorAll('p,h1,h2,h3,div,br,li').forEach(e=>e.append('\n'));return d.textContent};

/* ---------- IndexedDB ---------- */
let db;
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open('concord-writer',1);
 r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('kv');d.createObjectStore('scenes',{keyPath:'id'});d.createObjectStore('snaps',{keyPath:'date'});const s=d.createObjectStore('scsnaps',{keyPath:'id'});s.createIndex('scene','sceneId')};
 r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function tx(store,mode,fn){return new Promise((res,rej)=>{const t=db.transaction(store,mode);let out;const st=Array.isArray(store)?store.map(s=>t.objectStore(s)):t.objectStore(store);const r=fn(st);if(r&&'onsuccess'in r)r.onsuccess=()=>out=r.result;t.oncomplete=()=>res(out);t.onerror=t.onabort=()=>rej(t.error)})}
const kvGet=k=>tx('kv','readonly',s=>s.get(k)), getAll=st=>tx(st,'readonly',s=>s.getAll());

/* ---------- State ---------- */
let P, S={theme:'dark',fs:19,typewriter:false}, cur=null, sceneCache=new Map(), dirtyScenes=new Set(), projDirty=false, saveTimer;
const KIDS={project:['book'],book:['part','chapter'],part:['chapter'],chapter:['scene'],scene:[]};
function newNode(type,title){const n={id:uid(),type,title,children:[]};if(type==='scene'){n.status='draft';n.pov='';n.synopsis='';n.notes='';n.wc=0}return n}
function freshProject(){const sc=newNode('scene','Scene 1'),ch=newNode('chapter','Chapter 1'),bk=newNode('book','Book 1');ch.children=[sc];bk.children=[ch];
 return {id:uid(),title:'The Thirteen Concord',type:'project',children:[bk],notes:[],plotlines:[{id:uid(),name:'Main plot'}],cards:[],goals:{daily:1000,project:120000,deadline:''},history:{},dayStart:{},current:sc.id,created:Date.now()}}

function walk(n,f,parent=null){f(n,parent);(n.children||[]).forEach(c=>walk(c,f,n))}
function find(id){let r=null;walk(P,(n,p)=>{if(n.id===id)r={node:n,parent:p}});return r}
const scenes=(n=P)=>{const a=[];walk(n,x=>{if(x.type==='scene')a.push(x)});return a};
const wcOf=n=>scenes(n).reduce((a,s)=>a+(s.wc||0),0);

/* ---------- Saving ---------- */
function setSaved(state){const e=$('#saved');e.textContent={dirty:'Editing…',saving:'Saving…',ok:'Saved ✓',err:'Save failed!'}[state];e.className='saved'+(state==='ok'?'':' dirty')}
function markDirty(){projDirty=true;setSaved('dirty');clearTimeout(saveTimer);saveTimer=setTimeout(flush,700)}
let flushing=Promise.resolve();
function flush(){clearTimeout(saveTimer);flushing=flushing.then(doFlush);return flushing}
async function doFlush(){if(!projDirty&&!dirtyScenes.size)return;setSaved('saving');
 try{captureEditor();trackDay();const ids=[...dirtyScenes];dirtyScenes.clear();projDirty=false;
  const proj=JSON.parse(JSON.stringify(P));
  await tx(['kv','scenes'],'readwrite',([kv,sc])=>{kv.put(proj,'project');ids.forEach(id=>sc.put({id,html:sceneCache.get(id)||''}))});
  setSaved('ok');dailySnapshot()}catch(e){console.warn(e);setSaved('err');projDirty=true}}
async function loadScene(id){if(sceneCache.has(id))return sceneCache.get(id);const r=await tx('scenes','readonly',s=>s.get(id));const h=r?r.html:'';sceneCache.set(id,h);return h}
async function allSceneHtml(){const all=await getAll('scenes');const m={};all.forEach(r=>m[r.id]=r.html);sceneCache.forEach((h,id)=>{if(!id.startsWith('__'))m[id]=h});return m}

/* daily goals */
function trackDay(){const d=today(),tot=wcOf(P);if(P.dayStart[d]==null){P.dayStart[d]=tot;projDirty=true}P.history[d]=Math.max(0,tot-P.dayStart[d])}
async function dailySnapshot(){const d=today();if(Date.now()-(window._lastSnap||0)<600000)return;window._lastSnap=Date.now();
 const scenesHtml=await allSceneHtml();await tx('snaps','readwrite',s=>s.put({date:d,at:Date.now(),project:JSON.parse(JSON.stringify(P)),scenes:scenesHtml}));
 const keys=await tx('snaps','readonly',s=>s.getAllKeys());if(keys.length>30)await tx('snaps','readwrite',s=>keys.slice(0,keys.length-30).forEach(k=>s.delete(k)))}

/* ---------- Tree UI ---------- */
function renderTree(){const t=$('#tree');t.innerHTML='';P.children.forEach(b=>t.append(nodeEl(b)));$('#ptitle').textContent=P.title}
function nodeEl(n){const w=document.createElement('div');w.className='node';w.dataset.id=n.id;
 const r=document.createElement('div');r.className='nrow'+(n.id===cur?' cur':'');
 const isS=n.type==='scene',kids=KIDS[n.type];
 r.innerHTML=`<span class="handle" aria-label="Drag">⋮⋮</span><span class="t">${isS?`<i class="st st-${n.status}"></i>`:`<span class="kind">${n.type}</span>`}${esc(n.title)} <span class="n">${wcOf(n).toLocaleString()}</span></span>`+
  `<button data-a="up" aria-label="Move up">↑</button><button data-a="dn" aria-label="Move down">↓</button>`+(kids.length?`<button data-a="add" aria-label="Add">＋</button>`:'')+`<button data-a="more" aria-label="More">⋯</button>`;
 r.querySelector('.t').onclick=()=>{if(isS)openScene(n.id);else{const f=scenes(n)[0];if(f)openScene(f.id)}};
 r.querySelectorAll('button').forEach(b=>b.onclick=e=>{e.stopPropagation();nodeAction(n,b.dataset.a)});
 r.querySelector('.handle').addEventListener('pointerdown',e=>startDrag(e,n,w));
 w.append(r);(n.children||[]).forEach(c=>w.append(nodeEl(c)));return w}
function nodeAction(n,a){const {parent}=find(n.id),sib=parent.children,i=sib.indexOf(n);
 if(a==='up'&&i>0){sib.splice(i,1);sib.splice(i-1,0,n)}
 else if(a==='dn'&&i<sib.length-1){sib.splice(i,1);sib.splice(i+1,0,n)}
 else if(a==='add'){let types=KIDS[n.type];let type=types[types.length-1];if(types.length>1&&!confirm('Add a Chapter? (Cancel = add a Part)'))type='part';
  const c=newNode(type,type[0].toUpperCase()+type.slice(1)+' '+(n.children.filter(x=>x.type===type).length+1));
  if(type==='chapter'||type==='part'){const s=newNode('scene','Scene 1');if(type==='chapter')c.children=[s];else{const ch=newNode('chapter','Chapter 1');ch.children=[s];c.children=[ch]}}
  n.children.push(c);markDirty();renderTree();const f=scenes(c)[0];if(f)openScene(f.id);return}
 else if(a==='more'){const v=prompt(`Rename ${n.type} (type DELETE to delete it):`,n.title);if(v==null)return;
  if(v==='DELETE'){if(scenes(P).length-scenes(n).length<1)return alert('Keep at least one scene.');sib.splice(i,1);
   const gone=scenes(n).map(s=>s.id);tx('scenes','readwrite',s=>gone.forEach(id=>s.delete(id)));if(gone.includes(cur))openScene(scenes(P)[0].id)}
  else{n.title=v.trim()||n.title;if(n.id===cur)$('#sceneTitle').value=n.title}}
 markDirty();renderTree()}
/* touch-friendly drag via pointer events */
function startDrag(e,n,w){e.preventDefault();w.classList.add('dragging');let target=null;
 const mv=ev=>{const el=document.elementFromPoint(ev.clientX,ev.clientY);const nd=el&&el.closest('.node');$$('.drop').forEach(x=>x.classList.remove('drop'));target=null;
  if(nd&&!w.contains(nd)){const t=find(nd.dataset.id).node;if(t.type===n.type||KIDS[t.type].includes(n.type)){target=t;nd.firstChild.classList.add('drop')}}
  const sd=$('#side').getBoundingClientRect();if(ev.clientY<sd.top+40)$('#side').scrollTop-=10;if(ev.clientY>sd.bottom-40)$('#side').scrollTop+=10};
 const up=()=>{removeEventListener('pointermove',mv);removeEventListener('pointerup',up);w.classList.remove('dragging');$$('.drop').forEach(x=>x.classList.remove('drop'));
  if(target){const src=find(n.id).parent.children;src.splice(src.indexOf(n),1);
   if(target.type===n.type){const tp=find(target.id).parent.children;tp.splice(tp.indexOf(target),0,n)}else target.children.push(n);markDirty()}renderTree()};
 addEventListener('pointermove',mv);addEventListener('pointerup',up)}

/* ---------- Editor ---------- */
const ed=$('#editor');
function captureEditor(){if(!cur)return;const h=ed.innerHTML;if(sceneCache.get(cur)!==h){sceneCache.set(cur,h);dirtyScenes.add(cur)}}
let lastWc=0;
async function openScene(id){if(cur){captureEditor();await flush()}const f=find(id);if(!f)return;cur=id;P.current=id;
 const h=await loadScene(id);ed.innerHTML=h;const n=f.node;lastWc=n.wc||0;
 $('#sceneTitle').value=n.title;$('#mPov').value=n.pov||'';$('#mStatus').value=n.status||'draft';$('#mSyn').value=n.synopsis||'';$('#mNotes').value=n.notes||'';
 renderTree();updWc();$('#side').classList.remove('open');show('write');projDirty=true;flush()}
let wcT;
ed.addEventListener('input',()=>{dirtyScenes.add(cur);sceneCache.set(cur,ed.innerHTML);markDirty();clearTimeout(wcT);wcT=setTimeout(updWc,400);if(S.typewriter)typewriter()});
function updWc(){const n=find(cur)?.node;if(!n)return;const w=countWords(htmlText(ed.innerHTML));
 if(lastWc>200&&w<lastWc*0.7){autoSceneSnap(n,'Auto: before large cut ('+lastWc+'→'+w+')');}lastWc=w;
 n.wc=w;const ch=chain(cur);const chap=ch.find(x=>x.type==='chapter'),bk=ch.find(x=>x.type==='book');trackDay();
 $('#wc').textContent=`Scene ${w.toLocaleString()} · Chapter ${chap?wcOf(chap).toLocaleString():0} · Book ${bk?wcOf(bk).toLocaleString():0} · Today ${(P.history[today()]||0).toLocaleString()}/${P.goals.daily}`;
 const row=$(`.node[data-id="${cur}"] .n`);if(row)row.textContent=w.toLocaleString()}
function chain(id){const out=[];let f=find(id);while(f&&f.parent){out.push(f.node);f=find(f.parent.id)}return out}
let snapCooldown=0;
async function autoSceneSnap(n,label){if(Date.now()-snapCooldown<60000)return;snapCooldown=Date.now();await sceneSnap(n,label,sceneCache.get('__prev_'+n.id))}
async function sceneSnap(n,label,html){html=html??ed.innerHTML;await tx('scsnaps','readwrite',s=>s.put({id:uid(),sceneId:n.id,at:Date.now(),label,html}))}
// keep a "previous good" copy for auto-snapshots
setInterval(()=>{if(cur&&(find(cur)?.node.wc||0)>=lastWc)sceneCache.set('__prev_'+cur,ed.innerHTML)},15000);
ed.addEventListener('focus',()=>{sceneCache.set('__prev_'+cur,ed.innerHTML)},{once:false});
['sceneTitle','mPov','mSyn','mNotes'].forEach(k=>$('#'+k).addEventListener('input',e=>{const n=find(cur).node;const m={sceneTitle:'title',mPov:'pov',mSyn:'synopsis',mNotes:'notes'}[k];n[m]=e.target.value;markDirty();if(k==='sceneTitle')clearTimeout(n._t),n._t=setTimeout(renderTree,500)}));
$('#mStatus').onchange=e=>{find(cur).node.status=e.target.value;markDirty();renderTree()};
$('#metaBtn').onclick=()=>$('#meta').hidden=!$('#meta').hidden;
$('#snapBtn').onclick=async()=>{await sceneSnap(find(cur).node,'Manual snapshot');toast('Scene snapshot saved')};
$('#snapList').onclick=async()=>{const all=(await getAll('scsnaps')).filter(s=>s.sceneId===cur).sort((a,b)=>b.at-a.at);
 modal(`<h3>Scene history</h3>`+(all.map(s=>`<div class="card"><b>${new Date(s.at).toLocaleString()}</b> <span class="mut">${esc(s.label)} · ${countWords(htmlText(s.html))} words</span><div class="row"><button class="sm" data-r="${s.id}">Restore</button></div></div>`).join('')||'<p class="mut">No snapshots yet.</p>'));
 $$('#mbody [data-r]').forEach(b=>b.onclick=async()=>{const s=all.find(x=>x.id===b.dataset.r);await sceneSnap(find(cur).node,'Before restore');ed.innerHTML=s.html;ed.dispatchEvent(new Event('input'));updWc();closeModal();toast('Restored')})};
/* toolbar above keyboard */
const tb=$('#tb');
function placeTb(){const vv=window.visualViewport;if(!vv)return;const off=window.innerHeight-vv.height-vv.offsetTop;tb.style.bottom=Math.max(0,off)+'px';tb.style.paddingBottom=off>40?'6px':''}
visualViewport&&visualViewport.addEventListener('resize',placeTb);visualViewport&&visualViewport.addEventListener('scroll',placeTb);
ed.addEventListener('focus',()=>{tb.classList.add('show');placeTb();try{document.execCommand('defaultParagraphSeparator',false,'p')}catch(_){}if(!ed.innerHTML.trim()){ed.innerHTML='<p><br></p>';const r=document.createRange();r.setStart(ed.firstChild,0);const s=getSelection();s.removeAllRanges();s.addRange(r)}});
ed.addEventListener('blur',()=>{setTimeout(()=>{if(document.activeElement!==ed)tb.classList.remove('show')},200);captureEditor();flush()});
tb.addEventListener('pointerdown',e=>e.preventDefault());
tb.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const c=b.dataset.c;ed.focus();
 if(c==='bold'||c==='italic'||c==='undo'||c==='redo')document.execCommand(c);
 else if(c==='h2'||c==='h3'||c==='p')document.execCommand('formatBlock',false,c==='p'?'P':c.toUpperCase());
 else if(c==='sb'){const sel=getSelection();let blk=sel.anchorNode;while(blk&&blk.parentNode!==ed)blk=blk.parentNode;const sb=document.createElement('p');sb.className='sb';sb.textContent='* * *';const np=document.createElement('p');np.innerHTML='<br>';
  if(blk&&blk!==ed)blk.after(sb,np);else ed.append(sb,np);const r=document.createRange();r.setStart(np,0);sel.removeAllRanges();sel.addRange(r)}
 else if(c==='done'){ed.blur();return}
 ed.dispatchEvent(new Event('input'))});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();captureEditor();projDirty=true;flush()}});
ed.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData('text/plain');
 document.execCommand('insertHTML',false,t.split(/\n{1,}/).map(l=>`<p>${esc(l)}</p>`).join(''))});
function typewriter(){const s=getSelection();if(!s.rangeCount)return;const r=s.getRangeAt(0).getBoundingClientRect();if(!r.height)return;const box=ed.getBoundingClientRect();ed.scrollTop+=r.top-(box.top+box.height*0.4)}
/* focus mode */
const fx=document.createElement('button');fx.id='focusExit';fx.className='sm';fx.textContent='Exit focus';document.body.append(fx);
$('#focusBtn').onclick=()=>{show('write');document.body.classList.add('focus');ed.focus()};fx.onclick=()=>document.body.classList.remove('focus');
/* split notes */
$('#splitBtn').onclick=()=>{const s=$('#split');s.hidden=!s.hidden;if(!s.hidden)renderSplit()};
function renderSplit(){const s=$('#split');s.innerHTML=`<input id="sq" type="search" placeholder="Find a note…"><div id="sl"></div>`;
 const draw=()=>{const q=$('#sq').value.toLowerCase();$('#sl').innerHTML=P.notes.filter(n=>!q||(n.name+n.tags+n.body).toLowerCase().includes(q)).map(n=>`<div class="card"><span class="kind">${n.cat}</span> <b>${esc(n.name)}</b><div class="mut">${esc(n.tags)}</div><div style="white-space:pre-wrap">${esc(n.body)}</div></div>`).join('')||'<p class="mut">No notes.</p>'};
 $('#sq').oninput=draw;draw()}

/* ---------- Views ---------- */
function show(v){$$('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));$$('.view').forEach(x=>x.classList.toggle('on',x.id==='v-'+v));
 if(v!=='write'){captureEditor();flush()}({plot:renderPlot,notes:renderNotes,goals:renderGoals,more:renderMore,search:()=>$('#q').focus()}[v]||(()=>{}))()}
$$('#tabs button').forEach(b=>b.onclick=()=>show(b.dataset.v));
$('#menuBtn').onclick=()=>{if(innerWidth<900)$('#side').classList.toggle('open');else $('#side').hidden=!$('#side').hidden};
$('#addBook').onclick=()=>{const b=newNode('book','Book '+(P.children.length+1)),c=newNode('chapter','Chapter 1'),s=newNode('scene','Scene 1');c.children=[s];b.children=[c];P.children.push(b);markDirty();openScene(s.id)};

/* Plot board */
function renderPlot(){const v=$('#v-plot');const sc=scenes();const opt=sel=>`<option value="">— no scene —</option>`+sc.map(s=>`<option value="${s.id}"${s.id===sel?' selected':''}>${esc(chain(s.id).reverse().map(x=>x.title).join(' › '))}</option>`).join('');
 v.innerHTML=`<h2 class="vh">Plot board</h2><div class="row"><button class="sm" id="addPL">+ Plotline</button><span class="mut">Columns are plotlines; link each card to a scene.</span></div><div class="cols">`+
 P.plotlines.map((pl,pi)=>`<div class="col" data-pl="${pl.id}"><div class="row"><input value="${esc(pl.name)}" data-pln="${pl.id}"></div><div class="row"><button class="sm" data-mv="${pi}" data-d="-1">←</button><button class="sm" data-mv="${pi}" data-d="1">→</button><button class="sm" data-addc="${pl.id}">+ Card</button><button class="sm" data-delpl="${pl.id}">✕</button></div>`+
  P.cards.filter(c=>c.pl===pl.id).map(c=>`<div class="card"><textarea rows="3" data-ct="${c.id}" placeholder="Beat…">${esc(c.text)}</textarea><select data-cs="${c.id}">${opt(c.scene)}</select><div class="row"><button class="sm" data-cu="${c.id}">↑</button><button class="sm" data-cdn="${c.id}">↓</button>${c.scene?`<button class="sm" data-go="${c.scene}">Open scene</button>`:''}<button class="sm" data-cdel="${c.id}">✕</button></div></div>`).join('')+`</div>`).join('')+`</div>`;
 const ch=()=>{markDirty()};
 $('#addPL').onclick=()=>{P.plotlines.push({id:uid(),name:'New plotline'});ch();renderPlot()};
 v.querySelectorAll('[data-pln]').forEach(i=>i.oninput=()=>{P.plotlines.find(p=>p.id===i.dataset.pln).name=i.value;ch()});
 v.querySelectorAll('[data-mv]').forEach(b=>b.onclick=()=>{const i=+b.dataset.mv,j=i+ +b.dataset.d;if(j<0||j>=P.plotlines.length)return;[P.plotlines[i],P.plotlines[j]]=[P.plotlines[j],P.plotlines[i]];ch();renderPlot()});
 v.querySelectorAll('[data-addc]').forEach(b=>b.onclick=()=>{P.cards.push({id:uid(),pl:b.dataset.addc,text:'',scene:''});ch();renderPlot()});
 v.querySelectorAll('[data-delpl]').forEach(b=>b.onclick=()=>{if(!confirm('Delete plotline and its cards?'))return;P.plotlines=P.plotlines.filter(p=>p.id!==b.dataset.delpl);P.cards=P.cards.filter(c=>c.pl!==b.dataset.delpl);ch();renderPlot()});
 v.querySelectorAll('[data-ct]').forEach(t=>t.oninput=()=>{P.cards.find(c=>c.id===t.dataset.ct).text=t.value;ch()});
 v.querySelectorAll('[data-cs]').forEach(t=>t.onchange=()=>{P.cards.find(c=>c.id===t.dataset.cs).scene=t.value;ch();renderPlot()});
 v.querySelectorAll('[data-cdel]').forEach(b=>b.onclick=()=>{P.cards=P.cards.filter(c=>c.id!==b.dataset.cdel);ch();renderPlot()});
 const mvc=(id,d)=>{const c=P.cards.find(x=>x.id===id),same=P.cards.filter(x=>x.pl===c.pl),k=same.indexOf(c),o=same[k+d];if(!o)return;const a=P.cards.indexOf(c),b=P.cards.indexOf(o);[P.cards[a],P.cards[b]]=[P.cards[b],P.cards[a]];ch();renderPlot()};
 v.querySelectorAll('[data-cu]').forEach(b=>b.onclick=()=>mvc(b.dataset.cu,-1));v.querySelectorAll('[data-cdn]').forEach(b=>b.onclick=()=>mvc(b.dataset.cdn,1));
 v.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>openScene(b.dataset.go))}

/* Story notes */
const CATS=['character','place','faction','god','lore'];let noteCat='all',noteQ='';
function renderNotes(){const v=$('#v-notes');const list=P.notes.filter(n=>(noteCat==='all'||n.cat===noteCat)&&(!noteQ||(n.name+' '+n.tags+' '+n.body).toLowerCase().includes(noteQ)));
 v.innerHTML=`<h2 class="vh">Story notes</h2><div class="row">${['all',...CATS].map(c=>`<button class="sm${c===noteCat?' on':''}" data-cat="${c}">${c==='all'?'All':c[0].toUpperCase()+c.slice(1)+'s'}</button>`).join('')}</div>
 <div class="row"><input id="nq" type="search" placeholder="Search notes or #tag" value="${esc(noteQ)}"></div><div class="row"><button class="sm" id="addN">+ New ${noteCat==='all'?'note':noteCat}</button></div>`+
 list.map(n=>`<div class="card" data-n="${n.id}"><div class="row"><select data-f="cat">${CATS.map(c=>`<option${c===n.cat?' selected':''}>${c}</option>`).join('')}</select></div><input data-f="name" value="${esc(n.name)}" placeholder="Name"><div class="row"><input data-f="tags" value="${esc(n.tags)}" placeholder="tags, comma separated"></div><textarea data-f="body" rows="5" placeholder="Details…">${esc(n.body)}</textarea><div class="row">${(n.tags||'').split(',').filter(t=>t.trim()).map(t=>`<span class="tag">#${esc(t.trim())}</span>`).join('')}<button class="sm" data-del>Delete</button></div></div>`).join('')+(list.length?'':'<p class="mut">No notes yet.</p>');
 v.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{noteCat=b.dataset.cat;renderNotes()});
 const q=$('#nq');q.oninput=()=>{noteQ=q.value.toLowerCase().replace(/^#/,'');clearTimeout(q._t);q._t=setTimeout(()=>{renderNotes();const nq=$('#nq');nq.focus();nq.setSelectionRange(nq.value.length,nq.value.length)},350)};
 $('#addN').onclick=()=>{P.notes.unshift({id:uid(),cat:noteCat==='all'?'character':noteCat,name:'',tags:'',body:''});markDirty();renderNotes()};
 v.querySelectorAll('[data-n]').forEach(c=>{const n=P.notes.find(x=>x.id===c.dataset.n);c.querySelectorAll('[data-f]').forEach(i=>i[i.tagName==='SELECT'?'onchange':'oninput']=()=>{n[i.dataset.f]=i.value;markDirty()});
  c.querySelector('[data-del]').onclick=()=>{if(confirm('Delete this note?')){P.notes=P.notes.filter(x=>x!==n);markDirty();renderNotes()}}})}

/* Search */
$('#q').addEventListener('input',()=>{clearTimeout($('#q')._t);$('#q')._t=setTimeout(runSearch,300)});
async function runSearch(){const q=$('#q').value.trim();const out=$('#results');if(q.length<2){out.innerHTML='';return}captureEditor();
 const m=await allSceneHtml(),ql=q.toLowerCase(),res=[];const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
 for(const s of scenes()){const t=htmlText(m[s.id]||'');const hay=t+' '+s.title+' '+s.synopsis+' '+s.notes;let i=hay.toLowerCase().indexOf(ql);if(i<0)continue;
  const n=(hay.toLowerCase().match(new RegExp(re.source,'gi'))||[]).length;res.push(`<div class="card" data-go="${s.id}"><b>${esc(chain(s.id).reverse().map(x=>x.title).join(' › '))}</b> <span class="mut">${n} match${n>1?'es':''}</span><div>${esc(hay.slice(Math.max(0,i-60),i+100)).replace(re,x=>`<mark>${x}</mark>`)}</div></div>`)}
 for(const n of P.notes){const hay=n.name+' '+n.tags+' '+n.body;const i=hay.toLowerCase().indexOf(ql);if(i<0)continue;res.push(`<div class="card" data-note><span class="kind">${n.cat}</span> <b>${esc(n.name)}</b><div>${esc(hay.slice(Math.max(0,i-60),i+100)).replace(re,x=>`<mark>${x}</mark>`)}</div></div>`)}
 out.innerHTML=res.join('')||'<p class="mut">No matches.</p>';out.querySelectorAll('[data-go]').forEach(c=>c.onclick=()=>openScene(c.dataset.go));out.querySelectorAll('[data-note]').forEach(c=>c.onclick=()=>show('notes'))}

/* Goals */
function streak(){let s=0,d=new Date();const g=P.goals.daily;const key=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
 if((P.history[key(d)]||0)<g)d.setDate(d.getDate()-1);while((P.history[key(d)]||0)>=g){s++;d.setDate(d.getDate()-1)}return s}
function renderGoals(){trackDay();const v=$('#v-goals'),g=P.goals,t=P.history[today()]||0,tot=wcOf(P);const pct=x=>Math.min(100,Math.round(x*100));
 let perDay='';if(g.deadline){const days=Math.max(1,Math.ceil((new Date(g.deadline)-new Date())/864e5));perDay=`<p class="mut">${Math.max(0,g.project-tot).toLocaleString()} words to go · ${Math.ceil(Math.max(0,g.project-tot)/days).toLocaleString()}/day for ${days} days</p>`}
 const cells=[];for(let i=34;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');const w=P.history[k]||0;cells.push(`<span title="${k}: ${w}" class="${w>=g.daily?'hit':w>0?'part':''}"></span>`)}
 v.innerHTML=`<h2 class="vh">Goals</h2><div class="card"><b>Today</b> ${t.toLocaleString()} / ${g.daily.toLocaleString()}<div class="bar"><i style="width:${pct(t/g.daily)}%"></i></div><p>🔥 Streak: <b>${streak()}</b> day(s)</p><div class="grid">${cells.join('')}</div><p class="mut">Last 5 weeks</p></div>
 <div class="card"><b>Project</b> ${tot.toLocaleString()} / ${g.project.toLocaleString()}<div class="bar"><i style="width:${pct(tot/g.project)}%"></i></div>${perDay}</div>
 <div class="card"><label>Daily goal <input id="gd" type="number" inputmode="numeric" value="${g.daily}"></label><label>Project goal <input id="gp" type="number" inputmode="numeric" value="${g.project}"></label><label>Deadline <input id="gl" type="date" value="${g.deadline}"></label></div>
 <div class="card"><b>By book</b>${P.children.map(b=>`<div class="row"><span style="flex:1">${esc(b.title)}</span><span>${wcOf(b).toLocaleString()}</span></div>`).join('')}</div>`;
 $('#gd').onchange=e=>{g.daily=Math.max(1,+e.target.value||1);markDirty();renderGoals()};$('#gp').onchange=e=>{g.project=Math.max(1,+e.target.value||1);markDirty();renderGoals()};$('#gl').onchange=e=>{g.deadline=e.target.value;markDirty();renderGoals()}}

/* Backup / export / settings */
async function renderMore(){const v=$('#v-more');const snaps=(await getAll('snaps')).sort((a,b)=>b.date.localeCompare(a.date));let est='';
 try{const e=await navigator.storage.estimate();est=`${(e.usage/1e6).toFixed(1)} MB used`;const p=await navigator.storage.persisted();est+=p?' · persistent storage ✓':' · storage not yet persistent (add to Home Screen)'}catch(_){}
 v.innerHTML=`<h2 class="vh">Backup & settings</h2>
 <div class="card"><b>Project</b><label>Title <input id="pt" value="${esc(P.title)}"></label></div>
 <div class="card"><b>Appearance</b><div class="row">${['dark','light','sepia'].map(t=>`<button class="sm${S.theme===t?' on':''}" data-th="${t}">${t}</button>`).join('')}</div>
  <div class="row">Font size <button class="sm" data-fs="-1">A−</button><span>${S.fs}px</span><button class="sm" data-fs="1">A+</button></div>
  <div class="row"><label><input type="checkbox" id="tw" style="width:auto"${S.typewriter?' checked':''}> Typewriter scrolling</label></div></div>
 <div class="card"><b>Export manuscript</b><div class="row"><button class="sm" data-ex="docx">.docx</button><button class="sm" data-ex="html">.html</button><button class="sm" data-ex="md">.md</button><button class="sm" data-ex="txt">.txt</button></div>
  <label>Scope <select id="exScope"><option value="">Whole project</option>${P.children.map(b=>`<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select></label></div>
 <div class="card"><b>Full backup</b><p class="mut">Everything (manuscript, notes, plot, goals) in one file. Do this weekly and keep it in iCloud Drive/Files.</p><div class="row"><button class="sm" id="bk">Export backup (.json)</button><button class="sm" id="im">Import backup</button><input type="file" id="imf" accept=".json,application/json" hidden></div><p class="mut">${est}</p></div>
 <div class="card"><b>Daily snapshots</b> <span class="mut">(one per day, refreshed every 10 min while writing; last 30 days)</span>${snaps.map(s=>`<div class="row"><span style="flex:1">${s.date} · ${scenes(s.project).reduce((a,x)=>a+(x.wc||0),0).toLocaleString()} words</span><button class="sm" data-rs="${s.date}">Restore</button></div>`).join('')||'<p class="mut">None yet.</p>'}</div>
 <p class="mut">Concord Writer · your writing never leaves this device unless you export it.</p>`;
 $('#pt').oninput=e=>{P.title=e.target.value;$('#ptitle').textContent=P.title;markDirty()};
 v.querySelectorAll('[data-th]').forEach(b=>b.onclick=()=>{S.theme=b.dataset.th;applyS();renderMore()});
 v.querySelectorAll('[data-fs]').forEach(b=>b.onclick=()=>{S.fs=Math.min(30,Math.max(14,S.fs+ +b.dataset.fs));applyS();renderMore()});
 $('#tw').onchange=e=>{S.typewriter=e.target.checked;applyS()};
 v.querySelectorAll('[data-ex]').forEach(b=>b.onclick=()=>exportMs(b.dataset.ex,$('#exScope').value));
 $('#bk').onclick=exportBackup;$('#im').onclick=()=>$('#imf').click();$('#imf').onchange=e=>importBackup(e.target.files[0]);
 v.querySelectorAll('[data-rs]').forEach(b=>b.onclick=async()=>{if(!confirm('Restore snapshot from '+b.dataset.rs+'? Current state is saved as a backup snapshot first.'))return;
  const s=await tx('snaps','readonly',x=>x.get(b.dataset.rs));await saveSafety();await restoreData(s.project,s.scenes);toast('Snapshot restored')})}
function applyS(){document.body.dataset.theme=S.theme;document.documentElement.style.setProperty('--fs',S.fs+'px');const m=document.querySelector('meta[name=theme-color]');m.content=getComputedStyle(document.body).getPropertyValue('--bg').trim();tx('kv','readwrite',s=>s.put(S,'settings'))}
async function saveSafety(){captureEditor();await flush();const m=await allSceneHtml();await tx('snaps','readwrite',s=>s.put({date:today()+' (before restore '+new Date().toLocaleTimeString()+')',at:Date.now(),project:JSON.parse(JSON.stringify(P)),scenes:m}))}
async function restoreData(proj,sc){P=proj;sceneCache.clear();await tx(['kv','scenes'],'readwrite',([kv,s])=>{s.clear();Object.entries(sc).forEach(([id,html])=>s.put({id,html}));kv.put(P,'project')});cur=null;renderTree();await openScene(P.current&&find(P.current)?P.current:scenes()[0].id)}
function download(name,data,type){const b=data instanceof Blob?data:new Blob([data],{type});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000)}
const fname=ext=>(P.title||'project').replace(/[^\w\- ]+/g,'').trim().replace(/ +/g,'-')+'-'+today()+'.'+ext;
async function exportBackup(){captureEditor();await flush();const m=await allSceneHtml();Object.keys(m).forEach(k=>{if(k.startsWith('__'))delete m[k]});
 download(fname('concord.json'),JSON.stringify({app:'concord-writer',version:1,exported:new Date().toISOString(),project:P,scenes:m}),'application/json');toast('Backup exported')}
async function importBackup(f){if(!f)return;try{const d=JSON.parse(await f.text());if(d.app!=='concord-writer'||!d.project||!d.scenes)throw Error('Not a Concord Writer backup');
 if(!confirm(`Replace current project with "${d.project.title}" from ${d.exported}? (Current state is kept as a snapshot.)`))return;await saveSafety();await restoreData(d.project,d.scenes);toast('Backup imported')}catch(e){alert('Import failed: '+e.message)}}
/* manuscript export */
async function exportMs(fmt,scope){captureEditor();await flush();const m=await allSceneHtml();const root=scope?find(scope).node:P;const blocks=[];// {t:'h1'|'h2'|'h3'|'p'|'sb', runs:[{text,b,i}]}
 const title=scope?root.title:P.title;blocks.push({t:'title',runs:[{text:title}]});
 const lvl={book:'h1',part:'h1',chapter:'h2'};let firstScene=true;
 walk(root,(n)=>{if(n===root&&scope&&n.type==='book')return;if(lvl[n.type]){blocks.push({t:lvl[n.type],runs:[{text:n.title}],brk:n.type!=='chapter'||true});firstScene=true}
  else if(n.type==='scene'){if(!firstScene)blocks.push({t:'sb',runs:[{text:'* * *'}]});firstScene=false;blocks.push(...htmlBlocks(m[n.id]||''))}});
 const base=fname(fmt).replace(/\.\w+$/,'');
 if(fmt==='txt')download(base+'.txt',blocks.map(b=>b.runs.map(r=>r.text).join('')).join('\n\n'),'text/plain');
 else if(fmt==='md')download(base+'.md',blocks.map(b=>{const t=b.runs.map(r=>r.b&&r.i?`***${r.text}***`:r.b?`**${r.text}**`:r.i?`*${r.text}*`:r.text).join('');return{title:'# ',h1:'# ',h2:'## ',h3:'### '}[b.t]?({title:'# ',h1:'# ',h2:'## ',h3:'### '}[b.t]+t):b.t==='sb'?'\n* * *\n':t}).join('\n\n'),'text/markdown');
 else if(fmt==='html')download(base+'.html',`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:2;max-width:6.5in;margin:auto}p{text-indent:.5in;margin:0}h1,h2{text-align:center;page-break-before:always}.sb{text-align:center;text-indent:0}</style></head><body>`+blocks.map(b=>{const t=b.runs.map(r=>{let x=esc(r.text);if(r.i)x=`<i>${x}</i>`;if(r.b)x=`<b>${x}</b>`;return x}).join('');return b.t==='title'?`<h1>${t}</h1>`:b.t==='sb'?`<p class="sb">${t}</p>`:`<${b.t}>${t}</${b.t}>`}).join('\n')+'</body></html>','text/html');
 else download(base+'.docx',makeDocx(blocks),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');toast('Exported '+fmt)}
function htmlBlocks(h){const d=document.createElement('div');d.innerHTML=h;const out=[];
 const runs=(el,b=false,i=false,acc=[])=>{el.childNodes.forEach(c=>{if(c.nodeType===3)acc.push({text:c.textContent,b,i});else if(c.nodeType===1){const t=c.tagName;if(t==='BR')acc.push({text:'\n',b,i});else runs(c,b||t==='B'||t==='STRONG'||/bold|[6-9]00/.test(c.style.fontWeight),i||t==='I'||t==='EM'||c.style.fontStyle==='italic',acc)}});return acc};
 const loose=[];const pushLoose=()=>{if(loose.length){const r=[];loose.forEach(n=>runs(n.nodeType===3?{childNodes:[n]}:wrap(n),false,false,r));if(r.some(x=>x.text.trim()))out.push({t:'p',runs:r});loose.length=0}};
 const wrap=n=>{const w=document.createElement('span');w.append(n.cloneNode(true));return w};
 [...d.childNodes].forEach(n=>{if(n.nodeType===1&&/^(P|DIV|H1|H2|H3|H4|HR|BLOCKQUOTE|LI|UL|OL)$/.test(n.tagName)){pushLoose();const t=n.tagName;
   if(t==='HR'||n.classList.contains('sb'))out.push({t:'sb',runs:[{text:'* * *'}]});else if(t==='UL'||t==='OL')n.querySelectorAll('li').forEach(li=>out.push({t:'p',runs:runs(li)}));
   else{const r=runs(n);if(r.some(x=>x.text.trim()))out.push({t:/^H[1-3]$/.test(t)?'h3':'p',runs:r})}}else loose.push(n)});pushLoose();return out}
/* minimal .docx generator (stored ZIP) */
function makeDocx(blocks){const x=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
 const st={title:'Title',h1:'Heading1',h2:'Heading2',h3:'Heading3',p:'Body',sb:'SceneBreak'};let first=true;
 const body=blocks.map(b=>{const brk=(b.t==='h1'||b.t==='h2')&&!first;first=false;return `<w:p><w:pPr><w:pStyle w:val="${st[b.t]}"/>${brk?'<w:pageBreakBefore/>':''}</w:pPr>`+b.runs.map(r=>r.text.split('\n').map((seg,k)=>`<w:r><w:rPr>${r.b?'<w:b/>':''}${r.i?'<w:i/>':''}</w:rPr>${k?'<w:br/>':''}<w:t xml:space="preserve">${x(seg)}</w:t></w:r>`).join('')).join('')+'</w:p>'}).join('');
 const W='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
 const doc=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
 const sty=(id,name,ppr,rpr)=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
 const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>`+
  sty('Body','Body','<w:spacing w:line="480" w:lineRule="auto" w:after="0"/><w:ind w:firstLine="720"/>','')+sty('Title','Title','<w:jc w:val="center"/><w:spacing w:before="2400" w:after="480"/>','<w:sz w:val="48"/>')+
  sty('Heading1','heading 1','<w:jc w:val="center"/><w:spacing w:before="1200" w:after="480"/><w:outlineLvl w:val="0"/>','<w:b/><w:sz w:val="36"/>')+sty('Heading2','heading 2','<w:jc w:val="center"/><w:spacing w:before="960" w:after="480"/><w:outlineLvl w:val="1"/>','<w:sz w:val="32"/>')+
  sty('Heading3','heading 3','<w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="2"/>','<w:b/>')+sty('SceneBreak','Scene Break','<w:jc w:val="center"/><w:spacing w:before="240" w:after="240" w:line="480" w:lineRule="auto"/>','')+`</w:styles>`;
 const files={'[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  '_rels/.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/_rels/document.xml.rels':`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  'word/document.xml':doc,'word/styles.xml':styles};
 return zipStore(files)}
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=u=>{let c=-1;for(let i=0;i<u.length;i++)c=CRC[(c^u[i])&255]^(c>>>8);return(c^-1)>>>0};
function zipStore(files){const enc=new TextEncoder(),parts=[],cen=[];let off=0;
 for(const[name,s]of Object.entries(files)){const nb=enc.encode(name),d=enc.encode(s),c=crc32(d);
  const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint32(14,c,true);h.setUint32(18,d.length,true);h.setUint32(22,d.length,true);h.setUint16(26,nb.length,true);
  parts.push(h.buffer,nb,d);const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint32(16,c,true);ch.setUint32(20,d.length,true);ch.setUint32(24,d.length,true);ch.setUint16(28,nb.length,true);ch.setUint32(42,off,true);
  cen.push(ch.buffer,nb);off+=30+nb.length+d.length}
 const csz=cen.reduce((a,b)=>a+(b.byteLength),0),e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);const n=Object.keys(files).length;e.setUint16(8,n,true);e.setUint16(10,n,true);e.setUint32(12,csz,true);e.setUint32(16,off,true);
 return new Blob([...parts,...cen,e.buffer],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})}

/* ---------- misc UI ---------- */
function modal(h){$('#mbody').innerHTML=h;$('#modal').hidden=false}function closeModal(){$('#modal').hidden=true}$('#mclose').onclick=closeModal;
function toast(t){const e=document.createElement('div');e.textContent=t;e.style.cssText='position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top) + 60px);background:var(--acc);color:var(--bg);padding:8px 16px;border-radius:20px;z-index:60';document.body.append(e);setTimeout(()=>e.remove(),2000)}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){captureEditor();flush()}});
addEventListener('pagehide',()=>{captureEditor();flush()});
addEventListener('beforeunload',e=>{captureEditor();if(dirtyScenes.size||projDirty){flush();e.preventDefault();e.returnValue=''}});

/* ---------- boot ---------- */
(async function boot(){try{db=await openDB();S=Object.assign(S,await kvGet('settings')||{});applyS();P=await kvGet('project');
 if(!P){P=freshProject();projDirty=true;await flush()}
 if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
 renderTree();await openScene(find(P.current)?.node.type==='scene'?P.current:scenes()[0].id);setSaved('ok');ed.blur()}catch(e){console.error(e);alert('Could not open local storage: '+e.message+'\nPrivate Browsing may block saving.')}
 if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('service-worker.js').catch(e=>console.warn('SW',e))})();
