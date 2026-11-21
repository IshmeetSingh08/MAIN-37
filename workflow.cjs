const centrix = require('./centrix.cjs');
const partner = require('./partner.cjs');
const assess = require('./intake.cjs');

const fresh = () => ({ stage: 'ready', revision: 0, attempts: [] });
const moves = {
  trigger: ['tenant', 'ready', 'intake'],
  revise: ['tenant', 'intake', 'intake'],
  answer: ['tenant', 'intake', 'summary'],
  submit: ['tenant', 'summary', 'review'],
  select: ['pm', 'review rejected consent unavailable', 'offered'],
  clarify: ['pm', 'review rejected unavailable', 'clarification'],
  reply: ['tenant', 'clarification', 'review'],
  unavailable: ['pm', 'review rejected', 'unavailable'],
  newSlots: ['tenant', 'slots', 'accepted'],
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
function summarize(state, assessment, observations, context) {
  return {
    title:(assessment.type ? 'Heating issue in ' : 'Maintenance request for ') + context.unit_label,
    summary:observations.join(' ').slice(0,1000), details:assess.reportDetails(observations.join(' ')), category:assessment.type ? 'heating' : 'unclassified',
    problem_type:assessment.type ?? 'Needs manager review', urgency:'unassessed',
    required_specialisation:assessment.type ? 'heating_repair' : null, observations,
    uncertain_details:['Cause and affected equipment are unconfirmed.']
  };
}
function eligibleRegistrations(state) {
  if (!['Heating not warming the home','Possible heating-system fault'].includes(state.summary?.problem_type)) return [];
  return (state.registrations ?? []).filter(item=>item.approved).map(({id,name,skills})=>({id,name,skills}));
}
function safeTitle(state) {
  const type = state.summary?.problem_type;
  return ['Single radiator not warming','Possible heating controls or boiler issue','Heating not warming the home','Possible heating-system fault'].includes(type) ? type : 'Heating repair';
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
  let nextStage = move[2];
  switch (action) {
    case 'trigger':
    case 'revise':
      {
        const method = action === 'revise' ? state.trigger.data.input_method : value?.method;
        const description = input(action === 'trigger' && typeof value === 'object' ? value?.description : value, 'maintenance description');
        state.assessment = assess(description);
        state.trigger = centrix.trigger(description, context, state.id);
        if (method === 'voice') state.trigger.data.input_method = method;
        if (state.assessment.complete || (method === 'voice' && (state.assessment.type || state.assessment.unrelated))) {
          state.summary = summarize(state,state.assessment,[description],context);
          nextStage = 'summary';
        }
      }
      break;
    case 'answer':
      state.answer = input(value, 'follow-up answer');
      {
      const initial = state.assessment ?? assess(state.trigger.data.initial_description);
      const response = assess(state.answer);
      const result = response.unrelated ? {} : response.type ? response : initial;
      state.summary = summarize(state,result,[state.trigger.data.initial_description,state.answer],context);
      }
      break;
    case 'submit':
      state.summary.summary = input(value, 'confirmed summary');
      const details = assess.reportDetails(state.summary.summary);
      state.summary.details = details;
      state.request = { id: 'req_' + (state.id ?? '001'), unit_id: context.unit_id, contact_id: context.contact_id, summary: state.summary };
      state.recommendations = partner.rankProviders(state.summary.required_specialisation, state.summary.problem_type);
      break;
    case 'confirmHeating':
      check(state.summary.category==='unclassified', 'This request is already classified.');
      Object.assign(state.summary,{category:'heating',problem_type:'Heating not warming the home',required_specialisation:'heating_repair'});
      state.recommendations=partner.rankProviders('heating_repair',state.summary.problem_type);
      break;
    case 'clarify':
      (state.clarifications ??= []).push({question:input(value,'question for the tenant')});
      break;
    case 'reply': {
      const exchange = state.clarifications.at(-1);
      exchange.answer = input(value,'reply');
      const assessment = assess(exchange.answer);
      if (assessment.type || assessment.unrelated) {
        state.summary = summarize(state,assessment,[state.summary.summary, exchange.answer],context);
        state.request.summary = state.summary;
        state.recommendations = partner.rankProviders(state.summary.required_specialisation,state.summary.problem_type);
      }
      break;
    }
    case 'unavailable': {
      const declined = new Set(state.attempts.filter(a=>a.job?.status==='rejected').map(a=>a.provider.id));
      const remaining = [...state.recommendations,...eligibleRegistrations(state)].some(p=>!declined.has(p.id));
      check(state.summary.category==='heating' && !remaining, 'Review the available specialists first.');
      state.managerNote = input(value,'next step for the tenant');
      break;
    }
    case 'newSlots':
      delete state.slots;
      state.requestedNewSlots = true;
      break;
    case 'select': {
      check(state.summary.category==='heating', 'Confirm heating before assigning a craftsman.');
      const approved = eligibleRegistrations(state);
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
      const proposed = partner.proposeSlots(value);
      check(proposed, 'Enter two future Berlin appointment times at least one hour apart.');
      state.slots = proposed;
      state.requestedNewSlots = false;
      break;
    case 'book': {
      const slot = state.slots.find(item => item.id === value);
      check(slot && Date.parse(slot.start) > Date.now(), 'Choose a future slot or request new times.');
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
      check(state.invoiceFile, 'Upload the invoice document before submitting it.');
      state.invoice = partner.submitInvoice(attempt.job, amount, state.id ?? '001');
      writeResult(state, attempt);
      break;
    }
  }
  state.stage = nextStage ?? state.stage;
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
  if (role === 'partner') {
    const job = attempt?.job;
    if (!job) return common;
    const p = job.payload;
    return { ...common, requestedNewSlots:state.requestedNewSlots, provider:attempt.provider,
      job:{id:job.id,status:job.status,payload:{
        schema_version:p.schema_version,event_id:p.event_id,idempotency_key:p.idempotency_key,
        correlation_id:p.correlation_id,request_id:p.request_id,unit_id:p.unit_id,partner_provider_id:p.partner_provider_id,
        created_at:p.created_at,service:{category:'heating',summary:safeTitle(state),affected_room:p.service.affected_room},
        scheduling:p.scheduling,
        property_context:{address:p.property_context.address,unit_label:p.property_context.unit_label},attachments:[]
      }}
    };
  }
  const { phone, ...displayContext } = state.context ?? centrix.getTenantContext();
  return {
    ...common, clarifications:state.clarifications, managerNote:state.managerNote, context: displayContext, trigger: state.trigger, question: state.assessment?.question, summary: state.summary, request: state.request?.id,
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
module.exports = { fresh, apply, view, safeTitle };
