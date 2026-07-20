import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:4173/';
const out = process.env.QA_OUTPUT || 'artifacts/ui-regression';
const cases = [
  ['1920x1080',1920,1080,''],['1440x900',1440,900,''],['1366x768',1366,768,''],
  ['1280x720',1280,720,''],['1024x768',1024,768,''],['768x1024',768,1024,''],
  ['430x932',430,932,''],['390x844',390,844,''],
  ['embed-1366x768',1366,768,'?embed=1&preview=0'],['embed-430x700',430,700,'?embed=1&preview=0']
];
const failures = [];
await mkdir(out,{recursive:true});

function ignored(url,message=''){
  return /fonts\.googleapis\.com|fonts\.gstatic\.com|dot-games-host\.vercel\.app\/tts\.js/.test(url)||/ERR_ABORTED|NS_BINDING_ABORTED/.test(message);
}

async function gameFrame(page){
  const handle=await page.waitForSelector('#gameFrame');
  const frame=await handle.contentFrame();
  if(!frame) throw new Error('game iframe unavailable');
  await frame.waitForSelector('#startBtn',{state:'visible'});
  await frame.waitForFunction(()=>document.querySelectorAll('link[data-ui-polish="true"]').length===5);
  return frame;
}

async function audit(frame,name,state,height,embed){
  const issues=await frame.evaluate(({state,height,embed})=>{
    const bad=[],$=(s)=>document.querySelector(s),visible=(e)=>e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().width>0;
    const root=document.documentElement,body=document.body;
    if(root.scrollWidth>root.clientWidth+2||body.scrollWidth>body.clientWidth+2) bad.push('horizontal overflow');
    if(embed&&(root.scrollHeight>height+2||body.scrollHeight>height+2)) bad.push(`embed vertical overflow ${root.scrollHeight}/${body.scrollHeight}/${height}`);
    const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);const dup=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];if(dup.length)bad.push(`duplicate ids ${dup.join(',')}`);
    if(document.querySelectorAll('link[data-ui-polish="true"]').length!==5)bad.push('polish styles missing');
    const selectors=state==='intro'?['#startBtn','.intro-difficulty__button']:state==='play'?['.choice','#takeBtn']:['.result-action','#tactileReplayBtn'];
    for(const s of selectors)for(const e of document.querySelectorAll(s)){if(!visible(e))continue;const r=e.getBoundingClientRect();if(r.width<44||r.height<44)bad.push(`${s} target ${Math.round(r.width)}x${Math.round(r.height)}`)}
    for(const e of document.querySelectorAll('button')){if(!visible(e))continue;const r=e.getBoundingClientRect();if(r.width<32||r.height<32)bad.push(`small button ${e.id||'anonymous'} ${Math.round(r.width)}x${Math.round(r.height)}`)}
    if(state==='intro'){
      const xs=['.intro-eyebrow','.intro-title','.intro-tagline','.intro-summary','.intro-rule-card'].map(s=>$(s)?.getBoundingClientRect().left).filter(Number.isFinite);if(xs.length&&Math.max(...xs)-Math.min(...xs)>2)bad.push('intro left edges differ');
      const t=parseFloat(getComputedStyle($('.intro-title__ko')).fontSize),g=parseFloat(getComputedStyle($('.intro-tagline')).fontSize),s=parseFloat(getComputedStyle($('.intro-summary')).fontSize);if(!(t>g&&g>s))bad.push(`type hierarchy ${t}/${g}/${s}`);
      const b=$('#startBtn').getBoundingClientRect(),l=$('.intro-start__label').getBoundingClientRect();if(Math.abs(b.left+b.width/2-l.left-l.width/2)>3)bad.push('start label off center');
    }
    const active=state==='intro'?$('#screenTitle'):state==='play'?$('#screenPlay'):$('#screenResult');if(!visible(active))bad.push(`${state} hidden`);
    return bad;
  },{state,height,embed});
  failures.push(...issues.map(issue=>`${name}/${state}: ${issue}`));
}

async function result(frame,kind){
  await frame.evaluate((kind)=>{
    if(typeof window.show==='function')window.show('result');
    else{document.querySelector('#screenTitle')?.classList.add('hidden');document.querySelector('#screenPlay')?.classList.add('hidden');document.querySelector('#screenResult')?.classList.remove('hidden')}
    if(kind==='win'&&typeof window.showWinResult==='function')void window.showWinResult();
    else if(kind==='lose'&&typeof window.showLoseResult==='function')void window.showLoseResult();
    else document.querySelector('#screenResult').dataset.result=kind;
  },kind);
  await frame.waitForSelector('#screenResult:not(.hidden)',{state:'visible'});await frame.waitForTimeout(200);
}

const browser=await chromium.launch({headless:true});
try{
  for(const [name,width,height,query] of cases){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const runtime=[];
    page.on('pageerror',e=>runtime.push(`pageerror ${e.message}`));
    page.on('requestfailed',r=>{const m=r.failure()?.errorText||'';if(!ignored(r.url(),m))runtime.push(`requestfailed ${r.url()} ${m}`)});
    try{
      await page.goto(base+query,{waitUntil:'domcontentloaded',timeout:30000});const frame=await gameFrame(page),embed=query.includes('embed=1');
      await frame.locator('#startBtn').focus();const ring=await frame.locator('#startBtn').evaluate(e=>{const s=getComputedStyle(e);return s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=3});if(!ring)failures.push(`${name}/intro: focus ring missing`);
      await audit(frame,name,'intro',height,embed);await page.screenshot({path:path.join(out,`${name}-intro.png`),animations:'disabled'});
      await frame.locator('#startBtn').click();await frame.waitForSelector('#screenPlay:not(.hidden)',{state:'visible'});await audit(frame,name,'play',height,embed);await page.screenshot({path:path.join(out,`${name}-play.png`),animations:'disabled'});
      await result(frame,'win');await audit(frame,name,'result',height,embed);await page.screenshot({path:path.join(out,`${name}-win.png`),animations:'disabled'});
      await result(frame,'lose');await audit(frame,name,'result',height,embed);await page.screenshot({path:path.join(out,`${name}-lose.png`),animations:'disabled'});
      if(await frame.evaluate(()=>typeof window.openHelp==='function')){await frame.evaluate(()=>window.openHelp());await frame.waitForSelector('#helpModal:not([hidden])',{state:'visible'});await page.screenshot({path:path.join(out,`${name}-help.png`),animations:'disabled'});await frame.keyboard.press('Escape')}
      failures.push(...runtime.map(e=>`${name}: ${e}`));
    }catch(e){failures.push(`${name}: ${e.stack||e.message}`)}finally{await page.close()}
  }
}finally{await browser.close()}
await writeFile(path.join(out,'report.json'),JSON.stringify({cases:cases.map(([name,width,height,query])=>({name,width,height,query})),failures},null,2));
if(failures.length){console.error(`UI audit found ${failures.length} issue(s)`);for(const f of failures)console.error(`- ${f}`);process.exit(1)}
console.log(`UI audit passed for ${cases.length} viewport configurations`);
