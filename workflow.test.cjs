const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fresh, apply, view } = require('./workflow.cjs');
const { rankProviders } = require('./partner.cjs');

function setup() {
  const state = fresh();
  const send = (role, action, value, revision = state.revision) => apply(state, { role, action, value, revision });
  send('tenant', 'trigger', 'There is no heating in my apartment.');
  send('tenant', 'answer', 'All radiators are cold and the thermostat is on.');
  send('tenant', 'submit', state.summary.summary);
  send('pm', 'select', 'craft_001');
  return { state, send };
}

test('provider eligibility and rank use the same deterministic rules on each run', () => {
  assert.equal(rankProviders('heating_repair')[0].id, 'craft_001');
  assert.equal(rankProviders('heating_repair').length, 3);
  assert.deepEqual(rankProviders('plumbing'), []);
  assert.deepEqual(rankProviders('heating_repair','Possible heating controls or boiler issue').map(item=>item.id), ['craft_002']);
  assert.equal(rankProviders('heating_repair','Single radiator not warming').some(item=>item.id==='craft_002'),false);
  const rated = rankProviders('heating_repair',null,{craft_001:[1]});
  assert(rated.find(item=>item.id==='craft_001').score < rankProviders('heating_repair')[0].score);
  assert.equal(rated.find(item=>item.id==='craft_001').rating,2.9);
});

test('scripted heating repair and separate invoice retain original references', () => {
  const { state, send } = setup();
  assert.equal(state.attempts.length, 1);
  const { payload } = view(state, 'partner').job;
  assert.equal(payload.unit_id, 'unit_4b');
  assert.equal(payload.contact_id, undefined);
  assert.equal(payload.resident_contact, undefined);
  send('partner', 'accept');
  assert.throws(() => send('partner', 'slots', ['2090-11-22T09:00', '2090-11-22T09:30']), /at least one hour apart/);
  send('partner', 'slots', ['2090-11-22T09:00', '2090-11-22T13:00']);
  send('tenant', 'book', 'slot_1');
  assert.throws(() => send('tenant', 'book', 'slot_2'), /case changed/);
  send('partner', 'complete', 'Replaced heating valve and tested the system.');
  assert.equal(state.stage, 'completed');
  assert.equal(state.invoice, undefined);
  assert.equal(state.result.maintenance_result.invoice_status, 'pending');
  assert.equal(state.result.maintenance_result.status, 'completed');
  assert.throws(() => send('partner','invoice','145.00'), /Upload/);
  send('partner','upload',{data:Buffer.from('%PDF-1.4').toString('base64')});
  send('partner', 'invoice', '145.00');
  assert.throws(() => send('partner', 'invoice', '145.00'), /case changed/);
  assert.equal(state.result.unit_id, 'unit_4b');
  assert.equal(state.result.maintenance_result.appointment.appointment_id, 'appt_001');
  assert.equal(state.result.maintenance_result.invoice.invoice_number, 'INV-'+new Date().getUTCFullYear()+'-501');
});

test('rejection preserves the case and offers the job directly to the replacement', () => {
  const { state, send } = setup();
  send('partner', 'reject', 'Unavailable.');
  send('pm', 'select', 'craft_002');
  assert.equal(view(state, 'partner').job.id, 'job_502');
  assert.equal(state.request.id, 'req_001');
  assert.equal(view(state, 'pm').history[0].status, 'rejected');
});
test('recognises indirect heating symptoms and asks for clarification when needed', () => {
  const assess = require('./intake.cjs');
  assert.equal(assess('All the rooms are freezing even with the dial turned up.').type, 'Heating not warming the home');
  assert.equal(assess('One radiator stays cold, but the others work.').type, 'Single radiator not warming');
  assert.equal(assess('The bedroom is cold.').type, undefined);
  assert.equal(assess('The boiler is working fine.').type, undefined);
  assert.equal(assess('Water is dripping under the kitchen sink.').unrelated, true);
  assert.equal(assess('My whole house is freezing cold even all the dials are up').type, 'Heating not warming the home');
  assert.equal(assess('room not getting warm, radiator is not making any sound').type, 'Heating not warming the home');
});


test('vague complaints reach manager review without automatically routing to a provider', () => {
  const state = fresh();
  const send = (role, action, value) => apply(state, {role,action,value,revision:state.revision});
  send('tenant','trigger','Something is wrong.');
  send('tenant','answer','I am not sure.');
  send('tenant','submit',state.summary.summary);
  assert.equal(state.summary.category,'unclassified');
  assert.deepEqual(state.recommendations,[]);
  assert.throws(() => send('pm','select','craft_001'), /Confirm heating/);
  send('pm','confirmHeating');
  send('pm','select','craft_001');
  assert.equal(state.stage,'offered');
});

test('clear descriptions skip follow-up and a manager can recover an exhausted boiler request', () => {
  const state = fresh();
  const send = (role,action,value) => apply(state,{role,action,value,revision:state.revision});
  send('tenant','trigger','Only the bedroom radiator is cold. All the others work.');
  assert.equal(state.stage,'summary');
  assert.equal(state.summary.problem_type,'Single radiator not warming');
  send('tenant','submit',state.summary.summary);
  send('pm','clarify','What does the boiler display?');
  send('tenant','reply','The boiler display shows an error.');
  assert.deepEqual(state.recommendations.map(p=>p.id),['craft_002']);
  send('pm','select','craft_002');
  send('partner','reject','Fully booked');
  send('pm','unavailable','Manager will check availability tomorrow.');
  assert.match(view(state,'tenant').managerNote,/tomorrow/);
  send('pm','clarify','Which radiator remains cold?');
  send('tenant','reply','Only the bedroom radiator is cold.');
  send('pm','select','craft_001');
  assert.equal(state.attempts.length,2);
});
test('a tenant can request new slots and past dates cannot be proposed', () => {
  const {state,send} = setup();
  send('partner','accept');
  assert.throws(()=>send('partner','slots',['2020-01-01T09:00','2020-01-01T12:00']),/future/);
  send('partner','slots',['2090-01-10T09:00','2090-01-10T12:00']);
  send('tenant','newSlots');
  assert.equal(state.stage,'accepted');
  assert.equal(state.slots,undefined);
  send('partner','slots',['2090-01-11T09:00','2090-01-11T12:00']);
  send('tenant','book','slot_2');
  assert.equal(state.stage,'scheduled');
});

test('voice intake keeps its case and shares confirmed appointment details without the transcript', () => {
  const state = fresh();
  const send = (role,action,value) => apply(state,{role,action,value,revision:state.revision});
  send('tenant','trigger',{method:'voice',description:'The bedroom radiator is cold, and I’m only home after four.'});
  const eventId = state.trigger.event_id;
  assert.equal(state.trigger.data.input_method,'voice');
  assert.equal(state.stage,'summary');
  assert.deepEqual(state.summary.details,{room:'bedroom',availableAfter:'16:00'});
  send('tenant','submit','The bedroom radiator is cold. I am home after 17:30. Private note.');
  send('pm','select','craft_001');
  const offer = view(state,'partner').job.payload;
  assert.equal(offer.service.affected_room,'bedroom');
  assert.deepEqual(offer.scheduling,{preferred_start_from:'17:30',timezone:'Europe/Berlin'});
  assert.equal(state.trigger.event_id,eventId);
  assert(!JSON.stringify(offer).includes('Private note'));
});

test('visit preference parsing ignores symptom timestamps and ambiguous multiple windows', () => {
  const { reportDetails } = require('./intake.cjs');
  assert.equal(reportDetails('My radiator only gets cold after four.').availableAfter,undefined);
  assert.equal(reportDetails('I am available after 4:30 p.m.').availableAfter,'16:30');
  assert.equal(reportDetails('I am available after 9 in the morning.').availableAfter,'09:00');
  assert.equal(reportDetails('I am available after 16:77.').availableAfter,undefined);
  assert.equal(reportDetails('I am home after 4 or available after 6.').availableAfter,undefined);
});
