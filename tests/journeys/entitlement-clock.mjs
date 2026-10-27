import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'

/** Freeze only workerd's realtime clock, including SQLite's UTC clock. Native
 * monotonic timers, the browser and the test runner keep their ordinary clocks.
 * No application handler, authentication or storage implementation is replaced. */
export async function entitlementClock(directory){
 const require=createRequire(import.meta.url),workerd=createRequire(require.resolve('wrangler'))('workerd').default
 const file=join(directory,'utc-clock'),source=join(directory,'clock.c'),library=join(directory,process.platform==='darwin'?'clock.dylib':'clock.so'),launcher=join(directory,'workerd-clock')
 await writeFile(file,'0')
 await writeFile(source,`
#define _GNU_SOURCE
#include <time.h>
#include <sys/time.h>
#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>
#ifndef __APPLE__
#include <unistd.h>
#include <sys/syscall.h>
#endif
static long long epoch(void) {
 const char *path=getenv("SYNTHETIC_BIFOCAL_CLOCK");
 if(!path)return 0;
 FILE *f=fopen(path,"r"); if(!f)return 0;
 long long ms=0; int ok=fscanf(f,"%lld",&ms); fclose(f); return ok==1?ms:0;
}
static int frozen_clock_gettime(clockid_t id,struct timespec *out) {
 long long ms=id==CLOCK_REALTIME?epoch():0;
 if(ms){out->tv_sec=ms/1000;out->tv_nsec=(ms%1000)*1000000;return 0;}
#ifdef __APPLE__
 int (*real_fn)(clockid_t,struct timespec*)=dlsym(RTLD_NEXT,"clock_gettime");return real_fn(id,out);
#else
 return syscall(SYS_clock_gettime,id,out);
#endif
}
static int frozen_gettimeofday(struct timeval *out,void *zone) {
 long long ms=epoch();
 if(ms){out->tv_sec=ms/1000;out->tv_usec=(ms%1000)*1000;return 0;}
#ifdef __APPLE__
 int (*real_fn)(struct timeval*,void*)=dlsym(RTLD_NEXT,"gettimeofday");return real_fn(out,zone);
#else
 return syscall(SYS_gettimeofday,out,zone);
#endif
}
static time_t frozen_time(time_t *out) {
 long long ms=epoch(); time_t value;
 if(ms)value=ms/1000;else {
#ifdef __APPLE__
 time_t (*real_fn)(time_t*)=dlsym(RTLD_NEXT,"time");value=real_fn(NULL);
#else
 value=syscall(SYS_time,NULL);
#endif
 }
 if(out)*out=value;return value;
}
#ifdef __APPLE__
#define INTERPOSE(replacement,original) \\
 __attribute__((used)) static struct {const void *replacement;const void *original;} interpose_##original \\
 __attribute__((section("__DATA,__interpose")))={(const void*)&replacement,(const void*)&original};
INTERPOSE(frozen_clock_gettime,clock_gettime)
INTERPOSE(frozen_gettimeofday,gettimeofday)
INTERPOSE(frozen_time,time)
#else
int clock_gettime(clockid_t id,struct timespec *out){return frozen_clock_gettime(id,out);}
int gettimeofday(struct timeval *out,void *zone){return frozen_gettimeofday(out,zone);}
time_t time(time_t *out){return frozen_time(out);}
#endif
`)
 execFileSync('cc',[...(process.platform==='darwin'?['-dynamiclib']:['-shared','-fPIC']),source,'-o',library,...(process.platform==='darwin'?[]:['-ldl'])],{stdio:'pipe'})
 await writeFile(launcher,'#!/bin/sh\nif [ "$(uname -s)" = Darwin ]; then export DYLD_INSERT_LIBRARIES="$SYNTHETIC_BIFOCAL_PRELOAD"; else export LD_PRELOAD="$SYNTHETIC_BIFOCAL_PRELOAD"; fi\nexec "$SYNTHETIC_BIFOCAL_WORKERD" "$@"\n',{mode:0o700})
 let current=null
 const set=async value=>{current=value===null?null:Date.parse(value);await writeFile(file+'.next',String(current??0));await rename(file+'.next',file)}
 return {set,now:()=>current??Date.now(),environment:{MINIFLARE_WORKERD_PATH:launcher,SYNTHETIC_BIFOCAL_CLOCK:file,SYNTHETIC_BIFOCAL_PRELOAD:library,SYNTHETIC_BIFOCAL_WORKERD:workerd}}
}
