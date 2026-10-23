import { createMailSender } from '../../modules/mail/index.mjs'
import { fail } from '../query/types'
/** SendGrid Mail Send v3: https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
 * Uses the selected Base mail serializer and fixed HTTPS transport. One explicit
 * instance approval permits one attempt; acceptance is never called delivery. */
export async function sendReport(env,id,email,artifact){
 if(env.AUTH_LOCAL==='true'||env.RER_DEMO==='1')return {provider:'development',status:'development',providerMessageId:null}
 if(env.MAIL_PROVIDER!=='sendgrid'||!env.MAIL_API_KEY||!env.MAIL_FROM)fail('configured_sendgrid_transport_required',503)
 const data=JSON.parse(artifact)
 return createMailSender({provider:'sendgrid',mode:'production',apiKey:env.MAIL_API_KEY}).send({deliveryId:id,from:env.MAIL_FROM,to:[email],subject:(data.corrects?'Correction: ':'')+data.title,text:`${data.title}\nPeriod: ${data.period}\nRevision: ${data.revision}\nRun: ${data.runId}\n${data.staleLabel??'Dated immutable snapshot'}\n${data.narrative}\nThe attachment is the exact reviewed snapshot.`,attachments:[{filename:'bifocal-report.json',contentType:'application/json',content:new TextEncoder().encode(artifact)}]})
}
