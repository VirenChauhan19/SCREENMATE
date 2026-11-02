// Real backend/model check using a synthetic applicant and fictional jobs.
// No employer page is opened, and no application is submitted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('@next/env').loadEnvConfig(process.cwd());
const base = process.env.SCREENMATE_TEST_URL || 'http://127.0.0.1:3000';
const profile = {
  name: 'Morgan Example', email: 'morgan@example.test',
  degree: 'BSc Computer Science', skills: ['React', 'TypeScript', 'Python', 'SQL'],
  professionalSummary: 'Software developer interested in accessible interfaces and dependable data tools.',
  projects: 'Built a React and TypeScript inventory dashboard with keyboard navigation and clear validation messages. Built a Python CSV validation tool that checks missing values and duplicate records before importing data into SQL.',
};
const jobs = [
  { company: 'Cedar Tools', jobTitle: 'Frontend Engineer', jobDescription: 'Cedar Tools builds inventory software for warehouse teams. This role builds accessible React and TypeScript dashboards, keyboard navigation and clear validation feedback.', match: /React|TypeScript|dashboard|keyboard|accessib/i },
  { company: 'River Analytics', jobTitle: 'Data Engineer', jobDescription: 'River Analytics builds data tools for analysts. This role builds Python ingestion pipelines, validates incoming CSV records, catches duplicate and missing values, and loads clean records into SQL.', match: /Python|CSV|SQL|pipeline|data validation/i },
];
async function post(route, payload) {
  const response = await fetch(base + '/api/' + route, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-screenmate-key': process.env.SCREENMATE_API_KEY || '' }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200, route + ' response status');
  return response.json();
}
const question = { id: 'interest', label: 'Why are you interested in this role?', type: 'text', required: true, maxLength: 320, instructions: 'Maximum 60 words.' };
const payload = (job, field, applicant = profile) => ({ phase: 'act',
  applicationState: { ...job, fields: [{ ...field, section: 'role', value: null }], completedFields: 0, totalFields: 1, validationErrors: [] }, profile: applicant, research: null, recentActions: [],
});
(async () => {
  const classified = await post('classify', { fields: [question] });
  assert.equal(classified.fields[0].narrative, true);
  assert.equal(classified.fields[0].maxLength, 320);
  const answers = [];
  for (const job of jobs) {
    const result = await post('agent', payload(job, classified.fields[0]));
    const action = result.actions.find(item => item.tool === 'fillField' && item.args.fieldId === question.id);
    assert.ok(action, job.company + ': answer should fill directly; received ' + JSON.stringify(result));
    const answer = action.args.value;
    assert.ok(answer.length <= 320 && answer.trim().split(/\s+/).length <= 60, 'employer field limits');
    assert.match(answer, job.match);
    assert.equal(result.actions.some(item => item.tool === 'requestUserApproval'), false, 'known facts need no permission prompt');
    assert.doesNotMatch(answer, /\b\d+\s+years\b/i, 'no invented years of experience');
    assert.doesNotMatch(answer, /(?:I(?:'ve| have) built|I (?:built|developed))[^.!?]*inventory dashboards\b/i, 'one project must not become several projects');
    assert.doesNotMatch(answer, new RegExp(jobs.find(other => other !== job).company, 'i'), 'no stale company context');
    answers.push({ company: job.company, role: job.jobTitle, answer, characters: answer.length });
    console.log('PASS personalized direct answer: ' + job.jobTitle + ' (' + answer.length + ' characters)');
  }
  assert.notEqual(answers[0].answer, answers[1].answer, 'the answer must change with the actual role');
  const missing = await post('agent', payload(jobs[0], { id: 'example', label: 'Describe a time you led a team through a failure', type: 'textarea', required: true, sensitive: false, level: 'review' }, { name: profile.name, skills: ['React'] }));
  assert.equal(missing.actions[0].tool, 'requestUserApproval');
  console.log('PASS missing personal history requests a real example');
  const mixedPayload = payload(jobs[1], { id: 'project', label: 'Describe a project that demonstrates skills relevant to this role.', type: 'textarea', required: true, sensitive: false, level: 'review', maxLength: 800 });
  mixedPayload.applicationState.fields.push({ id: 'leadership', label: 'Tell us about a time you led a team through a failure.', type: 'textarea', section: 'role', value: null, required: true, sensitive: false, level: 'review', maxLength: 800 });
  mixedPayload.applicationState.totalFields = 2;
  const mixed = await post('agent', mixedPayload);
  const project = mixed.actions.find(item => item.tool === 'fillField' && item.args.fieldId === 'project');
  assert.ok(project, 'a supported project question fills automatically');
  assert.match(project.args.value, /Python|CSV|SQL/i);
  assert.ok(project.args.value.length <= 800);
  assert.doesNotMatch(project.args.value, /data transformation|query optimi[sz]ation|deployed|production pipeline/i, 'skills and a basic validator do not establish unstated task history');
  assert.ok(mixed.actions.some(item => item.tool === 'requestUserApproval' && item.args.fieldId === 'leadership'), 'unrelated projects cannot establish a missing leadership story');
  assert.equal(mixed.actions.some(item => item.tool === 'fillField' && item.args.fieldId === 'leadership'), false);
  console.log('PASS mixed application fills a supported project answer and asks for the missing leadership example');
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync('dist/personalized-answer-check.json', JSON.stringify({ syntheticApplicant: true, fictionalJobs: true, liveEmployerTest: false, answers, projectAnswer: project.args.value, missingLeadershipRequested: true }, null, 2));
  console.log('Saved dist/personalized-answer-check.json');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
