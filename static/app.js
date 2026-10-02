'use strict';
const root = document.getElementById('app');
let auth, workspace, admin, view = 'chat', tab = 'models', conversationId = '', messages = [], busy = false, selectedRepository = '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); setTimeout(() => $('toast').classList.remove('visible'), 6000); }
async function api(path, method = 'GET', data) {
  const response = await fetch(path, {method, headers: {...(data instanceof FormData ? {} : {'Content-Type':'application/json'}), 'X-CSRF-Token':auth?.csrf || ''}, body:data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed. Please retry.');
  return result;
}
const logo = '<div class="brand"><span class="logo">✳</span> raazi <small>WORKSPACE</small></div>';
async function init() {
  auth = await api('/api/session');
  if (!auth.user) {
    root.innerHTML = `<main class="login"><section class="card">${logo}<div class="eyebrow">Your knowledge, connected</div><h1>A little clarity.<br>A lot of possibility.</h1><p class="subtitle">Your private AI workspace, powered by your organization's knowledge.</p>${auth.development ? '<button id="dev-login" class="primary">Enter development workspace →</button><p class="help">Local development mode · administrator access<br>Use enterprise sign-in before sharing this app.</p>' : '<a class="primary" href="/auth/login">Continue with your work account →</a><p class="help">Sign in securely with your organization.</p>'}</section></main>`;
    if ($('dev-login')) $('dev-login').onclick = run(async () => { await api('/auth/development', 'POST', {}); await init(); });
    return;
  }
  workspace = await api('/api/workspace'); render();
}
function run(fn) { return async (...args) => { try { await fn(...args); } catch (error) { toast(error.message); } }; }
function navButton(id, icon, label) { return `<button data-view="${id}" class="${view === id ? 'active' : ''}"><span>${icon}</span>${label}</button>`; }
function render() {
  root.innerHTML = `<div class="layout"><aside class="sidebar">${logo}<button class="new-chat" id="new-chat">＋ &nbsp; New conversation</button><nav class="nav">${navButton('chat','◌','Workspace')}${navButton('knowledge','▧','Knowledge')}${auth.user.role === 'admin' ? navButton('admin','⚙','Admin console') : ''}</nav><div class="recent eyebrow">Recent conversations</div><div class="history">${workspace.conversations.map(c => `<button data-chat="${esc(c.id)}">${esc(c.title)}</button>`).join('') || '<div class="empty-small">A fresh start.<br>Your conversations will live here.</div>'}</div><div class="sidebar-bottom"><p class="private">♧ &nbsp; Private by design. Yours to explore.</p><button class="account" data-view="profile"><span class="avatar">${esc(auth.user.name.slice(0,2).toUpperCase())}</span><span><strong>${esc(auth.user.name)}</strong><small>${esc(auth.user.department || 'Enterprise workspace')} · ${esc(auth.user.role)}</small></span></button></div></aside><main class="main"><header class="topbar"><strong>${view === 'chat' ? 'Workspace / '+esc(workspace.model || 'No model configured') : ({knowledge:'Knowledge library',admin:'Workspace administration',profile:'Your enterprise profile'})[view]}</strong><span class="badge"><span class="dot">●</span>${auth.development ? 'Development workspace' : 'Enterprise workspace'}</span></header><div id="content"></div></main></div>`;
  document.querySelectorAll('[data-view]').forEach(el => el.onclick = run(async () => { if (busy) return; view = el.dataset.view; if(view === 'admin') admin = await api('/api/admin'); render(); }));
  $('new-chat').onclick = () => { if(busy) return; view='chat'; conversationId=''; messages=[]; selectedRepository=''; render(); };
  document.querySelectorAll('[data-chat]').forEach(el => el.onclick = run(async () => { if(busy) return; conversationId=el.dataset.chat; messages=await api('/api/conversations/'+conversationId); view='chat'; render(); }));
  if(view==='chat') renderChat();
  if(view==='knowledge') renderKnowledge();
  if(view==='profile') renderProfile();
  if(view==='admin') renderAdmin();
}
function renderChat() {
  $('content').className='chat-wrap';
  $('content').innerHTML = `${messages.length ? `<div class="chat-actions"><button id="delete-chat" class="danger">Delete conversation</button></div><div class="messages">${messages.map(m => `<article class="message ${m.role==='user'?'user':''}"><div class="author">${m.role==='user'?'You':'✳ Raazi'}</div><div class="text">${answerMarkup(m.content,m.sources)}</div>${sourceMarkup(m.sources)}</article>`).join('')}</div>` : `<section class="welcome"><div class="spark">✳</div><div class="eyebrow">A little knowledge goes a long way</div><h1>Make room for your next idea.</h1><p class="subtitle">Ask a question. Find what you need. Move work forward.<br>Your team’s knowledge, one conversation away.</p><div class="suggestions"><button class="suggestion" data-prompt="What are the key policies I should know in my role?"><span class="icon">▧</span><strong>Find an answer</strong><small>Make sense of your internal knowledge.</small></button><button class="suggestion" data-prompt="Help me draft a clear project update for my team."><span class="icon">✎</span><strong>Start something good</strong><small>A first draft, a fresh angle, a little momentum.</small></button><button class="suggestion" data-prompt="Help me create a step-by-step plan for my next project."><span class="icon">⌘</span><strong>Think it through</strong><small>Turn a complex task into a clear next step.</small></button></div></section>`}<form id="chat-form" class="composer"><textarea id="prompt" aria-label="Message Raazi" maxlength="16000" placeholder="What would you like to explore?" required ${busy?'disabled':''}></textarea><div class="composer-footer"><select id="repo-select" aria-label="Knowledge repository"><option value="">▧ &nbsp; All accessible knowledge</option>${workspace.repositories.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><button class="primary send" id="send" aria-label="Send message" ${busy?'disabled':''}>${busy?'…':'↑'}</button></div></form><p class="footnote">${workspace.model ? 'Powered by '+esc(workspace.model)+'. ' : 'Configure a local model in Admin console to get started. '}AI can make mistakes. Check important details.</p>`;
  document.querySelectorAll('[data-prompt]').forEach(el=>el.onclick=()=>{ $('prompt').value=el.dataset.prompt; $('prompt').focus(); });
  $('repo-select').value=selectedRepository;
  $('repo-select').onchange=()=>{selectedRepository=$('repo-select').value;};
  $('prompt').onkeydown = e => { if(e.key==='Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chat-form').requestSubmit(); } };
  $('chat-form').onsubmit = run(async e => {
    e.preventDefault(); if(busy) return;
    const message=$('prompt').value.trim(), selected=$('repo-select').value;
    if(!message) return;
    busy=true; $('send').disabled=true; $('send').textContent='…'; $('prompt').disabled=true;
    try {
      const result=await api('/api/chat','POST',{message,conversation_id:conversationId,repository_id:selected?Number(selected):null});
      conversationId=result.conversation_id; messages.push({role:'user',content:message},{role:'assistant',content:result.content,sources:result.sources});
      workspace=await api('/api/workspace');
    } catch(error) { busy=false; render(); $('prompt').value=message; throw error; }
    busy=false; render();
  });
  if($('delete-chat')) $('delete-chat').onclick=run(async()=>{ if(!confirm('Delete this conversation permanently?')) return; await api('/api/conversations/'+conversationId,'DELETE'); conversationId=''; messages=[]; workspace=await api('/api/workspace'); render(); });
}
function sourceList(value) { return typeof value==='string'?JSON.parse(value):value||[]; }
function sourceLink(s) { return /^[a-f0-9]{32}$/.test(s.source_id||'') ? '/sources/'+s.source_id : ''; }
function answerMarkup(text,value) {
 const sources=sourceList(value);
 return esc(text).replace(/\[(\d+)\]/g,(match,n)=>{
   const source=sources[Number(n)-1], link=source && sourceLink(source);
   return link?`<a class="citation" href="${link}" target="_blank" rel="noopener" title="${esc(source.title)} · ${esc(source.label)}">${match}</a>`:match;
 });
}
function sourceMarkup(value) {
 const sources=sourceList(value);
 return sources.length?`<div class="sources">Retrieved references${sources.map((s,i)=>`<details><summary>[${i+1}] ${esc(s.title)}${s.label?' · '+esc(s.label):''}</summary><p>${esc(s.content)}</p>${sourceLink(s)?`<a href="${sourceLink(s)}" target="_blank" rel="noopener">Open source${s.page?' · page '+s.page:''} ↗</a>`:''}</details>`).join('')}</div>`:'';
}
function heading(title,subtitle) { return `<div class="page-header"><div><div class="eyebrow">Raazi workspace</div><h2>${title}</h2><p class="page-subtitle">${subtitle}</p></div></div>`; }
function renderKnowledge() {
  $('content').className='page'; $('content').innerHTML=heading('A shared source of understanding.','Explore the knowledge available to your account.')+`<div class="grid">${workspace.repositories.map(r=>`<article class="card"><div class="eyebrow">▧ Knowledge repository</div><h3>${esc(r.name)}</h3><p>${esc(r.description||'Internal knowledge for your workspace.')}</p><button data-repo="${r.id}">Ask this knowledge →</button></article>`).join('')||'<div class="card full"><h3>Your library starts here</h3><p>An administrator can add repositories and documents. You’ll see the ones shared with your AD groups here.</p></div>'}</div>`;
  document.querySelectorAll('[data-repo]').forEach(el=>el.onclick=()=>{ view='chat';conversationId='';messages=[];selectedRepository=el.dataset.repo;render();$('repo-select').value=el.dataset.repo;$('prompt').focus(); });
}
function renderProfile() {
  const u=auth.user; $('content').className='page'; $('content').innerHTML=heading('Work, with a little more context.','Your enterprise identity and the context shared with your assistant.')+`<div class="card profile-data">${[['Full name',u.name],['Work email',u.email],['Department',u.department||'Not supplied by identity provider'],['Job title',u.job_title||'Not supplied by identity provider']].map(([k,v])=>`<div><small>${k}</small><p>${esc(v)}</p></div>`).join('')}<div class="full"><small>Enterprise context</small><p class="pre">${esc(u.profile||'Your administrator has not added additional context yet.')}</p></div></div><p class="help">Profile context is included in requests to your configured local model. Identity and group membership refresh when you sign in.</p><button id="logout">Sign out</button>`;
  $('logout').onclick=run(async()=>{await api('/auth/logout','POST',{}); await init();});
}
function renderAdmin() {
  $('content').className='page'; $('content').innerHTML=heading('A thoughtful space for your team.','Manage your local intelligence, shared knowledge, and people.')+`<div class="tabs">${[['models','Models & settings'],['knowledge','Knowledge'],['users','People'],['audit','Activity']].map(([id,label])=>`<button data-tab="${id}" class="${tab===id?'active':''}">${label}</button>`).join('')}</div><div id="admin-content"></div>`;
  document.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>{tab=el.dataset.tab;renderAdmin();});
  if(tab==='models') modelSettings(); if(tab==='knowledge') knowledgeSettings(); if(tab==='users') userSettings(); if(tab==='audit') $('admin-content').innerHTML=`<div class="card"><h3>Workspace activity</h3>${admin.audit.map(a=>`<div class="row"><div><strong>${esc(a.action)}</strong><small>${esc(a.user_id)}</small></div><small>${esc(a.created_at)} UTC</small></div>`).join('')||'<p>No administrative changes yet.</p>'}</div>`;
}
function modelSettings() {
 const s=admin.settings; $('admin-content').innerHTML=`<form class="card" id="settings-form"><div class="eyebrow">Model connection</div><h3>Your intelligence. Your infrastructure.</h3><p>Connect an OpenAI-compatible local inference server, such as vLLM, Ollama, or llama.cpp.</p><label for="base-url">API base URL</label><input id="base-url" type="url" value="${esc(s.base_url)}" placeholder="http://localhost:11434/v1" required><div class="help">Include /v1 where required. The server must be reachable from the Raazi backend.</div><label for="model">Model identifier</label><input id="model" value="${esc(s.model)}" placeholder="llama3.2" required><label for="api-key">API key (optional)</label><input id="api-key" type="password" autocomplete="new-password" placeholder="${s.has_api_key?'A key is saved. Leave blank to keep it.':'Only if your local server requires authentication'}"><label><input id="clear-key" type="checkbox">Remove the saved API key</label><label for="system-prompt">Assistant instructions</label><textarea id="system-prompt" required>${esc(s.system_prompt)}</textarea><div class="form-actions"><button class="primary">Save settings</button></div><div class="help">Credentials are encrypted at rest and never returned to the browser. Chat requests go through the backend.</div></form>`;
 $('settings-form').onsubmit=run(async e=>{e.preventDefault();await api('/api/admin/settings','PUT',{base_url:$('base-url').value,model:$('model').value,api_key:$('api-key').value,clear_api_key:$('clear-key').checked,system_prompt:$('system-prompt').value});await refreshAdmin();toast('Model settings saved');});
 renderEmbeddingSettings();
}
async function refreshAdmin() { admin=await api('/api/admin');workspace=await api('/api/workspace');render(); }
function knowledgeSettings() {
 $('admin-content').innerHTML=`<div class="grid"><form class="card" id="repo-form"><div class="eyebrow">01 / Organize</div><h3>Create a repository</h3><label for="repo-name">Name</label><input id="repo-name" required maxlength="150" placeholder="People & policies"><label for="repo-description">Description</label><input id="repo-description" maxlength="1000" placeholder="A guide to working here"><label for="repo-groups">Allowed AD group IDs</label><input id="repo-groups" placeholder="group-id, another-group-id"><div class="help">Comma-separated exact claims. Empty means all signed-in users. Administrators can access every repository.</div><button class="primary">Create repository</button></form><form class="card" id="doc-form"><div class="eyebrow">02 / Add knowledge</div><h3>Index a document</h3><label for="doc-repo">Repository</label><select id="doc-repo" required><option value="">Select a repository</option>${admin.repositories.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><label for="doc-file">Upload PDF, DOCX, text or Markdown</label><input id="doc-file" type="file" accept=".pdf,.docx,.txt,.md"><label for="doc-title">Document title</label><input id="doc-title" maxlength="250" required><label for="doc-content">Or paste text</label><textarea id="doc-content" maxlength="500000" required></textarea><div class="help">Up to 20 MB per file. PDF pages and DOCX sections are preserved. Scanned PDFs need OCR first. Embedding settings determine semantic or keyword indexing.</div><button class="primary" id="upload-button">Add to knowledge</button></form></div><div class="card"><h3>Repositories & documents</h3><button id="refresh-docs">Refresh status</button><p class="help">Changing the embedding model requires reindexing. Failed documents can be retried.</p>${admin.repositories.map(r=>`<div class="row"><div><strong>▧ ${esc(r.name)}</strong><small>${JSON.parse(r.groups_json).length+' group restriction(s)'}</small></div><button class="danger" data-delete-repo="${r.id}">Delete repository</button></div>${admin.documents.filter(d=>d.repo_id===r.id).map(d=>`<div class="row"><div><strong>${esc(d.title)}</strong><small>${d.size.toLocaleString()} characters · <span class="index-status">${esc(d.status)}</span></small>${d.error?`<small class="index-error">${esc(d.error)}</small>`:""}${d.warning?`<small>${esc(d.warning)}</small>`:""}</div><div class="document-actions"><button data-reindex="${d.id}">${d.status==="failed"?"Retry":"Reindex"}</button><button class="danger" data-delete-doc="${d.id}">Remove</button></div></div>`).join('')}`).join('')||'<p>No repositories yet. Create your first one above.</p>'}</div>`;
 $('repo-form').onsubmit=run(async e=>{e.preventDefault();await api('/api/admin/repositories','POST',{name:$('repo-name').value,description:$('repo-description').value,groups:$('repo-groups').value.split(',').map(x=>x.trim()).filter(Boolean)});await refreshAdmin();toast('Repository created');});
 $('doc-file').onchange=run(async e=>{const file=e.target.files[0];$('doc-content').required=!file;$('doc-content').disabled=!!file;if(!file)return;if(file.size>20*1024*1024){e.target.value='';$('doc-content').disabled=false;$('doc-content').required=true;throw new Error('Choose a file no larger than 20 MB');}$('doc-title').value=file.name;});
 $('doc-form').onsubmit=run(async e=>{
   e.preventDefault();const file=$('doc-file').files[0];const button=$('upload-button');button.disabled=true;button.textContent='Processing…';
   try {
     if(file){const data=new FormData();data.append('file',file);data.append('repository_id',$('doc-repo').value);data.append('title',$('doc-title').value);await api('/api/admin/documents/upload','POST',data);}
     else await api('/api/admin/documents','POST',{repository_id:Number($('doc-repo').value),title:$('doc-title').value,content:$('doc-content').value});
     toast('Document indexed');
   } finally {await refreshAdmin();}
 });
 $('refresh-docs').onclick=run(refreshAdmin);
 document.querySelectorAll('[data-reindex]').forEach(el=>el.onclick=run(async()=>{
   el.disabled=true;el.textContent='Processing…';try {await api('/api/admin/documents/'+el.dataset.reindex+'/reindex','POST',{});toast('Document reindexed');}finally{await refreshAdmin();}
 }));
 document.querySelectorAll('[data-delete-repo]').forEach(el=>el.onclick=run(async()=>{if(!confirm('Delete this repository and all its indexed documents?'))return;await api('/api/admin/repositories/'+el.dataset.deleteRepo,'DELETE');await refreshAdmin();}));
 document.querySelectorAll('[data-delete-doc]').forEach(el=>el.onclick=run(async()=>{if(!confirm('Remove this document from knowledge?'))return;await api('/api/admin/documents/'+el.dataset.deleteDoc,'DELETE');await refreshAdmin();}));
}
function userSettings() {
 $('admin-content').innerHTML=`<div class="notice">Users are provisioned at first enterprise sign-in. Admin rights come from the configured AD group. Add approved enterprise context below to personalize their assistant.</div>${admin.users.map((u,i)=>`<form class="card user-form" data-index="${i}"><h3>${esc(u.name)} <span class="badge">${esc(u.role)}</span></h3><p>${esc(u.email)} · ${esc(u.department||'No department supplied')}</p><label for="profile-${i}">Enterprise profile / working context</label><textarea id="profile-${i}">${esc(u.profile)}</textarea><label><input id="disabled-${i}" type="checkbox" ${u.disabled?'checked':''} ${u.id===auth.user.id?'disabled':''}>Disable workspace access</label><div class="form-actions"><button class="primary">Save profile</button></div></form>`).join('')}`;
 document.querySelectorAll('.user-form').forEach(el=>el.onsubmit=run(async e=>{e.preventDefault();const i=Number(el.dataset.index);await api('/api/admin/users','PUT',{id:admin.users[i].id,profile:$('profile-'+i).value,disabled:$('disabled-'+i).checked});auth=await api('/api/session');await refreshAdmin();toast('Enterprise profile updated');}));
}
init().catch(error=>{root.innerHTML='<div class="loading">Unable to load workspace. Refresh to retry.</div>';toast(error.message);});

function renderEmbeddingSettings() {
 $('admin-content').insertAdjacentHTML('beforeend','<div class="card" id="embedding-settings"><p>Loading embedding settings…</p></div>');
 run(async()=>{
   const s=await api('/api/admin/embedding-settings'); if(!$('embedding-settings'))return;
   $('embedding-settings').innerHTML=`<form id="embedding-form"><div class="eyebrow">Knowledge intelligence</div><h3>Embedding model</h3><p>A separate model converts passages and questions into vectors for semantic search.</p><div class="notice">Vector storage: ${s.backend==='postgres'?'PostgreSQL + pgvector (HNSW index)':'Local SQLite (exact cosine search for small workspaces)'}</div><label for="embedding-url">Embedding API base URL</label><input id="embedding-url" type="url" value="${esc(s.base_url)}" placeholder="http://localhost:11434/v1"><label for="embedding-model">Embedding model identifier</label><input id="embedding-model" value="${esc(s.model)}" placeholder="Your locally hosted embedding model"><label for="embedding-dimensions">Output dimensions</label><input id="embedding-dimensions" type="number" min="1" max="2000" value="${s.dimensions}" required><div class="help">Must match the model's actual output size (up to 2,000). Raazi validates a test embedding before saving.</div><label for="embedding-key">Embedding API key (optional)</label><input id="embedding-key" type="password" autocomplete="new-password" placeholder="${s.has_api_key?'Saved. Leave blank to keep it.':'Only if your embedding server requires authentication'}"><label><input id="embedding-clear" type="checkbox">Remove saved embedding key</label><p class="help">Changing the endpoint, model, or dimensions requires reindexing your documents in Knowledge. Clear both URL and model to use keyword search.</p><button class="primary" id="embedding-save">Test & save embedding settings</button></form>`;
   $('embedding-form').onsubmit=run(async e=>{
     e.preventDefault();const button=$('embedding-save');button.disabled=true;button.textContent='Testing connection…';
     try {await api('/api/admin/embedding-settings','PUT',{base_url:$('embedding-url').value,model:$('embedding-model').value,dimensions:Number($('embedding-dimensions').value),api_key:$('embedding-key').value,clear_api_key:$('embedding-clear').checked});await refreshAdmin();toast('Embedding settings saved. Reindex documents marked needs_reindex.');}
     catch(error){button.disabled=false;button.textContent='Test & save embedding settings';throw error;}
   });
 })();
}
