import { isIP } from 'node:net'

function address(value:string):{bits:number;value:bigint}|null {
 const family=isIP(value)
 if(family===4)return {bits:32,value:value.split('.').reduce((n,v)=>(n<<8n)+BigInt(v),0n)}
 if(family!==6||value.includes('%'))return null
 let input=value.toLowerCase()
 if(input.includes('.')){const split=input.lastIndexOf(':'),v4=address(input.slice(split+1));if(!v4)return null;input=input.slice(0,split+1)+(v4.value>>16n).toString(16)+':'+(v4.value&65535n).toString(16)}
 const halves=input.split('::'),left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[]
 const groups=halves.length===1?left:[...left,...Array(8-left.length-right.length).fill('0'),...right]
 return {bits:128,value:groups.reduce((n,v)=>(n<<16n)+BigInt('0x'+v),0n)}
}
export function prefix(value:string) {
 const parts=value.split('/'),ip=address(parts[0]),bits=parts[1]===undefined?ip?.bits:Number(parts[1])
 if(!ip||parts.length>2||parts[1]!==undefined&&!/^\d{1,3}$/.test(parts[1])||!Number.isInteger(bits)||bits!<0||bits!>ip.bits)return null
 const shift=BigInt(ip.bits-bits!)
 return {bits:ip.bits,shift,network:ip.value>>shift}
}
export function matchesIp(ip:string,prefixes:string[]):boolean {
 const candidate=address(ip)
 return !!candidate&&prefixes.some(value=>{const block=prefix(value);return !!block&&block.bits===candidate.bits&&(candidate.value>>block.shift)===block.network})
}
