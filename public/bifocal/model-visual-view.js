import {element,metadata} from './file-view.js'

// Uploaded declarations remain evidence to review, never extension authority.
export function visualInventory(resources=[]){
 const visuals=resources.filter(resource=>resource.kind==='pbip-custom-visual'&&resource.definition.inventory)
 if(!visuals.length)return null
 const section=element('section',undefined,'model-visual-inventory');section.setAttribute('aria-label','Custom visual mappings')
 section.append(element('h3','Custom visual mappings'),element('p','Resolve each mapping, required behavior and publisher entitlement before report cutover. Imported code and network access remain inactive.'))
 const statuses={'requires-native-review':'Native review required',denied:'Denied',unsupported:'Rebuild required'}
 for(const [index,resource] of visuals.entries()){
  const inventory=resource.definition.inventory,details=element('details',undefined,'panel'),mapping=inventory.mapping
  details.open=index===0
  details.append(element('summary',(inventory.visualType??resource.name)+' · '+(inventory.version.value??'Version unknown')+' · '+statuses[mapping.status]))
  const publishers=inventory.publisher.declarations.map(value=>value.name),roles=Object.keys(inventory.dataRoles.bindings??{}),formatting=Object.keys(inventory.formatting.objects??{}),interactions=Object.entries(inventory.interactions.visual??{}).map(([name,value])=>name+': '+JSON.stringify(value))
  const licences=inventory.licence.requirements.map(value=>JSON.stringify(value.declaration))
  details.append(metadata([
   ['Source visual',resource.file],['Publisher',publishers.length?publishers.join(', '):'Unknown; supply publisher evidence'],
   ['Data roles',roles.length?roles.join(', '):'No role bindings declared'],['Formatting groups',formatting.length?formatting.join(', '):'No formatting declared'],
   ['Interactions',interactions.length?interactions.join('; '):'No interaction declarations'],
   ['Licence requirements',licences.length?licences.join('; '):'Unknown; publisher evidence required'],
   ['Entitlement','Not established; redistribution is not authorized'],['Native mapping',mapping.name],
   ['Required behavior',mapping.requiredBehavior.join(', ')],['Affected content',mapping.affectedDependents.join(', ')],['Imported execution','Inactive; no network or app-origin execution']
  ]))
  section.append(details)
 }
 return section
}
