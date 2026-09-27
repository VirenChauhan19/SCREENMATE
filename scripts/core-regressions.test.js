const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');

function moduleTs(file, cache = new Map()) {
  const full = path.join(root, file);
  if (cache.has(full)) return cache.get(full).exports;
  const mod = { exports: {} }; cache.set(full, mod);
  const localRequire = createRequire(full);
  const requireTs = name => name.startsWith('./') || name.startsWith('../')
    ? moduleTs(path.relative(root, path.resolve(path.dirname(full), name)) + '.ts', cache)
    : localRequire(name);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: full })(requireTs, mod, mod.exports);
  return mod.exports;
}

function content(name, window = {}, globals = {}) {
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension/content', name + '.js'), 'utf8'), { window, ...globals });
  return window;
}

test('Workday listbox buttons expose their question, required state and selected text', () => {
  const labels = ['Work Authorization:', 'Can you provide documentation for the ITAR and EAR requirement above?',
    'Were you previously employed by the U.S. Government?', 'Do you currently hold a Security Clearance?'];
  const textNode = text => ({textContent:text,cloneNode(){return this;},querySelectorAll:()=>[]});
  const buttons = labels.map((label, i) => {
    const legend = {...textNode(label), querySelectorAll:()=>[textNode('Background explanation. '.repeat(50)),textNode(label)]};
    const button = {tagName:'BUTTON',type:'button',id:`question-${i}`,name:`question-${i}`,value:'',textContent:'Select One',isConnected:true,
      getAttribute:key=>({'aria-haspopup':'listbox','aria-label':' Select One Required',name:`question-${i}`}[key] || null),
      getBoundingClientRect:()=>({width:300,height:40}),querySelector:()=>null,
      closest:selector=>selector === 'fieldset' ? fieldset : null};
    const fieldset = {querySelector:()=>legend,querySelectorAll:()=>[button]};
    return button;
  });
  const document = {querySelector:()=>null,querySelectorAll:selector=>selector === '*' || selector.includes('button[aria-haspopup="listbox"]') ? buttons : []};
  const scan = content('scan',{getComputedStyle:()=>({opacity:'1',display:'block',visibility:'visible'})},
    {document,CSS:{escape:s=>s}}).__screenmateScan;
  const fields = scan.scanFields();
  assert.equal(fields.length,4);
  fields.forEach((field,i)=>{
    assert.equal(field.label,labels[i].replace(/:$/,''));
    assert.equal(field.type,'select');
    assert.equal(field.required,true);
    assert.equal(field.value,'');
  });
  buttons[0].textContent='No';
  buttons[0].value='2918cf27e1ff0114b2ebb89212207b05';
  assert.equal(scan.currentValue(buttons[0]),'No');
});

test('Workday labels and selected values stay stable when accessible names and IDs change', () => {
  const label = {textContent:'Gender*',cloneNode(){return this;},querySelectorAll:()=>[]};
  const document = {querySelector:()=>label};
  const scan = content('scan', {}, {document,CSS:{escape:s=>s}}).__screenmateScan;
  let accessibleName = 'Gender Select One Required';
  const button = {tagName:'BUTTON',type:'button',id:'personalInfoUS--gender',value:'',textContent:'Select One',isConnected:true,
    getAttribute:key=>({'aria-haspopup':'listbox','aria-label':accessibleName}[key] || null),checkValidity:()=>true};
  assert.equal(scan.labelFor(button),'Gender');
  assert.equal(scan.currentValue(button),'');
  accessibleName='Gender Male Required';
  button.value='2918cf27e1ff0114b2ebb89212207b05';
  button.textContent='Male';
  assert.equal(scan.labelFor(button),'Gender');
  assert.equal(scan.currentValue(button),'Male');
  const act = content('act',{__screenmateScan:scan}).__screenmateAct;
  assert.equal(act.verifyWrite({el:button,type:'select',label:'Gender'},'Male').ok,true);
  assert.equal(act.verifyWrite({el:button,type:'select',label:'Gender'},'Female').ok,false);
});

test('saved answers survive old Workday prompt labels without overriding explicit ask or merging different questions', () => {
  const p=content('prefs').__screenmatePrefs;
  const gender={label:'Gender',topic:'gender',type:'select',required:true,options:['Female','Male']};
  assert.equal(p.resolve(gender,{gender:'Male'},p.keyFor(gender)).value,'Male');
  assert.equal(p.resolve(gender,{'label:gender select one required':'Male'},p.keyFor(gender)).value,'Male');
  assert.equal(p.resolve(gender,{gender:p.ASK,'label:gender select one required':'Male'},p.keyFor(gender)),null);
  assert.equal(p.resolve(gender,{'label:gender select one required':'Male','label:gender':'Female'},p.keyFor(gender)),null);
  const proficiency={label:'Reading',type:'select',options:['Fluent','Basic']};
  assert.equal(p.resolve(proficiency,{'label:reading select one required':'Fluent'},p.keyFor(proficiency)).value,'Fluent');
  assert.equal(p.resolve({...proficiency,label:'Writing'},{'label:reading select one required':'Fluent'},p.keyFor({...proficiency,label:'Writing'})),null);
  const narrower={label:'Ethnicity: Hispanic or Latino',topic:'ethnicity',type:'select',options:['Yes','No']};
  assert.equal(p.resolve(narrower,{ethnicity:'Asian'},p.keyFor(narrower)),null);
});

test('remembering an answer resolves queued duplicates before asking the next question', async () => {
  const source=fs.readFileSync(path.join(root,'extension/content/main.js'),'utf8');
  const settle=source.slice(source.indexOf('  async function settleQuestion('),source.indexOf('  async function answer('));
  const req={fieldId:'gender-1',label:'Gender',topic:'gender'};
  const duplicate={fieldId:'gender-2',label:'Gender',topic:'gender'};
  const state={gen:0,stats:{userDecisions:0},resolvedSensitive:new Set(),approvalQueue:[req,duplicate],prefs:{}};
  let resumed=false, applied=0;
  const context={S:state,log(){},paint(){},stale:()=>false,
    window:{__screenmatePrefs:{setOne:async(key,value)=>({...state.prefs,[key]:value})}},
    applyPreferences:async()=>{
      applied++;
      assert.equal(state.prefs.gender,'Male');
      state.approvalQueue=state.approvalQueue.filter(q=>q.topic!=='gender');
    },
    resumeAfterApproval:()=>{resumed=true;}};
  vm.runInNewContext(settle,context);
  await context.settleQuestion(req,'Male',{remember:true});
  assert.equal(applied,1);
  assert.equal(state.approvalQueue.length,0);
  assert.equal(resumed,true);
});

test('standing answers refuse inverted, compound, nationality and narrower demographic questions', () => {
  const p = content('prefs').__screenmatePrefs;
  const field = (label, topic) => ({ label, topic, type: 'select', options: ['Yes', 'No'] });
  assert.equal(p.resolve(field('Will you require visa sponsorship?', 'sponsorship'), {sponsorship:'No'}).value, 'No');
  for (const [label, topic] of [
    ['Can you work without employer sponsorship?', 'sponsorship'],
    ['Are you willing to relocate and travel 80%?', 'relocation'],
    ['Are you a US citizen?', 'workAuthorization'],
    ['Are you Hispanic or Latino?', 'ethnicity'],
    ['What is your previous salary?', 'salary'],
  ]) assert.equal(p.resolve(field(label, topic), {[topic]:'No'}), null, label);
  assert.equal(p.matchOption('No', ['No preference','Yes','No, I cannot relocate']), 'No, I cannot relocate');
  assert.equal(p.matchOption('No', ['No preference','Yes']), null);
  assert.equal(p.matchOption('I do not wish to answer', ['Yes, I have a disability', 'Decline to self-identify']), 'Decline to self-identify');
  assert.equal(p.matchOption('Male', ['Female','Male']), 'Male');
});

test('location grounding retains region and country identity', () => {
  const { isGroundedValue } = moduleTs('src/lib/grounding.ts');
  assert.equal(isGroundedValue('text','Portland, Maine',{location:'Portland, Oregon'},'Location'),false);
  assert.equal(isGroundedValue('text','Atlanta, GA, United States',{location:'Atlanta, Georgia'},'Location'),true);
  assert.equal(isGroundedValue('text','Atlanta, Georgia, Canada',{location:'Atlanta, Georgia'},'Location'),false);
  assert.equal(isGroundedValue('text','London, Canada',{location:'London, United Kingdom'},'Location'),false);
});

test('option matching and phone verification reject wrong locations, no-preference and missing digits', () => {
  const w = content('prefs', { __screenmateScan: {cleanText:s=>String(s || '').trim(),groupMembers:()=>[],isCheckboxGroup:()=>false,currentValue:el=>el.value} });
  const a = content('act',w).__screenmateAct;
  assert.equal(a.optionScore('Portland, Maine','Portland, Oregon'),0);
  assert.ok(a.optionScore('Atlanta, GA, United States','Atlanta, Georgia') >= 60);
  assert.equal(a.optionScore('No preference','No'),0);
  const field={type:'text',label:'Phone',el:{type:'tel',value:'5550100',isConnected:true,getAttribute:()=>null,checkValidity:()=>true}};
  assert.equal(a.verifyWrite(field,'4045550100').ok,false);
  field.el.value='+1 (404) 555-0100'; assert.equal(a.verifyWrite(field,'4045550100').ok,true);
});

test('authentication refuses forged origins and altered/expired sessions', () => {
  const oldKey=process.env.SCREENMATE_API_KEY, oldMode=process.env.NODE_ENV;
  process.env.SCREENMATE_API_KEY='local-regression-key-only'; process.env.NODE_ENV='production';
  try {
    const auth=moduleTs('src/lib/auth.ts');
    const request=headers=>new Request('https://backend.example/api/agent',{method:'POST',headers});
    assert.equal(auth.requireKey(request({origin:'https://backend.example',host:'backend.example'})).status,401);
    assert.equal(auth.requireKey(request({'x-screenmate-key':'wrong'})).status,401);
    assert.equal(auth.requireKey(request({'x-screenmate-key':process.env.SCREENMATE_API_KEY})),null);
    const token=auth.createSession(), cookie=`${auth.SESSION_COOKIE}=${token}`;
    assert.equal(auth.requireKey(request({origin:'https://backend.example',cookie})),null);
    assert.equal(auth.requireKey(request({origin:'https://evil.example',cookie})).status,401);
    assert.equal(auth.hasSession(request({cookie:cookie.replace(/.$/,'z')})),false);
    assert.equal(auth.hasSession(request({cookie:cookie.replace(/=\d+\./,'=1.')})),false);
    delete process.env.SCREENMATE_API_KEY;
    assert.equal(auth.requireKey(request({})).status,503);
  } finally {
    if(oldKey===undefined) delete process.env.SCREENMATE_API_KEY; else process.env.SCREENMATE_API_KEY=oldKey;
    if(oldMode===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=oldMode;
  }
});

test('CV extraction handles PDF/DOCX, XML entities and compressed oversize bodies', async () => {
  const { extractText }=moduleTs('src/lib/cv.ts');
  const {zipSync,strToU8}=require('fflate');
  for(const kind of ['pdf','docx']) {
    const bytes=fs.readFileSync(path.join(root,`fixtures/cv/sample-cv.${kind}`));
    assert.ok((await extractText(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),kind)).length>80);
  }
  const zip=zipSync({'word/document.xml':strToU8('<w:p><w:t>O&apos;Brien &amp; &quot;CV&quot; &#x41;</w:t></w:p>')});
  assert.equal(await extractText(zip.buffer,'docx'), 'O\'Brien & "CV" A');
  const large=zipSync({'word/document.xml':new Uint8Array(4*1024*1024+1)});
  await assert.rejects(extractText(large.buffer,'docx'), /too large/);
  await assert.rejects(extractText(new TextEncoder().encode('not a pdf').buffer,'pdf'));
});

test('worker restart resumes once, only in the originating frame and origin', async () => {
  const session={};
  function worker() {
    let listener;
    const chrome={runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},
      storage:{session:{get:async key=>({[key]:session[key]}),set:async patch=>Object.assign(session,patch),remove:async key=>{delete session[key];}}},
      tabs:{onRemoved:{addListener(){}},sendMessage:async()=>null},commands:{onCommand:{addListener(){}}},action:{onClicked:{addListener(){}}}};
    vm.runInNewContext(fs.readFileSync(path.join(root,'extension/background.js'),'utf8'),{chrome,URL,Map,Set,Date});
    return (msg,sender)=>new Promise(resolve=>{const pending=listener(msg,sender,resolve);if(!pending)resolve(null);});
  }
  let send=worker();
  const sender={tab:{id:123},frameId:7,documentId:'old',url:'https://jobs.example/apply/1'};
  assert.equal(await send({type:'screenmate:saveRun',run:{resume:true,step:2}},sender),true);
  send=worker();
  assert.equal(await send({type:'screenmate:loadRun'},sender),null);
  assert.equal(await send({type:'screenmate:loadRun'},{...sender,frameId:0,documentId:'new'}),null);
  assert.equal(await send({type:'screenmate:loadRun'},{...sender,url:'http://jobs.example/apply/2',documentId:'new'}),null);
  const results=await Promise.all([send({type:'screenmate:loadRun'},{...sender,documentId:'new'}),send({type:'screenmate:loadRun'},{...sender,documentId:'new'})]);
  assert.equal(results.filter(Boolean).length,1);
  assert.equal(results.find(Boolean).step,2);
  await send({type:'screenmate:saveRun',run:{resume:true}},sender);
  session['run:123'].at=Date.now()-4*60_000;
  send=worker();
  assert.equal(await send({type:'screenmate:loadRun'},{...sender,documentId:'new'}),null);
});

test('a stale iframe cannot replace the active hosted panel state', () => {
  let listener, rendered=0, removed=0;
  const window={}; window.top=window;
  window.__screenmatePanel=class { render(){rendered++;} remove(){removed++;} toggle(){} };
  content('frames',window,{chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}});
  listener({type:'screenmate:panel',op:'open',frameId:3});
  listener({type:'screenmate:panel',op:'render',frameId:2,state:{}});
  listener({type:'screenmate:panel',op:'remove',frameId:2});
  assert.equal(rendered,0);assert.equal(removed,0);
  listener({type:'screenmate:panel',op:'render',frameId:3,state:{}});
  assert.equal(rendered,1);
});

test('synthetic answer and preference clicks cannot mutate form or saved decisions', () => {
  const Panel=content('panel').__screenmatePanel;
  for(const action of ['answer','pref','run','revertAll']) {
    let click, calls=0;
    const button={dataset:{act:action,val:'Yes',topic:'sponsorship'},addEventListener:(_,fn)=>{click=fn;}};
    const panel=Object.create(Panel.prototype);
    Object.assign(panel,{root:{querySelectorAll:()=>[button],querySelector:()=>null},collapsed:false,
      handlers:{onAnswer:()=>calls++,onSetPref:()=>calls++,onRun:()=>calls++,onRevertAll:()=>calls++}});
    panel.bind();click({isTrusted:false,preventDefault(){},stopPropagation(){}});assert.equal(calls,0,action);
  }
});

test('fast profile transcription uses exact labels and refuses declarations and reference contacts', () => {
  const w=content('act',{__screenmateScan:{cleanText:s=>String(s||'').trim()}});
  const pick=w.__screenmateAct.directProfileValue;
  const profile={name:'Fixture Person',email:'fixture@example.net',phone:'4045550100'};
  assert.equal(pick({label:'Full name',level:'safe',type:'text'},profile),'Fixture Person');
  assert.equal(pick({label:'Email address',level:'safe',type:'email'},profile),'fixture@example.net');
  assert.equal(pick({label:'Do you require sponsorship?',level:'sensitive',sensitive:true,type:'select'},profile),null);
  assert.equal(pick({label:'Former name',level:'safe',type:'text'},profile),null);
  assert.equal(pick({label:'Name',level:'safe',type:'text',el:{closest:()=>({querySelector:()=>({textContent:'Professional reference'})})}},profile),null);
});

test('settled verification waits long enough to catch a framework clearing the value', async () => {
  const field={type:'text',label:'Name',el:{value:'Fixture',type:'text',isConnected:true,getAttribute:()=>null,checkValidity:()=>true}};
  let elapsed=0;
  const w=content('act',{__screenmateScan:{cleanText:s=>String(s||'').trim(),currentValue:el=>el.value,isCheckboxGroup:()=>false}},
    {setTimeout:fn=>{elapsed+=150;if(elapsed>=150)field.el.value='';queueMicrotask(fn);}});
  assert.equal((await w.__screenmateAct.verifySettled(field,'Fixture',{timeout:450})).ok,false);
});

test('answer memory matches portal punctuation, preserves explicit ask, and skips optional gaps', () => {
  const p = content('prefs').__screenmatePrefs;
  const notice = {label:'What is your notice period? *', topic:'noticePeriod', type:'text', required:true};
  assert.equal(p.resolve(notice, {noticePeriod:'Two weeks'}, p.keyFor(notice)).value, 'Two weeks');
  const unknown = {label:'Preferred interview time (optional)', type:'text', required:false};
  const old = {'label:preferred interview time?':'Afternoons'};
  assert.equal(p.resolve(unknown, old, p.keyFor(unknown)).value, 'Afternoons');
  assert.equal(p.shouldAsk(unknown, {}), false);
  assert.equal(p.shouldAsk({...unknown, required:true}, {}), true);
  assert.equal(p.shouldAsk(unknown, {[p.keyFor(unknown)]:p.ASK}), true);
  assert.equal(p.resolve(unknown, {...old, [p.keyFor(unknown)]:p.ASK}, p.keyFor(unknown)), null);
  assert.equal(p.resolve({...unknown, label:'Preferred interview time in London'}, old, p.keyFor({...unknown, label:'Preferred interview time in London'})), null);
  assert.equal(p.canReuseTopic({label:'Previous salary',type:'text',topic:'salary'}),false);
  assert.equal(p.canReuseTopic({label:'Expected salary',type:'text',topic:'salary'}),true);
  const auth = label => ({label,type:'select',topic:'workAuthorization',options:['Yes','No']});
  const us = auth('Are you authorized to work in the US?');
  const usa = auth('Are you legally authorised to work in the United States?');
  assert.equal(p.keyFor(us),p.keyFor(usa));
  const saved = {'label:are you authorized to work in the us?':'Yes'};
  assert.equal(p.resolve(usa,saved,p.keyFor(usa)).value,'Yes');
  for (const label of ['Are you authorized to work in Canada?', 'Are you a US citizen?', 'Are you authorized to work in the US without sponsorship?']) {
    const f = auth(label);
    assert.equal(p.resolve(f,saved,p.keyFor(f)),null,label);
  }
});

test('common portal identity labels use stored facts without inventing address parts', () => {
  const pick = content('act',{__screenmateScan:{cleanText:s=>String(s||'').trim()}}).__screenmateAct.directProfileValue;
  const profile = {name:'Fixture Person',university:'Example College',postalCode:'02110',linkedin:'https://example.net/profile'};
  const field = label => ({label,type:'text',level:'safe'});
  assert.equal(pick(field('Given name'),profile),'Fixture');
  assert.equal(pick(field('Family name'),profile),'Person');
  assert.equal(pick(field('School (required)'),profile),'Example College');
  assert.equal(pick(field('Postal code'),profile),'02110');
  assert.equal(pick(field('LinkedIn profile URL'),profile),'https://example.net/profile');
  assert.equal(pick(field('City'),profile),null);
  assert.equal(pick(field('Former school'),profile),null);
  assert.equal(pick(field('(city, country)'),{location:'Atlanta, Georgia',country:'United States'}),'Atlanta, Georgia, United States');
  assert.equal(pick(field('(city, country)'),{location:'Atlanta, Georgia'}),null);
  assert.equal(pick({...field('(city, country)'),level:'review'},{location:'Atlanta, Georgia',country:'United States'}),'Atlanta, Georgia, United States');
  assert.equal(pick({...field('(city, country)'),level:'review',sensitive:true},{location:'Atlanta, Georgia',country:'United States'}),null);
});

test('web answers survive reloads, are applicant/question scoped, and can be forgotten', () => {
  const {recalledAnswer,rememberAnswer} = moduleTs('src/lib/answer-memory.ts');
  const data = new Map();
  const storage = {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const f = {id:'authorization',label:'Authorized to work in Canada?',options:['Yes','No']};
  assert.equal(rememberAnswer(storage,'one',f,'Yes',true),true);
  assert.equal(recalledAnswer(storage,'one',f),'Yes');
  assert.equal(recalledAnswer(storage,'two',f),null);
  assert.equal(recalledAnswer(storage,'one',{...f,label:'Authorized to work in France?'}),null);
  assert.equal(recalledAnswer(storage,'one',{...f,options:['No']}),null);
  rememberAnswer(storage,'one',f,'No',false);
  assert.equal(recalledAnswer(storage,'one',f),null);
  assert.equal(recalledAnswer(null,'one',f),null);
  assert.equal(rememberAnswer(null,'one',f,'Yes',true),false);
});
