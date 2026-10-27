// The shared frame becomes icon-only on phones. These bounded screens install
// the same keyboard and delayed-pointer explanation without changing navigation.
export function approvalTooltips(){
 const control=document.querySelector('.menu > summary')
 if(!control||control.querySelector('[role="tooltip"]'))return
 const tip=document.createElement('span');tip.id='approval-settings-tooltip';tip.role='tooltip';tip.textContent='Open settings';tip.hidden=true
 control.removeAttribute('title');control.setAttribute('aria-label','Settings');control.setAttribute('aria-describedby',tip.id);control.append(tip)
 let timer
 const hide=()=>{clearTimeout(timer);tip.hidden=true}
 control.addEventListener('mouseenter',()=>{clearTimeout(timer);timer=setTimeout(()=>{tip.hidden=false},300)})
 control.addEventListener('mouseleave',hide)
 control.addEventListener('focus',()=>{clearTimeout(timer);tip.hidden=false})
 control.addEventListener('blur',hide)
 control.addEventListener('click',hide)
 control.addEventListener('keydown',event=>{if(event.key==='Escape')hide()})
}
