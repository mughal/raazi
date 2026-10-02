'use strict';
const root = document.getElementById('app');
let auth, workspace, admin, view = 'chat', tab = 'models', conversationId = '', messages = [], busy = false, selectedRepository = '', activeGroupId = null, searchQuery = '', sidebarHidden = false, mobileSidebar = false, chatDraft = '';
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
function icon(name) {
 const paths={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
  chat:'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/>',
  book:'<rect x="3" y="4" width="6" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m16 5 4-1 3 15-4 1z"/>',
  settings:'<path d="m12 3 2 3 3-.2.2 3 3 2-3 2-.2 3-3-.2-2 3-2-3-3 .2-.2-3-3-2 3-2 .2-3 3 .2z"/><circle cx="12" cy="11" r="3"/>',
  edit:'<path d="M12 20H4a1 1 0 0 1-1-1v-8M15 4l5 5M8 16l1-5L18 2l5 5-9 9z"/>',
  search:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  pin:'<path d="m8 3 8 0-1 6 3 4v2H6v-2l3-4zM12 15v7"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>'
 };
 return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.chat}</svg>`;
}
function navButton(id, symbol, label) { return `<button data-view="${id}" class="${view === id ? 'active' : ''}">${icon(symbol)}<span>${label}</span></button>`; }
function chatRow(c,nested=false) {
 return `<div class="history-row ${conversationId===c.id && view==='chat'?'selected':''} ${nested?'nested':''}"><button data-chat="${esc(c.id)}" class="chat-link" title="${esc(c.title)}" ${conversationId===c.id?'aria-current="page"':''}>${nested?'':icon('chat')}<span>${esc(c.title)}</span></button><button data-chat-menu="${esc(c.id)}" class="row-menu" aria-label="Options for ${esc(c.title)}">${icon('more')}</button></div>`;
}
function historyMarkup() {
 const query=searchQuery.trim().toLocaleLowerCase();
 const chats=workspace.conversations.filter(c=>!query || c.title.toLocaleLowerCase().includes(query));
 const pinned=chats.filter(c=>c.pinned);
 let html=`<section class="history-section"><div class="section-label">Pinned</div>${pinned.map(c=>chatRow(c)).join('')||'<p class="sidebar-hint">Pin a chat for quick access.</p>'}</section>`;
 html+=`<section class="history-section"><div class="section-heading"><span class="section-label">Groups</span><button id="add-group" class="icon-button" aria-label="Create chat group" title="Create chat group">${icon('plus')}</button></div>`;
 for(const group of workspace.groups||[]) {
   const children=chats.filter(c=>c.group_id===group.id);
   if(query && !children.length && !group.name.toLocaleLowerCase().includes(query))continue;
   const expanded=!group.collapsed || !!query;
   html+=`<div class="folder-row ${activeGroupId===group.id?'current-folder':''}"><button class="folder-toggle" data-toggle-group="${esc(group.id)}" aria-expanded="${expanded}"><span class="folder-chevron ${expanded?'expanded':''}">${icon('chevron')}</span>${icon('folder')}<span>${esc(group.name)}</span><small>${children.length}</small></button><button data-group-menu="${esc(group.id)}" class="row-menu" aria-label="Options for group ${esc(group.name)}">${icon('more')}</button></div>${expanded?`<div class="folder-children">${children.map(c=>chatRow(c,true)).join('')||'<p class="sidebar-hint nested">No chats yet</p>'}</div>`:''}`;
 }
 if(!(workspace.groups||[]).length)html+='<p class="sidebar-hint">Keep related conversations together.</p>';
 html+='</section><section class="history-section">';
 const ungrouped=chats.filter(c=>!c.group_id && !c.pinned), buckets=new Map();
 for(const c of ungrouped){const age=(new Date().setHours(0,0,0,0)-new Date(c.updated_at||c.created_at).setHours(0,0,0,0))/86400000;const label=age<=0?'Today':age<=1?'Yesterday':age<7?'Previous 7 days':age<30?'Previous 30 days':'Older';if(!buckets.has(label))buckets.set(label,[]);buckets.get(label).push(c);}
 for(const [label,rows] of buckets)html+=`<div class="section-label">${label}</div>${rows.map(c=>chatRow(c)).join('')}`;
 if(!chats.length)html+=`<p class="sidebar-hint">${query?'No conversations match your search.':'Your conversations will appear here.'}</p>`;
 return html+'</section>';
}
function render() {
 const scroll=document.querySelector('.sidebar-scroll')?.scrollTop||0;
 const current=workspace.conversations.find(c=>c.id===conversationId);
 const group=(workspace.groups||[]).find(g=>g.id===(current?.group_id||activeGroupId));
 root.innerHTML=`<div class="layout ${sidebarHidden?'sidebar-collapsed':''} ${mobileSidebar?'mobile-open':''}"><nav class="rail" aria-label="Workspace navigation"><button class="rail-home ${view==='chat'?'active':''}" data-view="chat" aria-label="Open workspace" title="Workspace">${icon('home')}</button><button id="rail-new" aria-label="Start a new chat" title="New chat">${icon('edit')}</button><button data-view="knowledge" aria-label="Open knowledge library" title="Knowledge">${icon('book')}</button>${auth.user.role==='admin'?`<button data-view="admin" aria-label="Open admin settings" title="Admin console">${icon('settings')}</button>`:''}<div class="rail-spacer"></div><button data-view="profile" aria-label="Open your profile" title="Your profile"><span class="avatar">${esc(auth.user.name.slice(0,2).toUpperCase())}</span></button></nav><aside class="sidebar" aria-label="Chat history"><div class="sidebar-header"><button class="workspace-brand" data-view="chat"><span class="brand-mark">✳</span>Raazi<span class="workspace-caption">WORKSPACE</span></button><button id="collapse-sidebar" class="icon-button" aria-label="Hide chat history" title="Hide chat history">${icon('panel')}</button></div><button class="new-chat" id="new-chat">${icon('edit')}<span>New conversation</span></button><div class="sidebar-search">${icon('search')}<input id="chat-search" type="search" placeholder="Search chats" aria-label="Search chats" value="${esc(searchQuery)}" autocomplete="off"><kbd>⌘ K</kbd></div><nav class="nav" aria-label="Workspace pages">${navButton('knowledge','book','Knowledge library')}${auth.user.role==='admin'?navButton('admin','settings','Admin console'):''}</nav><div class="sidebar-scroll" id="history">${historyMarkup()}</div><div class="sidebar-bottom"><span class="privacy-dot"></span><span>Only you can see your chats</span></div></aside><button id="sidebar-backdrop" class="sidebar-backdrop" aria-label="Close chat history"></button><main class="main"><header class="topbar"><div class="topbar-title"><button id="open-sidebar" class="icon-button" aria-label="Show chat history" title="Show chat history">${icon('panel')}</button><div><strong>${view==='chat'?esc(current?.title||'New conversation'):({knowledge:'Knowledge library',admin:'Admin console',profile:'Your profile'})[view]}</strong><span class="topbar-context">${view==='chat'?(group?esc(group.name)+' / ':'')+esc(workspace.model||'Choose a model in settings'):'Raazi enterprise workspace'}</span></div></div><span class="badge"><span class="dot">●</span>${auth.development?'Development':'Enterprise'}</span></header><div id="content"></div></main></div><dialog id="workspace-dialog" aria-labelledby="dialog-title"></dialog>`;
 bindShell();document.querySelector('.sidebar-scroll').scrollTop=scroll;
 if(view==='chat')renderChat();if(view==='knowledge')renderKnowledge();if(view==='profile')renderProfile();if(view==='admin')renderAdmin();
}
function startChat(groupId=null){if(busy)return;view='chat';conversationId='';messages=[];selectedRepository='';chatDraft='';activeGroupId=groupId;mobileSidebar=false;render();$('prompt')?.focus();}
function syncSidebar(){const layout=document.querySelector('.layout');layout?.classList.toggle('sidebar-collapsed',sidebarHidden);layout?.classList.toggle('mobile-open',mobileSidebar);}
function bindShell() {
 document.querySelectorAll('[data-view]').forEach(el=>el.onclick=run(async()=>{if(busy)return;view=el.dataset.view;mobileSidebar=false;if(view==='admin')admin=await api('/api/admin');render();}));
 $('new-chat').onclick=()=>startChat();$('rail-new').onclick=()=>startChat();
 $('collapse-sidebar').onclick=()=>{if(matchMedia('(max-width: 760px)').matches)mobileSidebar=false;else sidebarHidden=true;syncSidebar();};
 $('open-sidebar').onclick=()=>{sidebarHidden=false;mobileSidebar=!mobileSidebar;syncSidebar();};
 $('sidebar-backdrop').onclick=()=>{mobileSidebar=false;syncSidebar();};
 $('chat-search').oninput=e=>{searchQuery=e.target.value;const scroll=document.querySelector('.sidebar-scroll').scrollTop;$('history').innerHTML=historyMarkup();bindHistory();document.querySelector('.sidebar-scroll').scrollTop=scroll;};
 bindHistory();
}
function bindHistory(){
 document.querySelectorAll('[data-chat]').forEach(el=>el.onclick=run(async()=>{if(busy)return;conversationId=el.dataset.chat;messages=await api('/api/conversations/'+conversationId);chatDraft='';activeGroupId=workspace.conversations.find(c=>c.id===conversationId)?.group_id||null;mobileSidebar=false;view='chat';render();}));
 document.querySelectorAll('[data-chat-menu]').forEach(el=>el.onclick=()=>{if(!busy)chatDialog(el.dataset.chatMenu);});
 document.querySelectorAll('[data-group-menu]').forEach(el=>el.onclick=()=>{if(!busy)groupDialog(el.dataset.groupMenu);});
 document.querySelectorAll('[data-toggle-group]').forEach(el=>el.onclick=run(async()=>{if(busy)return;const group=workspace.groups.find(g=>g.id===el.dataset.toggleGroup);await api('/api/chat-groups/'+group.id,'PATCH',{collapsed:!group.collapsed});workspace=await api('/api/workspace');render();}));
 if($('add-group'))$('add-group').onclick=()=>{if(!busy)groupDialog();};
}
function openDialog(title,markup){
 const dialog=$('workspace-dialog');dialog.innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button id="close-dialog" class="icon-button" aria-label="Close dialog">${icon('close')}</button></div>${markup}<p id="dialog-error" class="form-error" role="alert"></p>`;
 $('close-dialog').onclick=()=>dialog.close();dialog.onclick=e=>{if(e.target===dialog){const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();}};dialog.showModal();
 return dialog;
}
function dialogAction(fn){return async e=>{e?.preventDefault();const buttons=$('workspace-dialog').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await fn();}catch(error){if($('dialog-error'))$('dialog-error').textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}};}
function groupDialog(id){
 const group=workspace.groups.find(g=>g.id===id);
 openDialog(group?'Manage group':'Create chat group',`<form id="group-form"><p class="dialog-description">Keep related conversations together in your sidebar.</p><label for="group-name">Group name</label><input id="group-name" maxlength="100" required value="${esc(group?.name||'')}" placeholder="e.g. Research, HR, Project Raazi" autofocus><div class="dialog-actions">${group?'<button id="group-new-chat" type="button">New chat in group</button>':'<button id="cancel-group" type="button">Cancel</button>'}<button class="primary">${group?'Save changes':'Create group'}</button></div></form>${group?'<div class="dialog-danger-zone"><button id="delete-group" class="danger">Delete group</button><small>Chats will move back to History.</small></div>':''}`);
 $('group-form').onsubmit=dialogAction(async()=>{await api(group?'/api/chat-groups/'+group.id:'/api/chat-groups',group?'PATCH':'POST',{name:$('group-name').value});workspace=await api('/api/workspace');render();toast(group?'Group updated':'Chat group created');});
 if(group){$('group-new-chat').onclick=()=>startChat(group.id);$('delete-group').onclick=dialogAction(async()=>{if(!confirm('Delete this group? Your chats will remain in History.'))return;await api('/api/chat-groups/'+group.id,'DELETE');if(activeGroupId===group.id)activeGroupId=null;workspace=await api('/api/workspace');render();toast('Group removed. Chats kept in History.');});}
 else $('cancel-group').onclick=()=>$('workspace-dialog').close();
}
function chatDialog(id){
 const chat=workspace.conversations.find(c=>c.id===id);if(!chat)return;
 openDialog('Conversation settings',`<form id="conversation-form"><label for="conversation-title">Name</label><input id="conversation-title" value="${esc(chat.title)}" maxlength="200" required autofocus><label for="conversation-group">Move to group</label><select id="conversation-group"><option value="">Ungrouped / History</option>${workspace.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select><label class="checkbox-label"><input id="conversation-pinned" type="checkbox" ${chat.pinned?'checked':''}>Pin to sidebar</label><div class="dialog-actions"><button id="cancel-conversation" type="button">Cancel</button><button class="primary">Save changes</button></div></form><div class="dialog-danger-zone"><button id="remove-conversation" class="danger">Delete conversation</button></div>`);
 $('conversation-group').value=chat.group_id||'';
 $('cancel-conversation').onclick=()=>$('workspace-dialog').close();
 $('conversation-form').onsubmit=dialogAction(async()=>{await api('/api/conversations/'+id,'PATCH',{title:$('conversation-title').value,group_id:$('conversation-group').value||null,pinned:$('conversation-pinned').checked});workspace=await api('/api/workspace');if(conversationId===id)activeGroupId=workspace.conversations.find(c=>c.id===id)?.group_id||null;render();toast('Conversation updated');});
 $('remove-conversation').onclick=dialogAction(async()=>{if(!confirm('Delete this conversation permanently?'))return;await api('/api/conversations/'+id,'DELETE');if(conversationId===id){conversationId='';messages=[];}workspace=await api('/api/workspace');render();toast('Conversation deleted');});
}
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&auth?.user){e.preventDefault();sidebarHidden=false;mobileSidebar=true;syncSidebar();$('chat-search').focus();}if(e.key==='Escape'&&mobileSidebar){mobileSidebar=false;document.querySelector('.layout')?.classList.remove('mobile-open');}});
function renderChat() {
  $('content').className='chat-wrap';
  $('content').innerHTML = `${messages.length ? `<div class="chat-actions"><button id="chat-options" class="text-button">${icon("more")} Conversation options</button></div><div class="messages">${messages.map(m => `<article class="message ${m.role==='user'?'user':''}"><div class="author">${m.role==='user'?'You':'✳ Raazi'}</div><div class="text">${answerMarkup(m.content,m.sources)}</div>${sourceMarkup(m.sources)}</article>`).join('')}</div>` : `<section class="welcome"><div class="spark">✳</div><div class="eyebrow">Your private enterprise assistant</div><h1>How can I help today?</h1><p class="subtitle">Find answers in your organization’s knowledge.<br>Pick up a conversation or start something new.</p><div class="suggestions"><button class="suggestion" data-prompt="What are the key policies I should know in my role?"><span class="icon">▧</span><strong>Find an answer</strong><small>Make sense of your internal knowledge.</small></button><button class="suggestion" data-prompt="Help me draft a clear project update for my team."><span class="icon">✎</span><strong>Start something good</strong><small>A first draft, a fresh angle, a little momentum.</small></button><button class="suggestion" data-prompt="Help me create a step-by-step plan for my next project."><span class="icon">⌘</span><strong>Think it through</strong><small>Turn a complex task into a clear next step.</small></button></div></section>`}<form id="chat-form" class="composer"><textarea id="prompt" aria-label="Message Raazi" maxlength="16000" placeholder="What would you like to explore?" required ${busy?'disabled':''}></textarea><div class="composer-footer"><select id="repo-select" aria-label="Knowledge repository"><option value="">▧ &nbsp; All accessible knowledge</option>${workspace.repositories.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><button class="primary send" id="send" aria-label="Send message" ${busy?'disabled':''}>${busy?'…':'↑'}</button></div></form><p class="footnote">${workspace.model ? 'Powered by '+esc(workspace.model)+'. ' : 'Configure a local model in Admin console to get started. '}AI can make mistakes. Check important details.</p>`;
  document.querySelectorAll('[data-prompt]').forEach(el=>el.onclick=()=>{ $('prompt').value=el.dataset.prompt;chatDraft=el.dataset.prompt; $('prompt').focus(); });
  $('repo-select').value=selectedRepository;
  $('repo-select').onchange=()=>{selectedRepository=$('repo-select').value;};
  $('prompt').value=chatDraft;
  $('prompt').oninput=()=>{chatDraft=$('prompt').value;};
  $('prompt').onkeydown = e => { if(e.key==='Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chat-form').requestSubmit(); } };
  $('chat-form').onsubmit = run(async e => {
    e.preventDefault(); if(busy) return;
    const message=$('prompt').value.trim(), selected=$('repo-select').value;
    if(!message) return;
    busy=true; $('send').disabled=true; $('send').textContent='…'; $('prompt').disabled=true;
    try {
      const result=await api('/api/chat','POST',{message,conversation_id:conversationId,group_id:activeGroupId,repository_id:selected?Number(selected):null});
      conversationId=result.conversation_id; chatDraft=''; messages.push({role:'user',content:message},{role:'assistant',content:result.content,sources:result.sources});
      workspace=await api('/api/workspace');
    } catch(error) { busy=false; render(); $('prompt').value=message; throw error; }
    busy=false; render();
  });
  if($('chat-options'))$('chat-options').onclick=()=>{if(!busy)chatDialog(conversationId);};
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
  document.querySelectorAll('[data-repo]').forEach(el=>el.onclick=()=>{ view='chat';conversationId='';messages=[];activeGroupId=null;selectedRepository=el.dataset.repo;render();$('repo-select').value=el.dataset.repo;$('prompt').focus(); });
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
