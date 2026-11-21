const providers = [
  { id: 'craft_001', name: 'Müller Heiztechnik', skills: ['heating_repair'], availability: 'This week', availableScore: 80, km: 3.2, rating: 4.8, estimate: 145 },
  { id: 'craft_002', name: 'WärmeFix GmbH', skills: ['heating_systems'], availability: 'This week', availableScore: 80, km: 5.1, rating: 4.6, estimate: 160 },
  { id: 'craft_003', name: 'ThermoService', skills: ['heating_repair', 'plumbing'], availability: 'Next 2 days', availableScore: 100, km: 7.4, rating: 4.4, estimate: 135 }
];
const compatible = { heating_repair: ['heating_repair', 'heating_systems'] };
const specialties = {
  craft_001: ['Whole-home heating', 'Radiators and valves'],
  craft_002: ['Whole-home heating', 'Boilers and controls'],
  craft_003: ['Whole-home heating', 'Radiators and valves', 'Plumbing']
};
const specialtyFor = type => type === 'Single radiator not warming' ? 'Radiators and valves'
  : type === 'Possible heating controls or boiler issue' ? 'Boilers and controls' : 'Whole-home heating';
exports.providerName = id => providers.find(provider => provider.id === id)?.name;

exports.rankProviders = (specialisation, type, reviews = {}) => providers
  .filter(provider => provider.skills.some(skill => compatible[specialisation]?.includes(skill)))
  .filter(provider => !type || specialties[provider.id].includes(specialtyFor(type)))
  .map(provider => {
    const ratings = reviews[provider.id] ?? [];
    const rating = (provider.rating + ratings.reduce((sum, value) => sum + value, 0)) / (ratings.length + 1);
    return {
      ...provider, rating:Number(rating.toFixed(1)), reviewCount:ratings.length,
      specialties: specialties[provider.id], matchedSpecialty: specialtyFor(type),
      score: Math.round(0.25 * provider.availableScore + 0.35 * (100 - 10 * provider.km)
        + 0.25 * rating * 20 + 0.15 * (200 - provider.estimate))
    };
  })
  .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  .slice(0, 3);

exports.createJob = (request, attempt, context) => {
  return {
    id: request.id === 'req_001' ? 'job_' + (500 + attempt.number) : 'job_' + request.id + '_' + attempt.number,
    status: 'offered',
    payload: {
      schema_version: '1.0', event_id: 'evt_offer_' + request.id + '_' + attempt.number,
      idempotency_key: request.id + ':offer:' + attempt.number + ':v1',
      correlation_id: 'corr_' + request.id, request_id: request.id,
      unit_id: context.unit_id, partner_provider_id: attempt.provider.id,
      created_at: new Date().toISOString(),
      service: { category:'heating', summary:request.summary.problem_type, affected_room:request.summary.details?.room },
      ...(request.summary.details?.availableAfter ? {
        scheduling:{preferred_start_from:request.summary.details.availableAfter, timezone:'Europe/Berlin'}
      } : {}),
      property_context: { address: context.address, unit_label: context.unit_label },
      attachments: []
    }
  };
};
exports.respond = (job, accepted, reason) => {
  job.status = accepted ? 'accepted' : 'rejected';
  if (!accepted) job.reason = reason;
};
const berlin = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short'
});
exports.proposeSlots = (inputs) => {
  if (!Array.isArray(inputs) || inputs.length !== 2) return null;
  const starts = inputs.map(value => {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return NaN;
    const naive = Date.parse(value + 'Z');
    const candidates = [naive - 3600000, naive - 7200000].filter(time =>
      Number.isFinite(time) && berlin.format(time).replace(' ', 'T') === value);
    return candidates.length === 1 ? candidates[0] : NaN;
  });
  if (starts.some(time => !Number.isFinite(time) || time <= Date.now()) || Math.abs(starts[0] - starts[1]) < 3600000) return null;
  return starts.sort((a,b) => a-b).map((time,index) => ({
    id: 'slot_' + (index + 1), start: new Date(time).toISOString(), end: new Date(time + 3600000).toISOString()
  }));
};
exports.confirmAppointment = (slot, id = '001') => ({ ...slot, appointment_id: 'appt_' + id, status: 'confirmed', timezone: 'Europe/Berlin' });
exports.complete = (work, id = '001') => ({ report_id: id==='001'?'report_501':'report_'+id, work_done: work, completed_at: new Date().toISOString() });
exports.submitInvoice = (job, amount, caseId) => {
  const issued = new Date().toISOString();
  return {
    invoice_id:'inv_' + job.id.slice(4), invoice_number:'INV-' + issued.slice(0,4) + '-' + job.id.slice(4),
    amount, currency:'EUR', issued_at:issued, status:'submitted',
    document_ref:'/api/demo/invoice?case=' + encodeURIComponent(caseId), partner_job_id:job.id
  };
};
