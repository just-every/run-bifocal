// Original synthetic source files in the documented source languages. Expected
// values are calculated separately from these declarations by the journey.
const lookml=`view: sales {
 sql_table_name: invoices ;;
 dimension: invoice { type: number primary_key: yes sql: \${TABLE}.invoice ;; }
 dimension: region { type: string sql: \${TABLE}.region ;; }
 dimension: revenue { type: number sql: \${TABLE}.revenue ;; }
 measure: revenue_sum { type: sum sql: \${TABLE}.revenue ;; }
 measure: unique_regions { type: count_distinct sql: \${TABLE}.region ;; }
}
explore: sales {}`
const semantic=`semantic_models:
  - name: sales
    model: ref('invoices')
    entities:
      - name: invoice
        type: primary
        expr: invoice
    dimensions:
      - name: region
        type: categorical
        expr: region
    measures:
      - name: revenue_sum
        agg: sum
        expr: revenue
      - name: unique_regions
        agg: count_distinct
        expr: region
`
const cube=`cubes:
  - name: sales
    sql_table: invoices
    dimensions:
      - name: invoice
        sql: invoice
        type: number
        primary_key: true
      - name: region
        sql: region
        type: string
    measures:
      - name: revenue_sum
        sql: revenue
        type: sum
      - name: unique_regions
        sql: region
        type: count_distinct
`
const tmdl=`table Sales
    column Invoice
        dataType: int64
        sourceColumn: invoice
    column Revenue
        dataType: decimal
        sourceColumn: revenue
    column Region
        dataType: string
        sourceColumn: region
    measure RevenueSum = SUM('Sales'[Revenue])
`
export function modelProjectFixtures(dataset,calendar){
 const projects=['lookml','dbt','metricflow','tmdl','cube'].map(format=>{
  const name=format==='tmdl'?'Sales':'sales',revenue=format==='tmdl'?'RevenueSum':'revenue_sum'
  return {version:1,projectId:'synthetic-bifocal-'+format,format,files:[{path:format==='lookml'?'sales.model.lkml':format==='tmdl'?'Sales.tmdl':'sales.yaml',content:format==='lookml'?lookml:format==='tmdl'?tmdl:format==='cube'?cube:semantic}],bindings:{[name]:{dataset,grain:['invoice']}},formats:{[name+'.'+revenue]:{unit:'money',scale:2,sourceCurrency:'USD'},...(format==='tmdl'?{}:{[name+'.unique_regions']:{unit:'count',scale:0}})},context:{modelVersion:'source-model',metricVersion:'source-measures',accountingBasis:'accrual',calendar:{id:calendar,version:1},rounding:'half-even'}}
 })
 const base=structuredClone(projects[1]),kind=name=>['type',name].join('/')
 const fields=[{id:1,name:'invoice',base_type:kind('Integer')},{id:2,name:'region',base_type:kind('Text')},{id:3,name:'revenue',base_type:kind('Decimal')}]
 projects.push({...structuredClone(base),projectId:'synthetic-bifocal-metabase',format:'metabase',files:[
  {path:'card.json',content:JSON.stringify({id:37,name:'sales',dataset_query:{database:9,type:'query',query:{'source-table':12,aggregation:[['sum',['field',3,null]],['distinct',['field',2,null]]]}},result_metadata:[{name:'revenue_sum',base_type:kind('Decimal')},{name:'unique_regions',base_type:kind('Integer')}]})},
  {path:'table.json',content:JSON.stringify({id:12,name:'invoices',db_id:9,fields})},
  {path:'database.json',content:JSON.stringify({id:9,name:'warehouse',engine:'postgres',details:{}})}
 ]})
 projects.push({...structuredClone(base),projectId:'synthetic-bifocal-tableau',format:'tableau',files:[{path:'sales.tds',content:'<datasource name="sales"><connection class="textscan"><relation type="table" table="invoices"/></connection><column name="[invoice]" datatype="integer"/><column name="[region]" datatype="string"/><column name="[revenue]" datatype="real"/><column name="[revenue_sum]" datatype="real"><calculation class="tableau" formula="SUM([revenue])"/></column><column name="[unique_regions]" datatype="integer"><calculation class="tableau" formula="COUNTD([region])"/></column></datasource>'}]})
 return projects
}
