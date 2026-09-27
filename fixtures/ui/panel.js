/* A deterministic UI driver: production Panel, fake asynchronous handlers. */
(() => {
  const result = document.getElementById('result');
  const base = () => ({context:{company:'Fixture company',jobTitle:'UI test application'},status:'waiting',activity:[],changes:[],counts:{total:3,filled:0,sensitive:1,review:0},prefs:{},prefQuestions:window.__screenmatePrefs.QUESTIONS});
  let state = base();
  let index = 0;
  let failures = false;
  let saved = 0;
  let submissions = 0;
  const options = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India'];
  const question = (n, dropdown = false) => ({fieldId:`question-${n}`,label:n === 1?'Your phone number':'Your notice period',kind:'missing',reason:'Please supply this value.',topic:`question-${n}`,free:!dropdown,options:dropdown?options:null,required:true});
  const render = () => panel.render(state);
  const panel = new window.__screenmatePanel({
    onAnswer: async (value, remember) => {
      state.approval.busy = true; render();
      await new Promise(r=>setTimeout(r,150));
      state.approval.busy = false;
      if (failures) { state.approval.error='The site rejected this value. Try again.'; render(); return; }
      saved++;
      result.textContent=`Saved ${value}; remember=${remember}; writes=${saved}`;
      state.approval=question(++index, !state.approval.free); render();
    },
    onSkip:()=>{state.approval=question(++index,!state.approval.free);render();},
    onSetPref: (topic,value)=>{state.prefs={...state.prefs,[topic]:value};render();},
    onPrefsDone: (values)=>{result.textContent=JSON.stringify(values);},
    onSubmit:()=>{submissions++;result.textContent=`Submissions: ${submissions}`;state.status='submitted';state.submitted='Fixture confirmed submission';render();},
    onAcceptAll:()=>{state.status='complete';render();},
    onEditChange:(id,value)=>{state.changes=state.changes.map(c=>c.fieldId===id?{...c,after:value}:c);result.textContent=`Edited ${value}`;render();},
    onRevertOne:()=>{state.changes=[];render();},
    onClose:()=>panel.remove(),
  });
  function reset(){state=base();index=1;failures=false;}
  document.getElementById('free').onclick=()=>{reset();state.approval=question(index);render();};
  document.getElementById('choices').onclick=()=>{reset();state.approval=question(index,true);render();};
  document.getElementById('prefs').onclick=()=>{reset();state.status='idle';state.needsPrefs=true;render();};
  document.getElementById('review').onclick=()=>{reset();state.status='reviewing';state.report={blockers:[],checks:[]};state.changes=[{fieldId:'name',label:'Name',before:'',after:'Test Person',level:'safe',verified:true,step:1}];state.submitHandoff={text:'Submit application',disabled:false};render();};
  document.getElementById('refresh').onclick=()=>{state.activity.push({kind:'observe',message:'Activity updated'});render();};
  document.getElementById('fail').onclick=()=>{failures=!failures;result.textContent=`Write failure: ${failures}`;};
  document.getElementById('synthetic').onclick=()=>{
    panel.root.querySelector('[data-act="submitAsk"]')?.click();
    panel.root.querySelector('[data-act="submitGo"]')?.click();
    result.textContent=`Submissions: ${submissions}`;
  };
  state.approval=question(++index);render();
})();
