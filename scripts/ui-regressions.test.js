const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(name, globals = {}) {
  const context = { window: {}, ...globals };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content', name + '.js'), 'utf8'), context);
  return context.window;
}

test('setup defaults persist, rapid choices merge, and failed saves do not poison the queue', async () => {
  let stored = {};
  let fail = false;
  const chrome = { storage: { local: {
    get: async () => ({ preferences: { ...stored } }),
    set: async ({ preferences }) => { if (fail) throw new Error('Storage unavailable'); stored = preferences; },
  } } };
  const p = load('prefs', { chrome }).__screenmatePrefs;
  await Promise.all([p.setOne('sponsorship', 'No'), p.setMany({ salary: p.ASK }, { complete: true })]);
  assert.equal(p.isComplete(stored), true);
  assert.equal(stored.sponsorship, 'No');
  assert.equal(stored.salary, p.ASK);
  fail = true;
  await assert.rejects(p.setOne('salary', '120000'));
  fail = false;
  await p.setOne('salary', p.ASK);
  assert.equal(stored.salary, p.ASK);
});

test('ordinary text verification rejects partial and truncated writes', () => {
  const w = load('act', {window:{__screenmateScan:{cleanText:s=>String(s || '').trim(),groupMembers:()=>[],isCheckboxGroup:()=>false,currentValue:el=>el.value}}});
  const field = {type:'text',label:'Name',el:{isConnected:true,type:'text',value:'Jo',getAttribute:()=>null,checkValidity:()=>true}};
  assert.equal(w.__screenmateAct.verifyWrite(field, 'Jonathan').ok, false);
  field.el.value = 'Jonathan';
  assert.equal(w.__screenmateAct.verifyWrite(field, 'Jonathan').ok, true);
});

test('submit needs a trusted event, an armed confirmation, and a ready form', () => {
  const Panel = load('panel').__screenmatePanel;
  let callback;
  let calls = 0;
  const button = {dataset:{act:'submitGo'},addEventListener:(_,fn)=>{callback=fn;}};
  const panel = Object.create(Panel.prototype);
  Object.assign(panel,{root:{querySelectorAll:s=>s==='[data-act]'?[button]:[],querySelector:()=>null},handlers:{onSubmit:()=>calls++},collapsed:false,confirmSubmit:true,canSubmit:true});
  panel.bind();
  const click = trusted=>callback({isTrusted:trusted,preventDefault(){},stopPropagation(){}});
  click(false); assert.equal(calls,0);
  panel.confirmSubmit=false;click(true);assert.equal(calls,0);
  panel.confirmSubmit=true;panel.canSubmit=false;click(true);assert.equal(calls,0);
  panel.canSubmit=true;click(true);assert.equal(calls,1);
  click(true);assert.equal(calls,1);
});

test('draft and remember state are restored only for the same question', () => {
  const Panel = load('panel').__screenmatePanel;
  const answer = {value:''}, select = {value:''}, remember = {checked:true};
  const panel = Object.create(Panel.prototype);
  panel.root={querySelectorAll:()=>[],querySelector:s=>({'.afree':answer,'.asel':select,'.remember':remember}[s] || null)};
  panel.state={step:1,approval:{fieldId:'phone'}};
  const ui={drafts:{},editors:{},approvalKey:'1:phone',answerDraft:'404-555-0100',selectDraft:'Choice',remember:false};
  panel.restoreUi(ui,false);
  assert.equal(answer.value,'404-555-0100');assert.equal(remember.checked,false);
  panel.state.approval={fieldId:'notice'};answer.value='';select.value='';remember.checked=true;
  panel.restoreUi(ui,false);
  assert.equal(answer.value,'');assert.equal(select.value,'');assert.equal(remember.checked,true);
});

test('a stale backend check cannot overwrite a newer connection result', async () => {
  let finishOld;
  const context = {AbortController,setTimeout,clearTimeout,fetch:async url=>{
    if (url.includes('old.example')) return new Promise(resolve=>{finishOld=resolve;});
    return {ok:true,json:async()=>({requiresKey:false,configured:{openrouter:true,exa:true}})};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/popup/common.js'),'utf8'),context);
  const status = {};
  const old = context.smHealth('https://old.example','',status);
  await context.smHealth('https://new.example','',status);
  finishOld({ok:false,status:503});
  await old;
  assert.equal(status.textContent,'Connected.');
  assert.equal(status.className,'note ok');
});

test('saving blank preferences does not opt the applicant into repeated optional questions', () => {
  const Panel = load('panel').__screenmatePanel;
  let click, saved;
  const button = {dataset:{act:'prefsDone'},addEventListener:(_,fn)=>{click=fn;}};
  const inputs = [{dataset:{topic:'salary'},value:''},{dataset:{topic:'startDate'},value:''}];
  const panel = Object.create(Panel.prototype);
  Object.assign(panel,{root:{querySelectorAll:s=>s==='[data-act]'?[button]:s==='.pfree'?inputs:[],querySelector:()=>null},
    state:{prefs:{startDate:'__ask__'}},handlers:{onPrefsDone:v=>{saved=v;}}});
  panel.bind();
  click({isTrusted:true,preventDefault(){},stopPropagation(){}});
  assert.equal(saved.salary,'');
  assert.equal(saved.startDate,'__ask__');
});
