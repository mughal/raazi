'use strict';
(async()=>{
 const id=location.pathname.split('/').pop();
 try {
   const response=await fetch('/api/sources/'+encodeURIComponent(id));
   if(!response.ok)throw new Error('This source is unavailable, deleted, or no longer shared with your account. Sign in to the workspace and try again.');
   const source=await response.json();
   document.getElementById('source-title').textContent=source.title;
   document.getElementById('source-label').textContent=source.label;
   document.getElementById('source-excerpt').textContent=source.content;
   const link=document.getElementById('source-original');
   link.href='/api/sources/'+encodeURIComponent(id)+'/file'+(source.page?'#page='+source.page:'');link.hidden=false;
   link.textContent=source.mime==='application/pdf'?'Open PDF at page '+source.page+' ↗':'Download original document ↓';
   document.getElementById('source-help').textContent=source.mime==='application/pdf'?'Page numbers refer to the physical PDF page. Your browser’s PDF viewer opens the original at this page.':'This excerpt is identified by its section or paragraph. DOCX pagination depends on the Word layout and is not inferred.';
 }catch(error){document.getElementById('source-title').textContent='Source unavailable';document.getElementById('source-excerpt').textContent=error.message;}
})();
