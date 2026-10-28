const form = document.querySelector('#cost-estimator')
const status = document.querySelector('#quote-status')
const result = document.querySelector('#quote-result')
const field = name => form.elements.namedItem(name)
const sourceNames = () => field('sources').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
let generation = 0
function clearQuote() {
 generation++
 result.hidden = true
 status.dataset.error = 'false'
 status.textContent = 'Inputs changed. Calculate again to review an updated estimate.'
 document.querySelector('#source-count').textContent = `Source count: ${sourceNames().length}`
}
form.addEventListener('input', clearQuote)
form.addEventListener('change', clearQuote)
function money(name) {
 const input = field(name), value = input.value.trim()
 if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw {input, message: 'Enter a nonnegative USD amount with at most six decimal places.'}
 const [whole, fraction = ''] = value.split('.')
 const micro = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
 if (micro > 1000000000000n) throw {input, message: 'This rate or licence amount exceeds the supported USD range.'}
 return Number(micro)
}
function required(name) {
 const input = field(name), value = input.value.trim()
 if (!value) throw {input, message: 'Enter the compute configuration, rate date and provenance before calculating.'}
 return value
}
function integer(name) {
 const input = field(name), value = input.value.trim()
 if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 1000000000) throw {input, message: 'Workload quantities must be whole, nonnegative numbers within the supported range.'}
 return Number(value)
}
const paragraph = text => { const p = document.createElement('p'); p.textContent = text; return p }
function render(quote) {
 document.querySelector('#quote-total').textContent = quote.totalUsd
 document.querySelector('#quote-context').textContent = `${quote.compute.provider} · ${quote.compute.size} · ${quote.compute.region}. ${quote.workload.sources.length} sources, ${quote.workload.refreshesPerSourceDaily} refreshes per source daily.`
 const comparison = document.querySelector('#quote-comparison')
 comparison.hidden = quote.fullComparisonUsd === null
 comparison.textContent = quote.fullComparisonUsd === null ? '' : `Full comparison: USD ${quote.fullComparisonUsd}, including USD ${quote.sourceLicencesUsd} source licences. Tax excluded.`
 const lines = quote.lines.map(line => {
  const section = document.createElement('section')
  section.className = 'panel quote-line'; section.dataset.line = line.id
  const heading = document.createElement('h3'); heading.textContent = line.label
  const amount = paragraph(`USD ${line.amountUsd}`); amount.className = 'quote-amount'
  const quantity = paragraph(`${line.quantity} ${line.unit} × USD ${(BigInt(line.microUsdPerUnit) / 1000000n).toString()}.${(BigInt(line.microUsdPerUnit) % 1000000n).toString().padStart(6,'0')} per unit`)
  quantity.dataset.quantity = String(line.quantity)
  section.append(heading, amount, quantity, paragraph(`Assumed quantity · owner-entered rate · ${line.rateDate}`), paragraph(line.derivation), paragraph(`Provenance: ${line.reference}`))
  try {
   const url = new URL(line.reference)
   if (['https:','http:'].includes(url.protocol) && !url.username && !url.password) {
    const link = document.createElement('a'); link.href = url.href; link.rel = 'noreferrer'; link.textContent = 'Open rate provenance'; section.append(link)
   }
  } catch {}
  return section
 })
 document.querySelector('#quote-lines').replaceChildren(...lines)
 document.querySelector('#quote-assumptions').replaceChildren(...quote.assumptions.map(text=>{const li=document.createElement('li');li.textContent=text;return li}))
 for (const key of ['rounding','uncertainty','productPricing','spending']) document.querySelector({'productPricing':'#quote-pricing',rounding:'#quote-rounding',uncertainty:'#quote-uncertainty',spending:'#quote-spending'}[key]).textContent = quote[key]
 result.hidden = false
}
form.addEventListener('submit', async event => {
 event.preventDefault()
 const current = ++generation
 result.hidden = true
 form.querySelectorAll('[aria-invalid]').forEach(input=>input.removeAttribute('aria-invalid'))
 try {
  const compute = Object.fromEntries(['provider','size','region'].map(key=>[key,required(key)]))
  const rateDate = required('rateDate'), reference = required('reference')
  const rates = Object.fromEntries([...form.querySelectorAll('[data-rate]')].map(section=>{
   const id = section.dataset.rate
   return [id,{microUsdPerUnit:money('rate-'+id),rateDate:field('date-'+id).value||rateDate,reference:field('reference-'+id).value.trim()||reference}]
  }))
  const workload = {sources:sourceNames()}
  for (const input of form.querySelectorAll('#workload input')) workload[input.name] = integer(input.name)
  const payload = {compute,rates,workload}
  if (field('includeLicences').checked) payload.sourceLicencesMicroUsd = money('licences')
  status.dataset.error = 'false'; status.textContent = 'Calculating assumed monthly usage…'
  const response = await fetch('/api/cost-reference',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(payload)})
  const quote = await response.json()
  if (current !== generation) return
  if (!response.ok) throw {message:`Estimate refused: ${quote.error}. Review the workload, dates and rates, then calculate again. No work was started.`}
  render(quote)
  status.textContent = 'Estimate calculated. All quantities are assumptions, not measured usage.'
  result.scrollIntoView({block:'start'})
 } catch (error) {
  if (current !== generation) return
  status.dataset.error = 'true'
  status.textContent = error.message || 'The estimate could not be calculated. Check your connection and inputs, then calculate again. No work was started.'
  if (error.input) {
   for (let parent=error.input.parentElement; parent; parent=parent.parentElement) if(parent.tagName==='DETAILS')parent.open=true
   error.input.setAttribute('aria-invalid','true'); error.input.focus()
  }
 }
})
