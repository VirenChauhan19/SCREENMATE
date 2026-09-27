/** Fake Chrome transport for UI tests, never reads a real extension profile. */
(() => {
  const performanceMode = document.currentScript.src.includes('mode=performance');
  const autofillMode = document.currentScript.src.includes('mode=autofill');
  const key = autofillMode ? 'screenmate-autofill-fixture-v1' : performanceMode ? 'screenmate-performance-fixture' : 'screenmate-ui-fixture';
  const defaults = {backendUrl:new URL(document.baseURI).origin,profile:{name:'Fixture Person',email:'fixture@example.net',skills:[]},settings:{autoAttachResume:false}};
  if (performanceMode) {
    defaults.profile = {name:'Fixture Person',email:'fixture@example.net',phone:'4045550100',university:'SCAD',degree:'BFA Game Design',portfolio:'https://example.net'};
    defaults.preferences = Object.fromEntries(['workAuthorization','sponsorship','relocation','remotePreference','salary','startDate','gender','ethnicity','veteran','disability'].map(k=>[k,'__ask__']));
  }
  if (autofillMode) {
    defaults.profile = {name:'Fixture Person',email:'fixture@example.net',phone:'4045550100',university:'Example College'};
    defaults.preferences = {sponsorship:'No'};
  }
  const read = () => JSON.parse(localStorage.getItem(key) || JSON.stringify(defaults));
  const calls = {classify:0,agent:0,research:0};
  const storage = {
    async get(keys, callback) {
      const data=read(); const out=Object.fromEntries((typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(data)).filter(k=>k in data).map(k=>[k,data[k]]));
      callback?.(out); return out;
    },
    async set(patch,callback) {localStorage.setItem(key,JSON.stringify({...read(),...patch}));callback?.();},
    async remove(key,callback) {const data=read();delete data[key];localStorage.setItem('screenmate-ui-fixture',JSON.stringify(data));callback?.();},
  };
  const classify = fields=>fields.map(f=>({...f,level:/sponsorship|salary/i.test(f.label)?'sensitive':'safe',sensitive:/sponsorship|salary/i.test(f.label),topic:/sponsor/i.test(f.label)?'sponsorship':/salary/i.test(f.label)?'salary':null}));
  const runtime = {
    id:'ui-fixture',lastError:null,getManifest:()=>({version:'UI fixture'}),onMessage:{addListener(){}},
    openOptionsPage:()=>window.open('/extension/options/options.html','_blank'),
    sendMessage(message,callback) {
      let result=null;
      if(message.type==='screenmate:getProfile') result={profile:read().profile};
      if(message.type==='screenmate:getBackend') result={base:read().backendUrl,apiKey:read().apiKey || ''};
      if(message.type==='screenmate:api') {
        calls[message.route]++;
        document.dispatchEvent(new CustomEvent('fixture:transport',{detail:{...calls}}));
        if(message.route==='classify') result={ok:true,data:{fields:classify(message.body.fields)}};
        else if(message.route==='agent') result={ok:true,data:{decisionSummary:'Fixture fills identity, then asks for missing answers.',actions:message.body.applicationState.fields.filter(f=>!f.value).map(f=>{
          const value=/full name/i.test(f.label)?'Fixture Person':/^email/i.test(f.label)?'fixture@example.net':null;
          return value?{tool:'fillField',args:{fieldId:f.id,value}}:{tool:'requestUserApproval',args:{fieldId:f.id,reason:'Please answer this question.'}};
        })}};
      }
      setTimeout(()=>callback?.(result),30);
    },
  };
  window.chrome={runtime,storage:{local:storage},permissions:{contains:async()=>true,request:async()=>true}};
})();
