const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {}, chrome: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/content/prefs.js'), 'utf8'), context);
const { resolveProfile, profileCandidates, profileOption, queryFor, resolve } = context.window.__screenmatePrefs;
const field = (label, options, extra = {}) => ({ label, type: options ? 'select' : 'text', options, value: '', ...extra });
const value = (label, profile, options, extra) => resolveProfile(field(label, options, extra), profile)?.value ?? null;

test('copies explicit personal facts with provenance and never splits a full name', () => {
  const profile = { name: 'Morgan Lee', firstName: 'Morgan', lastName: 'Lee', email: 'morgan@example.test' };
  assert.equal(value('Full legal name', profile), 'Morgan Lee');
  assert.equal(value('First and last name', profile), 'Morgan Lee');
  assert.equal(value('First name', profile), 'Morgan');
  assert.equal(value('Surname', profile), 'Lee');
  assert.equal(value('First name', { name: 'Morgan Lee' }), null);
  assert.equal(resolveProfile(field('Email'), profile).sourceKey, 'email');
  assert.equal(profileCandidates(field('Full name'), profile)[0].kind, 'name');
});

test('uses autocomplete metadata only when it does not conflict with the question', () => {
  const profile = { firstName: 'Morgan', country: 'Canada', city: 'Toronto' };
  assert.equal(value('Question 15', profile, undefined, { autocomplete: 'section-applicant given-name' }), 'Morgan');
  assert.equal(value('Country', profile, undefined, { autocomplete: 'address-level2' }), null);
  assert.equal(value('City', profile, undefined, { autocomplete: 'address-level2' }), 'Toronto');
});

test('country choices never use a state, city, or parsed location', () => {
  assert.equal(value('Country', { country: 'USA', state: 'Georgia' }, ['Georgia', 'United States']), 'United States');
  assert.equal(value('Country', { state: 'Georgia', location: 'Atlanta, Georgia' }, ['Georgia', 'United States']), null);
  assert.equal(value('City', { location: 'Atlanta, Georgia' }), null);
  assert.equal(value('City and region', { location: 'Atlanta, Georgia', state: 'Georgia' }), 'Atlanta, Georgia');
});

test('country aliases match only a unique actual option and preserve its label', () => {
  assert.equal(value('Country', { country: 'U.S.A.' }, ['Canada', 'United States of America']), 'United States of America');
  assert.equal(value('Country', { country: 'United States' }, ['United States (USA)', 'Canada']), 'United States (USA)');
  assert.equal(value('Country', { country: 'UK' }, ['France', 'United Kingdom']), 'United Kingdom');
  assert.equal(value('Country', { country: 'USA' }, ['United States', 'United States of America']), null);
  assert.equal(value('Country', { country: 'USA' }, ['USA', 'United States']), 'USA');
});

test('state and province abbreviations require explicit matching country context', () => {
  assert.equal(value('State', { country: 'USA', state: 'GA' }, ['Florida', 'Georgia']), 'Georgia');
  assert.equal(value('State', { country: 'United States', state: 'Georgia' }, ['GA', 'FL']), 'GA');
  assert.equal(value('Province', { country: 'Canada', state: 'QC' }, ['Ontario', 'Québec']), 'Québec');
  assert.equal(value('State', { state: 'GA' }, ['Georgia']), null);
  assert.equal(value('State', { country: 'Canada', state: 'GA' }, ['Georgia']), null);
  assert.equal(value('Country', { country: 'US', state: 'CA' }, ['Canada', 'United States']), 'United States');
});

test('degree level, school, major, and minor use separate source facts', () => {
  const profile = { degree: 'BFA Game Design', university: 'SCAD', fieldOfStudy: 'Game Design', minor: 'Applied AI' };
  assert.equal(value('Highest level of education', profile, ["Bachelor's degree", "Master's degree"]), "Bachelor's degree");
  assert.equal(value('Degree', { degree: 'B.S. Computer Science' }, ['Bachelor', 'Master']), 'Bachelor');
  assert.equal(value('Field of study', profile, ['Computer Science', 'Game Design']), 'Game Design');
  assert.equal(value('Minor', profile), 'Applied AI');
  assert.equal(value('School', profile), 'SCAD');
  assert.equal(value('Major', { degree: 'BFA Game Design' }, ['Game Design']), null);
  assert.equal(value('Years of education', profile, ['Bachelor', 'Master']), null);
  assert.equal(value('Highest degree', { degree: 'Design certification' }, ["Bachelor's degree", "Master's degree"]), null);
  assert.equal(value('Degree', { degree: 'BSc and MSc Computer Science' }, ['Bachelor', 'Master']), null);
  assert.equal(value('Degree', profile, ['Bachelor of Science', 'Bachelor of Arts']), null);
});

test('school acronyms require an explicit, unique parenthetical label on the page', () => {
  assert.equal(value('University', { university: 'SCAD' }, ['Savannah College of Art and Design (SCAD)', 'Other']), 'Savannah College of Art and Design (SCAD)');
  assert.equal(value('University', { university: 'MIT' }, ['Massachusetts Institute of Technology (MIT)', 'Other Institute (MIT)']), null);
  assert.equal(value('University', { university: 'SCAD' }, ['Savannah College of Art and Design']), null);
});

test('existing, sensitive, narrative, history and reference fields remain unchanged', () => {
  const profile = { name: 'Morgan Lee', firstName: 'Morgan', email: 'morgan@example.test', country: 'Canada', university: 'SCAD' };
  for (const label of ['Reference name', 'Supervisor email', 'Emergency contact name', 'Previous school', 'Employer country', 'Company name', 'Citizenship country']) {
    assert.equal(value(label, profile), null, label);
  }
  assert.equal(value('Name', profile, undefined, { context: 'References' }), null);
  assert.equal(value('Full name', profile, undefined, { value: 'My own edit' }), null);
  assert.equal(value('Full name', profile, undefined, { sensitive: true }), null);
  assert.equal(value('Full name', profile, undefined, { level: 'sensitive' }), null);
  assert.equal(value('Full name', profile, undefined, { type: 'textarea' }), null);
  assert.equal(value('Middle name', profile, undefined, { autocomplete: 'given-name' }), null);
});

test('explicit address fields copy separately without inferring missing components', () => {
  const profile = { city: 'Toronto', state: 'Ontario', postalCode: 'M5V 1A1', addressLine1: '123 Example Street', addressLine2: 'Unit 4' };
  assert.equal(value('City', profile), 'Toronto');
  assert.equal(value('Postal code', profile), 'M5V 1A1');
  assert.equal(value('Address line 1', profile), '123 Example Street');
  assert.equal(value('Address line 2', profile), 'Unit 4');
  assert.equal(value('Address line 2', { addressLine1: '123 Example Street, Unit 4' }), null);
});

test('graduation year may be extracted, but full date inputs never invent month or day', () => {
  assert.equal(value('Graduation year', { graduationDate: 'Expected May 2027' }, ['2026', '2027', '2028']), '2027');
  assert.equal(value('Graduation year', { graduationDate: '2023–2027' }, ['2023', '2027']), null);
  assert.equal(value('Graduation date', { graduationDate: '2027' }, undefined, { inputType: 'date' }), null);
  assert.equal(value('Graduation date', { graduationDate: '2027-05-20' }, undefined, { inputType: 'date' }), '2027-05-20');
  assert.equal(value('Graduation date', { graduationDate: '2027-02-30' }, undefined, { inputType: 'date' }), null);
  assert.equal(value('Graduation date', { graduationDate: '2027-05' }, undefined, { inputType: 'month' }), '2027-05');
});

test('phone categories preserve Mobile defaults without selecting unrelated devices', () => {
  assert.equal(profileOption(field('Phone type', ['Home', 'Cellular', 'Work']), {}), 'Cellular');
  assert.equal(profileOption(field('Device Type', ['Mobile', 'Home', 'Work']), {}), 'Mobile');
  assert.equal(profileOption(field('Computer device type', ['Desktop', 'Mobile']), {}), null);
  assert.equal(profileOption(field('Phone type', ['Mobile', 'Cell', 'Home']), {}), null);
  assert.equal(value('Phone type', { phoneType: 'Home' }, ['Mobile', 'Home', 'Work']), 'Home');
  assert.equal(value('Phone number', { phone: '+1 202-555-0123' }), '+1 202-555-0123');
  assert.equal(value('Phone country code', { phone: '+1 202-555-0123' }), null);
});

test('skills match an unambiguous choice and never use fuzzy substring matching', () => {
  const profile = { skills: ['React', 'Python'] };
  assert.equal(value('Skills', profile), 'React, Python');
  assert.equal(value('Primary skill', profile, ['React', 'Python']), null);
  assert.equal(value('Primary skill', profile, ['React Native', 'Go']), null);
  assert.equal(value('Primary skill', profile, ['React', 'Go']), 'React');
});

test('search queries use known facts and canonical saved decisions only', () => {
  assert.equal(queryFor(field('Country', []), { country: 'US' }), 'United States');
  assert.equal(queryFor(field('School', []), { university: 'SCAD' }), 'SCAD');
  assert.equal(queryFor(field('Primary skill', []), { skills: ['React', 'Python'] }), null);
  assert.equal(queryFor(field('Country', [], { value: 'Canada' }), { country: 'US' }), null);
  const sponsorship = field('Will you require sponsorship?', [], { sensitive: true, topic: 'sponsorship' });
  assert.equal(queryFor(sponsorship, {}, { sponsorship: 'No' }), 'No');
  assert.equal(queryFor({ ...sponsorship, label: 'Can you work without requiring sponsorship?' }, {}, { sponsorship: 'No' }), null);
  assert.equal(resolve({ ...sponsorship, options: ['Yes', 'No'] }, { sponsorship: 'No' }).value, 'No');
});

test('state search expands aliases only within the explicitly saved country', () => {
  assert.equal(queryFor(field('State', []), { country: 'USA', state: 'GA' }), 'Georgia');
  assert.equal(queryFor(field('Province', []), { country: 'Canada', state: 'ON' }), 'Ontario');
  assert.equal(queryFor(field('Province', []), { country: 'CAN', province: 'QC' }), 'Quebec');
  assert.equal(queryFor(field('State', []), { state: 'GA' }), 'GA');
  assert.equal(queryFor(field('Province', []), { country: 'Canada', state: 'GA' }), 'GA');
  assert.equal(queryFor(field('State', []), { country: 'USA', state: 'GA', province: 'CA' }), null);
});

test('generic highest-degree search uses a supported level without guessing a qualification', () => {
  assert.equal(queryFor(field('Highest degree', []), { degree: 'BFA Game Design' }), 'Bachelor');
  assert.equal(queryFor(field('Highest level of education', []), { degree: 'M.Sc. Computer Science' }), 'Master');
  assert.equal(queryFor(field('Degree level', []), { degree: 'Ph.D. Physics' }), 'Doctorate');
  assert.equal(queryFor(field('Degree', []), { degree: 'BFA Game Design' }), 'BFA Game Design');
  assert.equal(queryFor(field('Highest degree', []), { degree: 'Design certification' }), 'Design certification');
  assert.equal(queryFor(field('Highest degree', []), { degree: 'BSc and MSc Computer Science' }), null);
  assert.equal(queryFor(field('Field of study', []), { degree: 'BFA Game Design' }), null);
});

test('expanded search hints never substitute for resolving an actual option', () => {
  const profile = { country: 'USA', state: 'GA', degree: 'BFA Game Design' };
  assert.equal(queryFor(field('State', []), profile), 'Georgia');
  assert.equal(value('State', profile, ['Georgia', 'GA']), 'GA');
  assert.equal(value('State', profile, ['Georgia', 'Georgia']), null);
  assert.equal(queryFor(field('Highest degree', []), profile), 'Bachelor');
  assert.equal(value('Highest degree', profile, ["Bachelor's degree", "Master's degree"]), "Bachelor's degree");
  assert.equal(value('Highest degree', profile, ['Bachelor of Science', 'Bachelor of Arts']), null);
  assert.equal(value('Highest degree', profile, ['Bachelor', "Bachelor's degree"]), null);
});
