const $=id=>document.getElementById(id),status=$('status'),id=document.body.dataset.id,reader=document.body.dataset.reader==='true'
let current=null,choices=[],review=null
const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element}
const message=text=>{status.textContent=text}
async function api(path='',data,method=data===undefined?'GET':'POST'){
 const response=await fetch('/api/operator/apps'+path,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})})
 const result=await response.json();if(!response.ok)throw Error(result.reason??result.error);return result
}
const action=fn=>async()=>{try{await fn()}catch(error){message(error.message)}}
const clearReview=()=>{review=null;$('review-content').replaceChildren();$('consent').checked=false;$('consent').disabled=true;$('publish').disabled=true}
function itemRow(item){
 const row=node('fieldset'),legend=node('legend','Content item'),select=node('select'),label=node('input'),labelWrap=node('label','Navigation label'),choiceWrap=node('label','Existing content')
 select.required=true;select.setAttribute('aria-label','Existing content');for(const choice of choices){const option=node('option',choice.label+' · '+choice.kind);option.value=choice.kind+':'+choice.id;select.append(option)}
 if(item)select.value=item.kind+':'+item.id
 label.value=item?.label??choices[0]?.label??'';label.required=true;label.maxLength=160;label.setAttribute('aria-label','Navigation label')
 choiceWrap.append(select);labelWrap.append(label);row.append(legend,choiceWrap,labelWrap)
 for(const [text,move]of [['Move earlier',-1],['Move later',1],['Remove content',0]]){const button=node('button',text);button.type='button';button.onclick=()=>{if(!move)row.remove();else if(move<0&&row.previousElementSibling)row.previousElementSibling.before(row);else if(move>0&&row.nextElementSibling)row.nextElementSibling.after(row);clearReview()};row.append(button)}
 select.onchange=()=>{label.value=choices.find(c=>c.kind+':'+c.id===select.value)?.label??'';clearReview()};label.oninput=clearReview
 $('items').append(row)
}
function contentView(content){const box=node('div');box.append(node('h3',content.title));const list=node('ol');for(const item of content.items){const li=node('li'),a=node('a',item.label);a.href='/app/'+item.kind+'/'+item.id;li.append(a);list.append(li)}box.append(list);return box}
async function load(){
 const list=await api();$('app-list').replaceChildren();for(const app of list.apps){const a=node('a',app.title+(app.publishedVersion?' · published':' · draft'));a.href='/app/apps/'+app.id;$('app-list').append(a)}
 if(reader){const published=await api('/'+id+'/published');$('reader').hidden=false;$('reader').replaceChildren(contentView(published.content),node('p','Published version '+published.ordinal));message('Published app loaded');return}
 $('editor').hidden=false;choices=(await api('/content')).items
 $('items').replaceChildren();$('versions').replaceChildren();$('history').replaceChildren();clearReview()
 if(id){current=await api('/'+id);$('app-title').value=current.draft?.title??'';for(const item of current.draft?.items??[])itemRow(item)
  if(current.publishedVersion){const link=node('a','Open published app');link.href='/app/apps/'+id+'/published';$('versions').append(link)}
  for(const version of current.versions){const section=node('section');section.append(node('h3','Version '+version.ordinal),contentView(version.content));const button=node('button','Restore version '+version.ordinal);button.type='button';button.onclick=()=>{clearReview();$('review-content').replaceChildren(contentView(version.content),node('p','Restore published version '+version.ordinal+'. The unpublished draft stays separate.'));review={generation:current.generation,reviewedDigest:version.digest,versionId:version.id};$('consent').disabled=false;message('Review rollback, then confirm publication')};section.append(button);$('versions').append(section)}
  const history=node('ol');for(const event of current.history)history.append(node('li',event.action+' · revision '+event.generation+' · '+event.created_at+(event.version_id?'':' · no retained version')));$('history').append(history)
 }else if(choices.length)itemRow()
 $('review').disabled=!id||!current?.draft;message(choices.length?'Draft ready. Published readers keep their last reviewed version.':'No content yet. Create an exact answer before packaging an app.')
}
$('add-item').onclick=()=>{if($('items').children.length<20&&choices.length){itemRow();clearReview()}}
$('app-title').oninput=clearReview
$('draft-form').onsubmit=event=>{event.preventDefault();action(async()=>{const items=[...$('items').children].map(row=>{const [kind,itemId]=row.querySelector('select').value.split(':');return {kind,id:itemId,label:row.querySelector('input').value}});const result=await api(id?'/'+id:'',{title:$('app-title').value,items,...(id?{generation:current.generation}:{})},id?'PUT':'POST');location.href='/app/apps/'+result.id})()}
$('review').onclick=action(async()=>{clearReview();const result=await api('/'+id+'/review');review={generation:result.generation,reviewedDigest:result.digest};$('review-content').replaceChildren(contentView(result.content),node('p','Exact review fingerprint: '+result.digest));$('consent').disabled=false;message('Review the saved navigation and owner-only access')})
$('consent').onchange=()=>{$('publish').disabled=!$('consent').checked||!review}
$('publish').onclick=action(async()=>{if(!review||!$('consent').checked)return;await api('/'+id+(review.versionId?'/rollback':'/publish'),review);await load();message('Reviewed version published')})
action(load)()
