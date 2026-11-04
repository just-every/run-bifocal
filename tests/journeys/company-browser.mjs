import assert from 'node:assert/strict'

export async function proveCompanyBrowser(origin,page) {
 const read=async path=>{const response=await page.request.get(origin+'/api/operator'+path);assert.equal(response.status(),200);return response.json()}
 // Reach and operate every control using the same keys available to a person.
 const tabTo=async locator=>{
  for(let step=0;step<90;step++){
   if(await locator.evaluate(node=>node===document.activeElement))return
   await page.keyboard.press('Tab')
  }
  assert.fail('Control was unreachable by Tab: '+await locator.getAttribute('name'))
 }
 const enter=async(label,value)=>{
  const input=page.getByLabel(label,{exact:true});await tabTo(input)
  await page.keyboard.press('ControlOrMeta+A')
  if(value)await page.keyboard.insertText(value);else await page.keyboard.press('Backspace')
 }
 const choose=async(label,steps)=>{
  await tabTo(page.getByLabel(label,{exact:true}));await page.keyboard.press('Home')
  for(let index=0;index<steps;index++)await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Tab')
 }
 const submit=async name=>{await tabTo(page.getByRole('button',{name,exact:true}));await page.keyboard.press('Enter')}
 const saved=async text=>{await page.getByRole('status').filter({hasText:text}).waitFor();await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(button=>button.disabled))}
 const refused=async(form,name,help,text)=>{
  const input=page.locator('#'+form+' [name="'+name+'"]')
  await page.locator('#'+form+'-status[data-error=true]').waitFor()
  await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(button=>button.disabled))
  assert.equal(await input.getAttribute('aria-invalid'),'true')
  assert.ok(await input.evaluate(node=>node===document.activeElement),'first invalid field receives focus after pending controls re-enable')
  const ids=(await input.getAttribute('aria-describedby')).split(' ')
  assert.ok(ids.includes(help),'instructions remain associated with the field')
  assert.ok(ids.includes(form+'-'+name+'-error'))
  assert.match(await page.locator('#'+form+'-'+name+'-error').innerText(),text)
  // An error description is separate from the accessible field name.
  assert.equal(await input.evaluate(node=>node.closest('label').querySelector('.field-error')),null)
 }
 const misspeltZone=['America','New_Yrk'].join('/')
 const quotes=rate=>JSON.stringify([{currency:'EUR',date:'2026-06-19',rate}])
 const transactions=date=>JSON.stringify([{id:'synthetic-bifocal-60',amount:'100.00',currency:'EUR',date},{id:'synthetic-bifocal-61',amount:'100.00',currency:'USD',date}])
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/company')
  await page.getByRole('status').filter({hasText:'US conventions loaded'}).waitFor()
  const shot=async state=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),state+' overflow '+width);if(process.env.BIFOCAL_PROOF_DIR)await page.screenshot({path:process.env.BIFOCAL_PROOF_DIR+'/company-'+state+'-'+width+'.png',fullPage:true})}
  const companyBefore=await read('/company')
  await enter('Company name','Synthetic Bifocal Supply '+width)
  if(width===1440) {
   // Hold a real successful response to exercise focus recovery from pending.
   let resume,arrived
   const held=new Promise(resolve=>resume=resolve),started=new Promise(resolve=>arrived=resolve)
   await page.route('**/api/operator/company',async route=>{
    if(route.request().method()!=='PUT')return route.continue()
    const response=await route.fetch();arrived();await held;await route.fulfill({response})
   })
   await submit('Save company');await started
   assert.equal(await page.locator('#company-form').getAttribute('aria-busy'),'true')
   assert.equal(await page.getByRole('button',{name:'Save company',exact:true}).isDisabled(),true)
   await page.keyboard.press('Enter');resume()
   await saved('Company conventions saved');await page.unroute('**/api/operator/company')
   assert.ok(await page.getByRole('button',{name:'Save company',exact:true}).evaluate(node=>node===document.activeElement))
   const companySaved=await read('/company')
   assert.notEqual(companySaved.revision,companyBefore.revision)
   await enter('Company name',' ')
   await enter('Currency code','US')
   await submit('Save company')
   await refused('company-form','name','company-help',/Enter a value/)
   assert.equal(await page.getByLabel('Currency code',{exact:true}).getAttribute('aria-invalid'),'true')
   await page.keyboard.press('Tab')
   assert.ok(await page.getByLabel('Organization timezone',{exact:true}).evaluate(node=>node===document.activeElement),'natural focus order resumes at timezone')
   assert.deepEqual(await read('/company'),companySaved)
   await enter('Company name','Synthetic Bifocal Supply '+width)
   await enter('Currency code','USD')
   await enter('Organization timezone',misspeltZone)
   await submit('Save company')
   await refused('company-form','timezone','company-help',/known IANA time zone/)
   assert.equal(await page.getByLabel('Organization timezone',{exact:true}).inputValue(),misspeltZone)
   assert.deepEqual(await read('/company'),companySaved)
   await shot('company-errors')
   await enter('Organization timezone','America/New_York')
   await submit('Save company');await saved('Company conventions saved')
   assert.equal(await page.locator('#company-form [aria-invalid]').count(),0)
   assert.equal(await page.getByLabel('Organization timezone',{exact:true}).getAttribute('aria-describedby'),'company-help')
  } else {
   await enter('Organization timezone',misspeltZone);await submit('Save company')
   await page.locator('#company-form-status[data-error=true]').waitFor();await shot('company-errors')
   await enter('Organization timezone','America/New_York');await submit('Save company');await saved('Company conventions saved')
  }
  await shot('settings')
  const calendar='synthetic-bifocal-ui-july-'+width
  await enter('Calendar id',calendar);await enter('Calendar name','July fiscal')
  await enter('Start month','7');await enter('Fiscal start year','2023')
  await submit('Save calendar and inspect year');await saved('Calendar saved and year resolved')
  assert.match(await page.locator('#calendar-result').innerText(),/366/);assert.match(await page.locator('#calendar-result').innerText(),/2024-07-01/)
  const original=await read('/calendars/'+calendar+'/1')
  if(width===1440) {
   await enter('Start month','2');await enter('Start day','30')
   await submit('Save calendar and inspect year');await refused('calendar-form','day','calendar-help',/day that exists/)
   assert.deepEqual(await read('/calendars/'+calendar+'/1'),original)
   assert.equal((await read('/calendars/'+calendar)).versions.length,1)
   assert.equal(await page.getByLabel('Start day',{exact:true}).inputValue(),'30')
   await shot('fiscal-errors')
   await enter('Start day','1');await enter('Fiscal start year','1971')
   await submit('Save calendar and inspect year');await refused('calendar-form','year','calendar-help',/whole number/)
   assert.equal((await read('/calendars/'+calendar)).versions.length,1,'invalid inspection year never creates a saved revision')
   await enter('Fiscal start year','2023')
  } else {
   await enter('Start month','2');await enter('Start day','30');await submit('Save calendar and inspect year')
   await page.locator('#calendar-form-status[data-error=true]').waitFor();await shot('fiscal-errors')
   await enter('Start month','7');await enter('Start day','1')
  }
  await shot('july')
  await enter('Calendar id','synthetic-bifocal-ui-retail-'+width)
  await choose('Calendar type',1);await enter('Start month','2')
  await submit('Save calendar and inspect year');await saved('Calendar saved and year resolved')
  assert.match(await page.locator('#calendar-result').innerText(),/53/)
  await enter('Start date (MM/DD/YYYY)','07/02/2026');await enter('End date, exclusive (MM/DD/YYYY)','07/07/2026')
  await submit('Calculate working days');await saved('Holiday-adjusted measure calculated')
  assert.match(await page.locator('#working-result').innerText(),/2 working days/);assert.match(await page.locator('#working-result').innerText(),/Independence Day/)
  if(width===1440) {
   const workingText=await page.locator('#working-result').innerText()
   const days=await page.getByRole('table',{name:'Working-day calculation'}).locator('tbody tr').allTextContents()
   assert.deepEqual(days.map(row=>row.match(/Yes|No/)[0]),['Yes','No','No','No','Yes'],'Thursday and Monday work; observed Friday and weekend do not')
   await enter('Start date (MM/DD/YYYY)','02/30/2026')
   await submit('Calculate working days');await refused('working-form','start','working-help',/real date/)
   assert.equal(await page.locator('#working-result').innerText(),workingText)
   await enter('Start date (MM/DD/YYYY)','07/02/2026');await enter('End date, exclusive (MM/DD/YYYY)','07/01/2026')
   await submit('Calculate working days');await refused('working-form','end','working-help',/on or after the start/)
   assert.equal(await page.locator('#working-result').innerText(),workingText)
   await shot('working-errors')
   await enter('End date, exclusive (MM/DD/YYYY)','07/07/2026');await submit('Calculate working days');await saved('Holiday-adjusted measure calculated')
  } else {
   await enter('Start date (MM/DD/YYYY)','02/30/2026');await submit('Calculate working days')
   await page.locator('#working-form-status[data-error=true]').waitFor();await shot('working-errors')
   await enter('Start date (MM/DD/YYYY)','07/02/2026');await submit('Calculate working days');await saved('Holiday-adjusted measure calculated')
  }
  await shot('retail-holiday')
  const rateId='synthetic-bifocal-ui-rates-'+width
  await enter('Rate source id',rateId);await enter('Rate source name','Treasury reference')
  await enter('Rate use authorization','Owner supplied for internal use')
  await enter('Dated rates (JSON array)',quotes('0.8'))
  await submit('Save rate source');await saved('Named rate source saved')
  const rateOriginal=await read('/rates/'+rateId+'/1')
  if(width===1440) {
   for(const [value,expected] of [['[{"rate":]',/valid JSON array/],[quotes('1e-2'),/decimal string/],[JSON.stringify([...JSON.parse(quotes('0.8')),...JSON.parse(quotes('0.9'))]),/Remove duplicates/]]) {
    await enter('Dated rates (JSON array)',value);await submit('Save rate source')
    await refused('rates-form','rates','rates-help',expected)
    assert.equal(await page.getByLabel('Dated rates (JSON array)',{exact:true}).inputValue(),value)
    assert.deepEqual(await read('/rates/'+rateId+'/1'),rateOriginal)
    assert.equal((await read('/rates/'+rateId)).versions.length,1)
   }
   await shot('rate-errors')
   await enter('Dated rates (JSON array)',quotes('0.8'));await submit('Save rate source');await saved('Named rate source saved')
   assert.deepEqual(await read('/rates/'+rateId+'/1'),rateOriginal,'old named-rate revision is immutable after a new save')
  } else {
   for(const value of ['[{"rate":]',quotes('1e-2'),JSON.stringify([...JSON.parse(quotes('0.8')),...JSON.parse(quotes('0.9'))])]) {
    await enter('Dated rates (JSON array)',value);await submit('Save rate source')
    await page.locator('#rates-form-status[data-error=true]').waitFor()
   }
   await shot('rate-errors')
   await enter('Dated rates (JSON array)',quotes('0.8'));await submit('Save rate source');await saved('Named rate source saved')
  }
  await enter('Original transactions (JSON array)',transactions('2026-06-19'))
  await submit('Convert to USD');await saved('Exact USD conversion calculated')
  assert.match(await page.locator('#conversion-result').innerText(),/225\.00/);assert.match(await page.locator('#conversion-result').innerText(),/EUR/)
  const output=await page.locator('#conversion-result').innerText(),audit=await read('/conventions/audit')
  // Mobile smoke follows the same refused conversion and keyboard recovery.
  await enter('Original transactions (JSON array)',transactions('2026-06-20'))
  await submit('Convert to USD')
  if(width===1440) {
   await refused('conversion-form','transactions','conversion-help',/No exact EUR quote exists for 2026-06-20/)
   assert.equal(await page.locator('#conversion-result').innerText(),output,'refusal never relabels the previous result')
   assert.deepEqual(await read('/conventions/audit'),audit,'failed calculation writes no convention revision')
   assert.deepEqual(await read('/rates/'+rateId+'/1'),rateOriginal)
   assert.equal(await page.getByLabel('Original transactions (JSON array)',{exact:true}).inputValue(),transactions('2026-06-20'))
  } else await page.locator('#conversion-form-status[data-error=true]').waitFor()
  await shot('conversion-errors')
  await enter('Original transactions (JSON array)',transactions('2026-06-19'))
  await submit('Convert to USD');await saved('Exact USD conversion calculated')
  if(width===1440) {
   const rows=await page.getByRole('table',{name:'Original and converted amounts'}).locator('tbody tr').allTextContents()
   assert.match(rows[0],/125\.00$/);assert.match(rows[1],/100\.00$/)
   assert.equal(await page.getByLabel('Original transactions (JSON array)',{exact:true}).getAttribute('aria-invalid'),null)
   for(const [form,heading,result] of [['company','US company',null],['calendar','Fiscal calendar','calendar'],['working','Holiday-adjusted working days','working'],['rates','Owner-imported currency rates','rates'],['conversion','Convert with an explicit rate and rounding policy','conversion']]) {
    assert.equal(await page.getByRole('form',{name:heading,exact:true}).count(),1)
    assert.equal(await page.locator('#'+form+'-form-status').getAttribute('role'),'status')
    assert.equal(await page.locator('#'+form+'-form').getAttribute('aria-describedby'),form+'-form-status')
    if(result)assert.equal(await page.getByRole('region',{name:heading,exact:true}).count(),1)
   }
  }
  const structure=await page.locator('main').ariaSnapshot()
  assert.match(structure,/heading "Company conventions"/);assert.match(structure,/button "Convert to USD"/)
  await shot('currency')
  // The existing shared Settings control is the screen's only icon-only control.
  const settings=page.locator('.topbar .menu > summary')
  await tabTo(settings)
  await page.getByRole('tooltip',{name:'Open settings',exact:true}).waitFor({state:'visible'})
 }
 console.log('Company browser: keyboard company, fiscal, working-day, rate and conversion recovery; unchanged refused revisions; independent holiday and USD results; 1440 assertions and 390 smoke passed')
}
