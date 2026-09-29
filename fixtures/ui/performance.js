(() => {
  const metrics=document.createElement('p');metrics.id='performance-metrics';document.body.prepend(metrics);
  let started=0,first=0,finished=0,calls={};
  const show=()=>metrics.textContent=`Transport: classify=${calls.classify || 0}, agent=${calls.agent || 0}. First write: ${first || 'pending'}ms. Ready for review: ${finished || 'pending'}ms. Local fixture timing excludes a real network.`;
  document.addEventListener('fixture:transport',event=>{calls=event.detail;show();});
  document.getElementById('application').addEventListener('input',()=>{if(started&&!first){first=Math.round(performance.now()-started);show();}});
  const watch=new MutationObserver(()=>{
    const panel=document.getElementById('screenmate-root')?.shadowRoot;
    if(!panel)return;
    watch.disconnect();
    panel.addEventListener('click',event=>{
      if(event.target.closest('[data-act="run"]')){started=performance.now();first=0;finished=0;show();}
    },true);
    new MutationObserver(()=>{
      if(started&&!finished&&panel.querySelector('[data-act="acceptAll"]')){finished=Math.round(performance.now()-started);show();}
    }).observe(panel,{subtree:true,childList:true});
  });
  watch.observe(document.body,{subtree:true,childList:true});show();
})();
