const base='/api/operator/collaboration',kind=document.body.dataset.collaborationKind,id=document.body.dataset.collaborationId,shared=document.body.dataset.sharedLink
const byId=id=>document.getElementById(id),status=byId('collaboration-status')
let current
const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node}
async function call(path,data){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json();if(!response.ok)throw new Error(result.error??'Current access unavailable');return result}
function link(text,href){const node=element('a',text);node.href=href;return node}
async function load(){
 byId('collaboration-content')?.setAttribute('hidden','')
 if(shared)await call('/links/'+shared)
 if(kind){
  current=await call('/resolve',{kind,id});byId('collaboration-title').textContent=current.subject.title;byId('collaboration-source').href=current.subject.href
  for(const [selector,blank] of [['#collaboration-comment select',true],['#collaboration-link select',false]]){const select=document.querySelector(selector);select.replaceChildren();if(blank){const option=element('option','No mention');option.value='';select.append(option)}for(const person of current.members){const option=element('option',person.displayName);option.value=person.id;select.append(option)}}
  const comments=byId('collaboration-comments');comments.replaceChildren(...current.comments.map(comment=>{const li=element('li'),author=current.members.find(p=>p.id===comment.authorId);li.append(element('strong',author?.displayName??'Former participant'),element('p',comment.body),element('p',(comment.point===null?'Analysis':'Data point '+(comment.point+1))+' · '+comment.createdAt));for(const recipient of comment.mentions??[]){const person=current.members.find(p=>p.id===recipient);if(person)li.append(element('p','@'+person.displayName))}return li}));if(!current.comments.length)comments.append(element('li','No comments yet.'))
  byId('collaboration-annotations-panel').hidden=!current.metric
  if(current.metric){byId('collaboration-metric-version').textContent='Metric '+current.metric.id+' · certified revision '+current.metric.revision;byId('collaboration-annotations').replaceChildren(...current.annotations.map(item=>element('li',item.point+' · '+item.body)));byId('collaboration-annotation').hidden=kind!=='metric'}
  const list=byId('collaboration-links');list.replaceChildren(...current.links.map(item=>{const li=element('li'),inactive=item.revoked||Date.parse(item.expiresAt)<=Date.now();li.append(link('Open authenticated link','/app/shared/'+item.id),element('p',(inactive?'Inactive':'Expires '+item.expiresAt)+' · '+(current.members.find(p=>p.id===item.recipientId)?.displayName??'Former recipient')));if(!inactive){const button=element('button','Revoke link');button.type='button';button.addEventListener('click',()=>act(async()=>{await call('/links/'+item.id+'/revoke',{});await load()}));li.append(button)}return li}));byId('collaboration-content').hidden=false
 }
 const inbox=await call('/notifications');byId('collaboration-notifications').replaceChildren(...inbox.notifications.map(item=>{const li=element('li');li.append(link('Open permitted mention',item.href),element('p',item.createdAt));return li}));if(!inbox.notifications.length)byId('collaboration-notifications').append(element('li','No current mentions.'))
 status.textContent='Current access checked.'
}
async function act(action){try{await action()}catch(error){status.textContent=error.message;status.dataset.error='true'}}
byId('collaboration-comment')?.addEventListener('submit',event=>{event.preventDefault();act(async()=>{const form=event.currentTarget,data=new FormData(form);await call('/comments',{kind,id,body:data.get('body'),point:data.get('point')?Number(data.get('point'))-1:null,mentions:data.get('mention')?[data.get('mention')]:[]});form.reset();await load()})})
byId('collaboration-link')?.addEventListener('submit',event=>{event.preventDefault();act(async()=>{const data=new FormData(event.currentTarget);await call('/links',{kind,id,recipientId:data.get('recipientId'),expiresAt:new Date(Date.now()+Number(data.get('minutes'))*60000).toISOString(),public:false});await load()})})
byId('collaboration-annotation')?.addEventListener('submit',event=>{event.preventDefault();act(async()=>{const form=event.currentTarget,data=new FormData(form);await call('/annotations',{metricId:current.metric.id,revision:current.metric.revision,body:data.get('body'),point:data.get('point')});form.reset();await load()})})
await act(load)
