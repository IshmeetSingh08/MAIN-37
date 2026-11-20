const centrix = require('./centrix.cjs');
const partner = require('./partner.cjs');
const assess = require('./intake.cjs');

const fresh = () => ({ stage: 'ready', revision: 0, attempts: [] });
const moves = {
  trigger: ['tenant', 'ready', 'intake'],
  revise: ['tenant', 'intake', 'intake'],
  answer: ['tenant', 'intake', 'summary'],
  submit: ['tenant', 'summary', 'review'],
  select: ['pm', 'review rejected consent', 'offered'],
  confirmHeating: ['pm', 'review', 'review'],
  accept: ['partner', 'offered', 'accepted'],
  reject: ['partner', 'offered', 'rejected'],
  slots: ['partner', 'accepted', 'slots'],
  book: ['tenant', 'slots', 'scheduled'],
  complete: ['partner', 'scheduled', 'completed'],
  upload: ['partner', 'completed invoiced', null],
  rate: ['tenant', 'completed invoiced', null],
  invoice: ['partner', 'completed', 'invoiced']
};

function check(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
function input(value, label) {
  check(typeof value === 'string' && value.trim() && value.length <= 1000, 'Enter a valid ' + label + '.');
  return value.trim();
}
function writeResult(state, attempt) {
  state.result = centrix.writeMaintenanceResult({
    request_id: state.request.id, partner: attempt.provider.name, partner_job_id: attempt.job.id,
    category: 'heating', status: 'completed', appointment: state.appointment, completion_report: state.report,
    invoice: state.invoice ?? null, invoice_status: state.invoice ? 'submitted' : 'pending',
    consent: attempt.consent, written_back_at: new Date().toISOString()
  }, state.context);
}
function apply(state, { role, action, value, revision }) {
  const context = state.context ?? centrix.getTenantContext();
  const move = Object.hasOwn(moves, action) && moves[action];
  check(move && move[0] === role, 'Switch to the appropriate demo role.', 403);
  check(revision === state.revision && move[1].split(' ').includes(state.stage), 'The case changed. Review the latest state.', 409);
  const attempt = state.attempts.at(-1);
  switch (action) {
    case 'trigger':
    case 'revise':
      {
        const description = input(value, 'maintenance description');
        state.assessment = assess(description);
        state.trigger = centrix.trigger(description, context, state.id);
      }
      break;
    case 'answer':
      state.answer = input(value, 'follow-up answer');
      {
      const initial = state.assessment ?? assess(state.trigger.data.initial_description);
      const response = assess(state.answer);
      const result = response.unrelated ? {} : response.type ? response : initial;
      state.summary = {
        title: (result.type ? 'Heating issue in ' : 'Maintenance request for ') + context.unit_label, summary: state.trigger.data.initial_description + ' Follow-up: ' + state.answer,
        category: result.type ? 'heating' : 'unclassified', problem_type: result.type ?? 'Needs manager review', urgency: result.type ? 'high' : 'unassessed',
        required_specialisation: result.type ? 'heating_repair' : null, observations: [state.trigger.data.initial_description, state.answer],
        uncertain_details: ['Cause and affected equipment are unconfirmed.']
      };
      }
      break;
    case 'submit':
      state.summary.summary = input(value, 'confirmed summary');
      state.request = { id: 'req_' + (state.id ?? '001'), unit_id: context.unit_id, contact_id: context.contact_id, summary: state.summary };
      state.recommendations = partner.rankProviders(state.summary.required_specialisation, state.summary.problem_type);
      break;
    case 'confirmHeating':
      check(state.summary.category==='unclassified', 'This request is already classified.');
      Object.assign(state.summary,{category:'heating',problem_type:'Heating not warming the home',required_specialisation:'heating_repair'});
      state.recommendations=partner.rankProviders('heating_repair',state.summary.problem_type);
      break;
    case 'select': {
      check(state.summary.category==='heating', 'Confirm heating before assigning a craftsman.');
      const approved = (state.registrations ?? []).filter(item => item.approved &&
        ['Heating not warming the home','Possible heating-system fault'].includes(state.summary.problem_type))
        .map(({ id, name, skills }) => ({ id, name, skills }));
      const provider = [...state.recommendations, ...approved].find(item => item.id === value);
      check(provider && !state.attempts.some(item => item.provider.id === value && item.job?.status === 'rejected'), 'Choose an eligible provider that has not rejected the case.');
      const assignment = { number:state.attempts.length+1, provider };
      assignment.job=partner.createJob(state.request,assignment,context);
      state.attempts.push(assignment);
      break;
    }
    case 'accept':
    case 'reject':
      partner.respond(attempt.job, action === 'accept', action === 'reject' ? input(value, 'rejection reason') : undefined);
      break;
    case 'slots':
      state.slots = partner.proposeSlots(value);
      check(state.slots, 'Enter two valid Berlin appointment times at least one hour apart.');
      break;
    case 'book': {
      const slot = state.slots.find(item => item.id === value);
      check(slot, 'Choose one of the proposed slots.');
      state.appointment = partner.confirmAppointment(slot, state.id);
      break;
    }
    case 'complete':
      state.report = partner.complete(input(value, 'completion report'), state.id);
      writeResult(state, attempt);
      break;
    case 'rate':
      check(!state.rating && /^[1-5]$/.test(String(value)), 'Choose a rating from one to five. Each completed repair can be rated once.');
      state.rating = Number(value);
      break;
    case 'upload': {
      check(typeof value?.data === 'string' && value.data.length <= 2800000, 'Choose a PDF, PNG or JPEG up to 2 MB.');
      const bytes = Buffer.from(value.data, 'base64');
      const format = bytes.subarray(0,5).toString() === '%PDF-' ? ['pdf','application/pdf'] :
        bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' ? ['png','image/png'] :
        bytes.subarray(0,3).toString('hex') === 'ffd8ff' ? ['jpg','image/jpeg'] : null;
      check(format && bytes.length <= 2097152, 'Choose a PDF, PNG or JPEG up to 2 MB.');
      state.invoiceFile = { name:'invoice.'+format[0], type:format[1], data:bytes.toString('base64') };
      break;
    }
    case 'invoice': {
      const amount = Number(value);
      check(/^\d+(\.\d{1,2})?$/.test(String(value)) && amount > 0 && amount <= 10000, 'Enter a valid invoice amount.');
      state.invoice = partner.submitInvoice(attempt.job, amount);
      writeResult(state, attempt);
      break;
    }
  }
  state.stage = move[2] ?? state.stage;
  state.revision++;
  return state;
}
function view(state, role) {
  check(['tenant', 'pm', 'partner'].includes(role), 'Unknown demo role.');
  const attempt = state.attempts.at(-1);
  const common = {
    stage: state.stage, revision: state.revision, slots: state.slots, appointment: state.appointment,
    report: state.report, invoice: state.invoice, rating: state.rating,
    invoiceFile: state.invoiceFile && (role==='partner'||state.invoice) ? state.invoiceFile.name : undefined
  };
  if (role === 'partner') return { ...common, job: attempt?.job, provider: attempt?.job && attempt.provider };
  const { phone, ...displayContext } = state.context ?? centrix.getTenantContext();
  return {
    ...common, context: displayContext, trigger: state.trigger, question: state.assessment?.question, summary: state.summary, request: state.request?.id,
    provider: attempt?.provider, result: state.result, declined: attempt?.declined,
    ...(role === 'pm' ? {
      recommendations: state.recommendations,
      history: state.attempts.map(item => ({
        provider: item.provider.name, providerId: item.provider.id, reason: item.job?.reason,
        status: item.job?.status ?? (item.declined ? 'Consent declined' : 'Awaiting consent'), jobId: item.job?.id
      }))
    } : {})
  };
}
module.exports = { fresh, apply, view };
