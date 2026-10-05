import { strict as assert } from 'node:assert';
import { levelFor, topicFor } from '../src/lib/policy';

for (const label of ['I agree to the privacy policy', 'I consent to processing', 'I certify that my answers are accurate']) {
  assert.equal(levelFor('customQuestion', label, 'select'), 'sensitive', label);
}
for (const label of ['Are you authorized to work in the US?', 'Are you authorised to work in the UK?']) {
  assert.equal(topicFor('customQuestion', label), 'workAuthorization', label);
  assert.equal(levelFor('customQuestion', label, 'select'), 'sensitive', label);
}
assert.equal(levelFor('customQuestion', 'Highest degree', 'select'), 'safe');
assert.equal(levelFor('customQuestion', 'Why this company?', 'textarea'), 'review');
assert.equal(levelFor('resume', 'Resume', 'file'), 'sensitive');
console.log('PASS: consent and cross-site work authorization policy');
