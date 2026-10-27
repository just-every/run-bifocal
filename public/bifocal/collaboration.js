import { when } from './format.js'
const base='/api/operator/collaboration',{collaborationKind:kind,collaborationId:id,collaborationRows:rowCount,sharedLink:shared,zone}=document.body.dataset
const byId=id=>document.getElementById(id),status=byId('collaboration-status'),rows=rowCount?Number(rowCount):null
let current
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node}
// A refusal keeps its code as data; the page only ever shows the plain sentence for it.
class Refused extends Error{constructor(code,status){super(code);this.code=code;this.status=status}}
async function call(path,data){const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Refused(result.error??'collaboration_changed',response.status);return result}
function link(text,href){const node=element('a',text);node.href=href;return node}
// One quiet line under a row: its parts joined by dots that travel with the part after them, and the app's dates.
function meta(...parts){const line=element('p',undefined,'row-meta');parts.filter(Boolean).forEach((part,i)=>{if(i)line.append(' · ');line.append(part)});return line}
function time(value){const node=element('time',when(value,zone));node.dateTime=value;return node}
const day=value=>new Date(value+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
const person=id=>current.members.find(p=>p.id===id)
// A list reads as rows; when it is empty, one plain line stands in for it.
function rowsOf(list,items,empty){list.replaceChildren(...items);list.hidden=!items.length;if(empty)byId(empty).hidden=!!items.length}
function comment(item){const li=element('li'),mentioned=(item.mentions??[]).map(person).filter(Boolean).map(p=>p.displayName);li.append(element('p',person(item.authorId)?.displayName??'Former participant','thread-author'),element('p',item.body,'thread-body'),meta(item.point===null?'':'Data point '+(item.point+1),time(item.createdAt),mentioned.length?'Mentioned '+mentioned.join(', '):''));return li}
// A link row reads as a thread row inside the card's padding: the link, one quiet line (its expiry stamp kept whole),
// then its action.
function shareLink(item){
 const li=element('li'),record=element('div',undefined,'record'),inactive=item.revoked||Date.parse(item.expiresAt)<=Date.now(),expires=element('span',undefined,'nowrap');expires.append('Expires ',time(item.expiresAt))
 record.append(link('Open authenticated link','/app/shared/'+item.id),meta('For '+(person(item.recipientId)?.displayName??'a former recipient'),inactive?'Inactive':expires));li.append(record)
 if(!inactive){const button=element('button','Revoke link');button.type='button';button.addEventListener('click',()=>act(byId('collaboration-link'),async()=>{await call('/links/'+item.id+'/revoke',{});await load()}));li.append(button)}
 return li
}
async function load(){
 if(shared)await call('/links/'+shared)
 if(kind){
  current=await call('/resolve',{kind,id});byId('collaboration-title').textContent=current.subject.title.replaceAll(' · ',' · ');byId('collaboration-source').href=current.subject.href
  for(const [selector,blank] of [['#collaboration-comment select',true],['#collaboration-link select',false]]){const select=document.querySelector(selector),chosen=select.value;select.replaceChildren();if(blank){const option=element('option','No mention');option.value='';select.append(option)}for(const member of current.members){const option=element('option',member.displayName);option.value=member.id;select.append(option)}if([...select.options].some(option=>option.value===chosen))select.value=chosen}
  // A saved dashboard holds one retained answer: its rows are named as the dashboard's own.
  const holder=kind==='dashboard'?'this dashboard':'this answer'
  if(rows!==null)byId('comment-point-hint').textContent=rows===1?`Optional. ${holder[0].toUpperCase()+holder.slice(1)} has 1 row; enter 1 to comment on it.`:`Optional. Enter a row of ${holder}, 1 to ${rows}.`
  rowsOf(byId('collaboration-comments'),current.comments.map(comment),'collaboration-comments-empty')
  byId('collaboration-annotations-panel').hidden=!current.metric
  if(current.metric){byId('collaboration-metric-version').textContent='Certified revision '+current.metric.revision+' of '+current.metric.id;rowsOf(byId('collaboration-annotations'),current.annotations.map(item=>{const li=element('li');li.append(element('p',item.body,'thread-body'),meta(day(item.point)));return li}),'collaboration-annotations-empty');byId('collaboration-annotation').hidden=kind!=='metric'}
  rowsOf(byId('collaboration-links'),current.links.map(shareLink));byId('collaboration-content').hidden=false
 }
 const inbox=await call('/notifications')
 rowsOf(byId('collaboration-notifications'),inbox.notifications.map(item=>{const li=element('li');li.append(link('Open permitted mention',item.href),meta(time(item.createdAt)));return li}),'collaboration-notifications-empty')
 // Routine access checks stay in the live region for screen readers only; an error is shown where it happened.
 status.textContent='Current access checked.';status.setAttribute('role','status');delete status.dataset.error;status.dataset.quiet='true'
}
// The field a refusal concerns and its plain sentence, per form. Anything unmatched is said once at the top of the form.
function explain(form,error){
 const code=error.code
 if(form.id==='collaboration-comment'){
  const holder=kind==='dashboard'?'This dashboard':'This answer'
  if(code==='comment_point_not_found')return ['point',rows===null?'Data points name a row of a single answer. Leave Data point empty.':rows===1?`${holder} has 1 row. Enter 1, or leave Data point empty.`:`${holder} has ${rows} rows. Enter 1 to ${rows}, or leave Data point empty.`]
  if(code==='nonempty_text_required')return ['body','Write a comment before posting it.']
  if(code==='mention_recipients_required')return ['mention','Choose one member to mention, or No mention.']
  if(code==='collaboration_recipient_not_permitted')return ['mention','That member can no longer open this analysis, so they can’t be mentioned. Choose someone else, or No mention.']
  if(code==='collaboration_history_limit')return [null,'This discussion has reached 100 comments, so no more can be added.']
  return [null,'Your access to this analysis changed, so the comment wasn’t posted. Reload the page to see what you can do now.']
 }
 if(form.id==='collaboration-link'){
  if(code==='link_expiry_required')return ['minutes','Enter how long the link stays open: 1 to 10,080 minutes (one week).']
  if(code==='collaboration_recipient_not_permitted')return ['recipientId','That member can no longer open this analysis. Choose someone who can.']
  if(code==='collaboration_history_limit')return [null,'This analysis has 100 links already, so no more can be made.']
  return [null,'Your access to this analysis changed, so the link wasn’t changed. Reload the page, then try again.']
 }
 if(code==='annotation_date_required')return ['point','Enter the full date this annotation explains.']
 if(code==='nonempty_text_required')return ['body','Write the annotation before saving it.']
 if(code==='certified_metric_changed')return [null,'A newer certified revision of this metric exists. Reload the page to annotate the current revision.']
 if(code==='owner_required')return [null,'Only the owner can annotate a certified metric.']
 if(code==='annotation_history_limit')return [null,'This revision has 100 annotations, so no more can be added.']
 return [null,'Your access to this metric changed, so the annotation wasn’t saved. Reload the page, then try again.']
}
function clear(form){
 form.querySelector('.form-error')?.remove()
 for(const field of form.querySelectorAll('[aria-invalid]')){field.removeAttribute('aria-invalid');const note=byId(field.id+'-error');note?.remove();const rest=(field.getAttribute('aria-describedby')??'').split(' ').filter(ref=>ref&&ref!==field.id+'-error').join(' ');rest?field.setAttribute('aria-describedby',rest):field.removeAttribute('aria-describedby')}
}
// A refused submit keeps everything typed: the sentence goes beside the field, which is marked, described and focused.
function refuse(form,error){
 const [name,sentence]=explain(form,error),field=name&&form.elements[name]
 if(field&&!field.closest('[hidden]')){
  const note=element('p',sentence,'field-error');note.id=field.id+'-error';field.closest('.control').append(note)
  field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',[field.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '));field.focus()
 }else{const note=element('p',sentence,'status form-error');note.dataset.error='true';note.setAttribute('role','alert');form.prepend(note)}
}
async function act(form,work){clear(form);try{await work()}catch(error){if(!(error instanceof Refused))throw error;refuse(form,error)}}
function submit(formId,send){byId(formId)?.addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;act(form,async()=>{await send(new FormData(form));form.reset();await load()})})}
submit('collaboration-comment',data=>{const point=String(data.get('point')??'').trim();return call('/comments',{kind,id,body:data.get('body'),point:point?Number(point)-1:null,mentions:data.get('mention')?[data.get('mention')]:[]})})
submit('collaboration-link',data=>{const minutes=Number(data.get('minutes'));if(!Number.isSafeInteger(minutes)||minutes<1||minutes>10080)throw new Refused('link_expiry_required',400);return call('/links',{kind,id,recipientId:data.get('recipientId'),expiresAt:new Date(Date.now()+minutes*60000).toISOString(),public:false})})
submit('collaboration-annotation',data=>call('/annotations',{metricId:current.metric.id,revision:current.metric.revision,body:data.get('body'),point:data.get('point')}))
try{await load()}catch(error){status.textContent=error instanceof Refused?'Your access to this discussion changed. Reload the page, or return to the original.':'This discussion couldn’t be loaded. Reload the page.';status.setAttribute('role','alert');status.dataset.error='true'}
