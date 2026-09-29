(() => {
  const name = document.currentScript.dataset.case;
  const scan = window.__screenmateScan, act = window.__screenmateAct, nav = window.__screenmateNav;
  const output = document.getElementById('compatibility-results');
  output.style.cssText='white-space:pre-wrap;padding:20px;background:#eef;font:14px monospace';
  const cases = {
    greenhouse: [['Full name','Fixture Person'],['Highest degree attained','BFA Game Design'],['Are you authorized to work in the US?','Yes']],
    lever: [['Full name','Fixture Person'],['Will you require visa sponsorship?','No']],
    ashby: [['Name','Fixture Person'],['School','SCAD'],['Are you willing to relocate?','Yes']],
    taleo: [['Full Name','Fixture Person'],['Education Level','BFA Game Design'],['Are you legally eligible to work in the country of employment?','Yes']],
  };
  let failures = 0, passed = 0;
  const check=(label,ok)=>{ok?passed++:failures++;output.textContent+=`${ok?'PASS':'FAIL'} ${label}\n`;};
  const field=label=>scan.scanFields().find(f=>f.label.toLowerCase()===label.toLowerCase());
  async function write(label,value) {
    const f=field(label);check(`Find ${label}`,!!f);if(!f)return;
    const result=await act.applyWrite(f,value);check(`Write ${label}: ${result.reason || value}`,result.ok);
    const verified=await act.verifySettled(f,result.chosen || value);check(`Verify ${label}: ${verified.actual}`,verified.ok);
  }
  document.getElementById('run-compatibility').addEventListener('click',async event=>{
    event.target.disabled=true;output.textContent='';failures=0;passed=0;
    try {
      if(cases[name]) {
        check('Scanner finds at least six fields',scan.scanFields().length>=6);
        for(const [label,value] of cases[name]) await write(label,value);
        if(name==='ashby')check('Typeahead commits the site selection',window.__vals().schoolConfirmed===true);
        if(name==='greenhouse')check('Consent remains untouched',!document.getElementById('consent').checked);
        check('Navigation is correct',name==='taleo'?nav.findAdvanceControl()?.text==='Next':nav.findAdvanceControl()===null);
      } else if(name==='workday') {
        const answers={'Full legal name':'Fixture Person','Email address':'fixture@example.net','City and state':'Atlanta, Georgia',
          'Phone number':'4045550100','How did you hear about us?':'Company website','School or university':'SCAD','Degree':'BFA Game Design',
          'Graduation year':'2027','Skills':'React, Python','Portfolio or website':'https://example.net','LinkedIn profile':'https://linkedin.com/in/fixture',
          'Why do you want to work at Northwind Dynamics?':'This is a local test answer.', 'Are you legally authorized to work in the United States?':'Yes',
          'Will you now or in the future require visa sponsorship?':'No','Desired base salary (USD)':'120000','Gender':'I do not wish to answer',
          'Race / Ethnicity':'I do not wish to answer','Protected veteran status':'I am not a protected veteran','Disability status':'No, I do not have a disability'};
        for(let step=0;step<4;step++) {
          for(const f of scan.scanFields()) if(answers[f.label]) await write(f.label,answers[f.label]);
          const next=nav.findAdvanceControl({fields:scan.scanFields()});
          if(step<3)check(`Advance step ${step+1}`,!!next&&(await nav.advance(next,{timeout:4000})).ok);
          else check('Final submit is never an advance control',next===null);
        }
        check('All four wizard steps reached',window.__wizardState().step===3);
        check('Application has not been submitted',!window.__wizardState().submitted);
      } else {
        const fields=scan.scanFields();
        check('Secrets and hidden traps excluded',!fields.some(f=>['password','ssn','honeypot'].includes(f.el.id)));
        await write('Shadow name','Fixture Shadow');
        await write('Full name','Fixture Person');
        await write('Email','fixture@example.net');
        await write('City and state','Portland, Oregon');
        await write('Multiple technologies','React; Python');
        check('Both requested choices are actually selected',Array.from(document.getElementById('technologies').selectedOptions).map(o=>o.textContent).join('; ')==='React; Python');
        check('Overlong text is refused',!(await act.applyWrite(field('Short name'),'Jonathan')).ok);
        const controlled=field('Controlled input');
        await act.applyWrite(controlled,'Rejected write');
        check('Framework rejection detected',!(await act.verifySettled(controlled,'Rejected write')).ok);
        const upload=field('Resume');
        check('Wrong upload type refused',!(await act.attachFile(upload,new File(['text'],'fixture.txt',{type:'text/plain'}))).ok);
        check('File attachment succeeds',(await act.attachFile(upload,new File(['%PDF-fixture'],'fixture.pdf',{type:'application/pdf'}))).ok);
        check('File is present on the actual input',upload.el.files[0]?.name==='fixture.pdf');
        const next=nav.findAdvanceControl({fields:fields.filter(f=>f.el.closest('form')?.id==='application')});
        check('Pagination is not selected',next?.el.id==='next');
        check('Blocked wizard reports failure',!(await nav.advance(next,{timeout:700})).ok);
        const beforeUrl=location.href;
        const submitted=await nav.submitApplication({fields:fields.filter(f=>f.el.closest('form')?.id==='application'),timeout:800});
        check('Fixture actually changed URL',location.href!==beforeUrl);
        check('URL change alone does not prove submission',!submitted.ok && submitted.unknown===true);
      }
    } catch(error) {check(`Unhandled failure: ${error.message}`,false);}
    output.textContent+=`RESULT: ${failures?'FAIL':'PASS'} (${passed} checks passed, ${failures} failed)`;
  });
})();
