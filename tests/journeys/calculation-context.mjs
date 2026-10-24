import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
const numeric=v=>v.type==='number'?Number(v.numerator)/Number(v.denominator):null
export async function proveCalculationContext({base,prepare,apply,call,origin,context,page,proveScreen}){
 const tmdl=`table Sales
    measure RevenueTotal = SUM('Sales'[revenue])
        formatString: #,##0.00
    measure DiscountedTotal = SUM('Sales'[revenue]) * SELECTEDVALUE('Discount'[Discount],1)
        formatString: #,##0.00
table Multipliers
    calculationGroup
        precedence: 10
        calculationItem TimesTwo = SELECTEDMEASURE() * 2
            formatString: 0.00
table Adjustments
    calculationGroup
        precedence: 20
        calculationItem AddOne = SELECTEDMEASURE() + 1
            formatString: $#,##0.00
table Axis = { ("Region", NAMEOF('Sales'[region]),0), ("Date", NAMEOF('Sales'[date]),1) }
table Discount = GENERATESERIES(0,2,0.1)
    column Discount
    measure DiscountValue = SELECTEDVALUE('Discount'[Discount],1)
`
 const input={...base,id:'synthetic-bifocal-source-groups',label:'Imported operating scenarios',calculations:[],groups:[],parameters:[],fieldParameters:[],window:undefined,source:{format:'tmdl',content:tmdl}}
 const library=await apply(input,await prepare(input));assert.equal(library.report.compatible,true,JSON.stringify(library.report));assert.equal(library.input.parameters[0].default.value,'1');assert.deepEqual(library.input.fieldParameters[0].choices,{Region:['region'],Date:['date']})
 const options={filters:[{field:'units',op:'gte',value:'2'}],groupBy:[],parameters:{discount:{kind:'literal',type:'number',value:'1.2'}},groups:['timestwo','addone'],fieldParameter:{id:'axis',choice:'Date'}}
 const source=JSON.parse(execFileSync('python3',['-c',`from fractions import Fraction as F
import json
v=F('10.01')+F('30.03')
print(json.dumps({'revenue':float(v*2+1),'discounted':float(v*F('1.2')*2+1),'reversed':float((v+1)*2)}))`],{encoding:'utf8'}))
 const answer=(await call('/calculations/'+input.id+'/run',{...options,revision:library.revision})).answer
 assert.equal(numeric(answer.totals.revenuetotal),source.revenue);assert.equal(numeric(answer.totals.discountedtotal),source.discounted);assert.equal(answer.formatted.totals.discountedtotal,'$97.10');assert.equal(answer.rows.length,2)
 const byRegion=(await call('/calculations/'+input.id+'/run',{...options,revision:library.revision,fieldParameter:{id:'axis',choice:'Region'}})).answer
 assert.equal(byRegion.rows.length,1);assert.deepEqual(byRegion.totals,answer.totals)
 await call('/calculations/'+input.id+'/run',{...options,revision:library.revision,parameters:{discount:{kind:'literal',type:'number',value:'1.25'}}},400)
 await call('/calculations/'+input.id+'/run',{...options,revision:library.revision,fieldParameter:{id:'axis',choice:'Unbound'}} ,403)
 const reversed={...input,id:'synthetic-bifocal-reversed-groups',source:{format:'tmdl',content:tmdl.replace('precedence: 10','precedence: 30')}},reverseLibrary=await apply(reversed,await prepare(reversed)),reverse=(await call('/calculations/'+reversed.id+'/run',{...options,revision:reverseLibrary.revision})).answer
 assert.equal(numeric(reverse.totals.revenuetotal),source.reversed);assert.equal(reverse.formats.revenuetotal,'0.00');assert.equal(reverse.formatted.totals.revenuetotal,'82.08')
 // Original textual workbook calculations retain story dependencies as visible
 // unresolved items until the story's native delivery mapping exists.
 const workbook={...base,id:'synthetic-bifocal-tableau-workbook',calculations:[],groups:[],parameters:[],fieldParameters:[],window:undefined,source:{format:'tableau',content:'<workbook><datasources><datasource name="Sales"><column name="[Calculation_1]" caption="RevenueTotal"><calculation class="tableau" formula="SUM([revenue])"/></column></datasource></datasources></workbook>'}}
 const workbookLibrary=await apply(workbook,await prepare(workbook));assert.equal(workbookLibrary.report.compatible,true,JSON.stringify(workbookLibrary.report));assert.equal(numeric((await call('/calculations/'+workbook.id+'/run',{revision:workbookLibrary.revision})).answer.totals.revenuetotal),36.04)
 const story={...workbook,id:'synthetic-bifocal-tableau-story',source:{format:'tableau',content:workbook.source.content.replace('</workbook>','<story name="Regional review"><story-point name="Revenue overview"/></story></workbook>')}},storyLibrary=await apply(story,await prepare(story));assert.equal(storyLibrary.report.compatible,false);assert.ok(storyLibrary.report.dependencies.some(d=>d.kind==='story'&&d.name==='Regional review'));assert.ok(storyLibrary.report.issues.some(i=>i.code==='tableau_dependencies_require_mapping'))
 await page.goto(origin+'/app/calculations');await page.getByRole('status').filter({hasText:'Choose a governed view'}).waitFor();const catalog=await call('/calculations'),index=catalog.views.findIndex(v=>v.modelId===base.modelId);await page.getByLabel('Governed view',{exact:true}).selectOption(String(index));await page.getByText('Migrate an original calculation library',{exact:true}).click()
 const browserInput={...input,id:'synthetic-bifocal-browser-groups'}
 await page.getByLabel('Original library JSON',{exact:true}).setInputFiles({name:'synthetic-bifocal-original-groups.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(browserInput))});await page.getByRole('button',{name:'Preview migration',exact:true}).click();await page.getByRole('status').filter({hasText:'Migration ready for exact plan approval'}).waitFor();await proveScreen('calculation-source-migration');await page.getByLabel('I approve this exact migration plan and its source translations').check();await page.getByRole('button',{name:'Apply and reconcile',exact:true}).click();await page.getByRole('status').filter({hasText:'Original calculation library imported and reconciled'}).waitFor();await proveScreen('calculation-source-imported');await page.getByText('Filters and evaluation context',{exact:true}).click();await page.getByLabel('Run options (JSON)',{exact:true}).fill(JSON.stringify(options));await page.getByRole('button',{name:'Run saved revision',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved calculation revision evaluated'}).waitFor();await proveScreen('calculation-parameter-answer')
 return [input,reversed,workbook,story,browserInput]
}
