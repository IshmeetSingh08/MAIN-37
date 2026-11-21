const panel = document.querySelector('#panel');
const error = document.querySelector('#error');
const notificationPanel = document.querySelector('#notifications');
const notificationLink = document.querySelector('#notification-link');
const tracking = location.pathname === '/tenant/repair';
let audio;
let alertIds = [];
let previousUnread = [];
let pendingChime = false;
document.addEventListener('pointerdown', () => {
  if (!window.AudioContext) return;
  audio ??= new AudioContext();
  audio.resume().then(() => {
    if (pendingChime) chime();
  }).catch(() => {});
});
function chime() {
  pendingChime = audio?.state !== 'running';
  if (pendingChime) return;
  const tone = audio.createOscillator();
  const volume = audio.createGain();
  tone.frequency.value = 740;
  volume.gain.setValueAtTime(.055,audio.currentTime);
  volume.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.22);
  tone.connect(volume).connect(audio.destination);
  tone.start();
  tone.stop(audio.currentTime+.23);
}
const roles = {tenant:'Tenant',pm:'Property Manager',partner:'Craftsman'};
const statusLabels = {clarification:'Waiting for tenant details',unavailable:'No specialist available',unassigned:'No assigned unit',ready:'Ready to report',intake:'Intake in progress',summary:'Review summary',review:'Awaiting provider selection',consent:'Awaiting provider selection',offered:'Job offered',accepted:'Job accepted',rejected:'Partner declined',slots:'Slots available',scheduled:'Appointment confirmed',completed:'Task completed — invoice pending',invoiced:'Invoice submitted · Result linked'};
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (action,label,value='') => '<button class="primary" data-action="'+action+'" data-value="'+html(value)+'">'+html(label)+'</button>';
const form = (action,label,value,submit) => '<form data-action="'+action+'"><label>'+label+'<textarea name="value" required maxlength="1000">'+html(value)+'</textarea></label><button type="submit" class="primary">'+submit+'</button></form>';
const details = (title,data) => '<details><summary>'+title+'</summary><pre>'+html(JSON.stringify(data,null,2))+'</pre></details>';
const format = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'});
const time = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',timeStyle:'short'});
const slot = item => format.format(new Date(item.start))+'–'+time.format(new Date(item.end));
let state;
let busy = false;

function centrixEvent(s) {
  if (!s.trigger || !s.context) return '';
  return '<section class="integration-card"><span class="pill">SIMULATED CENTRIX EVENT</span><h3>Tenant report received</h3><p>Centrix resolved <strong>'+html(s.context.unit_label)+'</strong> at '+html(s.context.address)+' from the tenant portal session.</p>'+details('Inspect trigger event',s.trigger)+'</section>';
}

function unitRecord(s, download) {
  if (!s.result) return '';
  const { maintenance_result:record } = s.result;
  return '<section class="integration-card unit-record"><span class="pill">SIMULATED CENTRIX WRITE-BACK</span><h3>'+html(s.context?.unit_label ?? 'Unit')+' maintenance record</h3><p>'+html(s.context?.address)+'</p><dl><dt>Repair</dt><dd>Completed by '+html(record.partner)+'</dd><dt>Appointment</dt><dd>'+html(slot(record.appointment))+' (Berlin)</dd><dt>Work completed</dt><dd>'+html(record.completion_report.work_done)+'</dd><dt>Invoice</dt><dd>'+(record.invoice?html(record.invoice.invoice_number)+' · €'+record.invoice.amount.toFixed(2):'Invoice pending')+'</dd></dl>'+download+details('View simulated '+html(s.context?.unit_label ?? 'unit')+' write-back',s.result)+'</section>';
}

const VoiceRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
function voiceForm(action,label,submit) {
  const answer = action === 'answer';
  const micLabel = answer ? 'Speak your answer' : 'Use microphone';
  return '<form data-action="'+action+'"><label for="voice-text">'+label+'</label>'
    +'<div class="voice-input"><textarea id="voice-text" name="value" required maxlength="1000"></textarea>'
    +'<button type="button" class="quiet mic-button" data-voice="record" aria-pressed="false" aria-label="'+micLabel+'" title="'+micLabel+'">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6"/></svg></button>'
    +'</div>'
    +'<p class="muted voice-note">Speak in English. Your browser may process audio online. Review the text before continuing.</p><p role="status" class="voice-status"></p>'
    +(answer && window.speechSynthesis ? '<button type="button" class="quiet" data-read-question>Read question aloud</button>' : '')
    +'<button type="submit" class="primary">'+submit+'</button></form>';
}
function reportFields(details) {
  if (!details?.room && !details?.availableAfter) return '';
  return '<div class="voice-details"><strong>Details picked up from your report</strong>'
    +(details.room?'<p>Affected radiator · '+html(details.room)+'</p>':'')
    +(details.availableAfter?'<p>Preferred visit start · '+html(details.availableAfter)+' or later (Berlin time)</p>':'')
    +'<p class="muted">Edit the summary below if either detail needs correcting.</p></div>';
}

function tenant(s) {
  switch(s.stage) {
    case 'unassigned': return '<h2>Your account is ready</h2><p>A property manager must assign you to a unit before you can report a repair. Use the demo tenant to explore Unit 4B.</p>';
    case 'ready': return '<h2>Report a maintenance issue</h2><p>The demo currently supports heating repairs.</p>'+voiceForm('trigger','Describe what’s wrong in your own words','Continue');
    case 'intake': {
      const wasSpoken = s.trigger.data.input_method === 'voice';
      const answerForm = (wasSpoken ? voiceForm('answer','Your answer','Generate summary') : form('answer','Your answer','','Generate summary'))
        .replace('<button type="submit"','<div class="intake-actions"><button type="submit"')
        .replace('</button></form>','</button><button type="button" class="quiet" data-action="answer" data-value="I’m not sure">I’m not sure</button></div></form>');
      return '<h2>Tell us about the heating</h2><p class="pill">Symptom-based intake · Demo mode</p><blockquote>'+html(s.trigger.data.initial_description)+'</blockquote><p id="intake-question">'+html(s.question || 'What did you notice, and where is the problem happening?')+'</p><div id="intake-feedback"></div>'+answerForm+'<details><summary>Edit original report</summary>'+form('revise','Original description',s.trigger.data.initial_description,'Update description')+'</details>';
    }
    case 'summary': return '<h2>Review your issue summary</h2><p>'+html(s.summary.problem_type)+' · Cause unconfirmed</p><p>The assigned craftsman receives the heating issue category, service address and unit, plus any affected room and visit preference you confirm. Your written report and contact details stay with the property manager.</p>'+reportFields(s.summary.details)+form('submit','Edit or confirm the summary',s.summary.summary,'Confirm and submit request');
    case 'clarification': return '<h2>Your manager has a question</h2><p>'+html(s.clarifications.at(-1).question)+'</p>'+form('reply','Your reply','','Send reply');
    case 'unavailable': return '<h2>Your manager is following up</h2><p>'+html(s.managerNote)+'</p>';
    case 'slots': return '<h2>Choose an appointment</h2><p>Times shown in Europe/Berlin.</p><div class="actions">'+s.slots.map(item=>button('book',slot(item),item.id)).join('')+button('newSlots','Neither time works')+'</div>';
    default: return '<h2>Your heating repair</h2><p>'+({review:'The property manager is reviewing your request.',offered:'The provider has received the offer.',accepted:'The provider accepted and will propose slots.',rejected:'The property manager can select a replacement.'}[s.stage]||statusLabels[s.stage])+'.</p>';
  }
}

function propertyCase(s) {
  if (!s.request) return '<h2>Maintenance requests</h2><p>The tenant’s confirmed request will appear here.</p>';
  const exchange = (s.clarifications ?? []).map(item=>'<p><strong>Manager question</strong> '+html(item.question)+'</p>'+(item.answer?'<p><strong>Tenant reply</strong> '+html(item.answer)+'</p>':'')).join('');
  const ask = '<details><summary>Return for clarification</summary>'+form('clarify','Question for the tenant','','Send question')+'</details>';
  const summary = '<h2>'+html(s.summary.title)+'</h2><p><strong>'+(s.summary.category==='heating'?'Heating':'Needs classification')+'</strong></p><p>'+html(s.summary.summary)+'</p><p>'+html(s.summary.problem_type)+' · Cause unconfirmed</p>'+exchange;
  const history = s.history.length?'<h3>Assignment history</h3><ul>'+s.history.map(item=>'<li>'+html(item.provider)+' · '+html(item.status)+(item.reason?' · '+html(item.reason):'')+'</li>').join('')+'</ul>':'';
  if (!['review','rejected','consent','unavailable'].includes(s.stage)) return summary+history;
  if (s.summary.category==='unclassified') return summary+'<p>Confirm this is a heating repair before assigning a craftsman.</p>'+button('confirmHeating','Confirm heating category')+ask;
  const select = item => s.history.some(old=>old.providerId===item.id&&old.status==='rejected')?'<p>Declined this case</p>':button('select','Select provider',item.id);
  const approved = s.registrations.filter(item => item.approved && ['Heating not warming the home','Possible heating-system fault'].includes(s.summary.problem_type));
  const declined = new Set(s.history.filter(item=>item.status==='rejected').map(item=>item.providerId));
  const available = s.recommendations.filter(item=>!declined.has(item.id));
  const none = !available.length && !approved.some(item=>!declined.has(item.id));
  const followUp = none ? '<h3>No specialist available</h3>'+(s.stage!=='unavailable' ? form('unavailable','Next step for the tenant','Your property manager is checking specialist availability.','Send status to tenant') : '<p>'+html(s.managerNote)+'</p>') : '';
  const best = available[0];
  const why = best ? '<details><summary>Why this craftsman?</summary><p>'+html(best.name)+' matches '+html(best.matchedSpecialty.toLowerCase())+'. '+(available.length===1?'This is the only available ranked specialist for this issue.':'Among eligible specialists, this provider has the highest weighted score.')+'</p><p>Distance (35%), availability (25%), rating (25%) and estimate (15%) determine the score.</p></details>' : '';
  return summary+followUp+'<h3>Ranked fictional providers</h3><p>Filtered by repair specialty, then scored by availability, distance, rating and estimated cost.</p><div class="providers">'+s.recommendations.map((item,index)=>'<article><span class="pill">Rank '+(index+1)+' · Score '+item.score+'</span><h3>'+html(item.name)+'</h3><p>'+html(item.specialties?.join(' · '))+'</p><p>'+html(item.availability)+' · '+item.km+' km · '+item.rating+'/5 '+(item.reviewCount?'('+item.reviewCount+' tenant '+(item.reviewCount===1?'rating':'ratings')+')':'(demo baseline)')+' · €'+item.estimate+' estimate</p>'+(item===best?why:'')+select(item)+'</article>').join('')+'</div>'
    +(approved.length?'<h3>Approved heating repair registrations</h3><p>These providers have no ranking data yet.</p>'+approved.map(item=>'<p>'+html(item.name)+' '+select(item)+'</p>').join(''):'')+history+ask;
}

const finished = stage => ['completed','invoiced'].includes(stage);
const needsManager = stage => ['review','rejected','consent','unavailable'].includes(stage);
function caseList(items, path, status = true) {
  return items.length ? '<div class="case-list">'+items.map(item=>'<a href="'+path+'?case='+encodeURIComponent(item.id)+'"><span><strong>'+html(item.title)+'</strong><small>'+html(item.address)+' · '+html(item.unit)+'</small></span>'+(status?'<span class="pill">'+html(statusLabels[item.stage])+'</span>':'')+'<span aria-hidden="true">→</span></a>').join('')+'</div>' : '<p class="muted">No requests here yet.</p>';
}
function pm(s) {
  const path = location.pathname;
  const active = s.cases.filter(item=>!finished(item.stage));
  if (s.caseId && new URLSearchParams(location.search).has('case')) return '<a class="request-back" href="/property-manager/tasks"><span aria-hidden="true">←</span> Back to requests</a>'+propertyCase(s);
  if (path.endsWith('/tasks')) {
    const samples=s.properties.flatMap(property=>property.tasks.filter(item=>item.status!=='Completed').map(item=>'<li>'+html(property.name+' · '+item.title+' · '+item.status)+'</li>'));
    return '<section id="active-tasks"><h2>Active tasks</h2>'+caseList(active,'/property-manager/tasks')+'<h3>Read-only sample tasks</h3><ul>'+samples.join('')+'</ul></section><h3>Completed repairs</h3>'+caseList(s.cases.filter(item=>finished(item.stage)),'/property-manager/tasks');
  }
  if (path.endsWith('/appointments')) {
    const booked=s.cases.filter(item=>item.appointment);
    return '<h2>Appointments</h2>'+(booked.length?booked.map(item=>'<a class="appointment-card" href="/property-manager/tasks?case='+encodeURIComponent(item.id)+'"><span class="role-icon" aria-hidden="true">▦</span><span><strong>'+html(item.title)+'</strong><small>'+html(item.address+' · '+item.unit)+'</small></span><span class="appointment-time">'+slot(item.appointment)+'<small>Berlin time</small></span><span aria-hidden="true">→</span></a>').join(''):'<p>No confirmed appointments yet.</p>');
  }
  if (path.endsWith('/craftsmen')) {
    return '<h2>Craftsmen</h2><div class="providers">'+s.providers.map(item=>'<article><h3>'+html(item.name)+'</h3><p>'+html(item.specialties.join(' · '))+'</p></article>').join('')+'</div><h3 id="registrations">Registrations</h3>'
      +(s.registrations.length?'<ul>'+s.registrations.map(item=>'<li>'+html(item.name+' · '+item.email)+' · Whole-home heating · '+(item.approved?'Approved':button('approve','Approve '+item.name,item.id))+'</li>').join('')+'</ul>':'<p>No registrations yet.</p>');
  }
  const property = s.properties.find(item=>item.id===new URLSearchParams(location.search).get('property'));
  if (property) {
    const items=s.cases.filter(item=>item.propertyId===property.id);
    const section=(heading, done)=>'<h3>'+heading+'</h3>'+caseList(items.filter(item=>finished(item.stage)===done),'/property-manager/tasks')+
      '<p class="muted">Read-only examples</p><ul>'+property.tasks.filter(item=>(item.status==='Completed')===done).map(item=>'<li>'+html(item.title+' · '+item.status)+'</li>').join('')+'</ul>';
    return '<a href="/property-manager">← Portfolio</a><h2>'+html(property.name)+'</h2><p>'+html(property.address+' · '+property.heating)+'</p>'+section('Requests',false)+section('Repair history',true);
  }
  const needs = active.filter(item=>needsManager(item.stage));
  const cards=s.properties.map(property=>{
    const open=active.filter(item=>item.propertyId===property.id).length ;
    const attention=needs.some(item=>item.propertyId===property.id);
    return '<a class="portfolio-card" href="/property-manager?property='+property.id+'"><span class="role-icon" aria-hidden="true">▤</span><span class="card-arrow" aria-hidden="true">→</span><h3>'+html(property.name)+'</h3><small>'+html(property.address)+'</small><div class="property-counts"><span><b>'+property.units+'</b> Units</span><span><b>'+open+'</b> Open</span></div>'+(attention?'<span class="attention">Action needed</span>':'')+'</a>';
  }).join('');
  const assignments = s.unassignedTenants?.length ? '<section id="unit-assignments"><h3>Assign a tenant to a unit</h3>'+s.unassignedTenants.map(t=>'<form data-action="assignUnit"><input type="hidden" name="tenantId" value="'+html(t.id)+'"><label>'+html(t.name)+' · '+html(t.email)+'<select name="unitId" required><option value="">Choose a vacant unit</option>'+s.availableUnits.map(u=>'<option value="'+html(u.unit_id)+'">'+html(u.address+' · '+u.unit_label)+'</option>').join('')+'</select></label><button class="primary">Assign unit</button></form>').join('')+'</section>':'';
  return '<div class="portfolio-heading"><h2>Your properties</h2><input type="search" id="property-search" aria-label="Search properties" placeholder="Search properties"></div><div class="providers">'+cards+'</div><h3>Requests requiring attention</h3>'+caseList(needs,'/property-manager/tasks',false)+assignments;
}

const nextActions = {
  tenant: { clarification:'Reply to your property manager',intake:'Answer the repair follow-up',summary:'Review your repair summary',slots:'Choose an appointment' },
  pm: { unavailable:'Follow up on specialist availability',review:'Select a craftsman',consent:'Select a craftsman',rejected:'Review available specialists' },
  partner: { offered:'Respond to a job offer',accepted:'Propose appointment times',scheduled:'Submit your repair report',completed:'Submit the outstanding invoice' }
};
const alertIcons = {
  repair:'<path d="M15 6a5 5 0 0 0-6 6l-5 5a2 2 0 0 0 3 3l5-5a5 5 0 0 0 6-6l-3 3-3-3z"/>',
  calendar:'<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4m8-4v4M4 11h16"/>',
  message:'<path d="M20 11a7.5 7.5 0 0 1-8 7H5l1.4-3A6.8 6.8 0 0 1 4 11a8 8 0 0 1 16 0zM8 11h8"/>',
  document:'<path d="M7 3h7l4 4v14H6V3h1zm7 0v5h4M9 12h6m-6 4h6"/>'
};
const alertStorageKey = s => 'centrix-alerts-'+(s.accountKey ?? s.role);
function notifications(s) {
  const links = [];
  const path = {tenant:'/tenant/repair',pm:'/property-manager/tasks',partner:'/craftsman'}[s.role];
  for (const item of (s.cases ?? []).slice().reverse()) {
    const action = nextActions[s.role][item.stage];
    if (!action) continue;
    const icon = ['accepted','slots'].includes(item.stage) ? 'calendar' :
      item.stage === 'clarification' ? 'message' : ['scheduled','completed'].includes(item.stage) ? 'document' : 'repair';
    links.push({id:item.id+':'+item.stage, title:action, preview:item.issueLabel ?? 'Maintenance issue',
      address:item.address, icon, href:path+'?case='+encodeURIComponent(item.id)});
  }
  if (s.role==='tenant' && ['intake','summary'].includes(s.stage)) links.push({id:s.caseId+':'+s.stage,title:nextActions.tenant[s.stage],preview:'Your draft repair report',href:'/tenant'});
  const pending = s.registrations?.filter(item=>!item.approved) ?? [];
  if (pending.length) links.push({id:'registrations:'+pending.map(item=>item.id).join(','),title:'Review craftsman registrations',preview:pending.length+' awaiting approval',href:'/property-manager/craftsmen#registrations'});
  if (s.unassignedTenants?.length) links.push({id:'tenants:'+s.unassignedTenants.map(item=>item.id).join(','),title:'Assign tenants to a unit',preview:s.unassignedTenants.length+' awaiting a unit',href:'/property-manager#unit-assignments'});
  const storageKey = alertStorageKey(s);
  alertIds = links.map(item=>item.id);
  let seen = [];
  try { seen = (JSON.parse(localStorage.getItem(storageKey)) ?? []).filter(id=>alertIds.includes(id)); }
  catch { /* Older versions stored the whole notification list. */ }
  localStorage.setItem(storageKey,JSON.stringify(seen));
  const unread = alertIds.filter(id=>!seen.includes(id));
  if (unread.some(id=>!previousUnread.includes(id))) chime();
  if (!unread.length) pendingChime = false;
  previousUnread = unread;
  const badge = notificationLink.querySelector('.notification-count');
  badge.hidden = !unread.length;
  badge.textContent = unread.length > 99 ? '99+' : unread.length;
  notificationLink.setAttribute('aria-label',unread.length ? 'Notifications, '+unread.length+' unread' : 'Notifications');
  const items = notificationPanel.querySelector('#notification-items');
  const markup = links.length ? '<ul class="notification-list">'+links.map(item=>
    '<li><a class="notification-row" href="'+html(item.href)+'"><span class="notification-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+alertIcons[item.icon ?? 'document']+'</svg></span><span><strong>'+html(item.title)+'</strong><small>'+html(item.preview)+'</small>'+(item.address?'<small>'+html(item.address)+'</small>':'')+'</span><span class="notification-arrow" aria-hidden="true">›</span></a></li>').join('')+'</ul>'
    : '<div class="notification-empty"><span aria-hidden="true">✓</span><strong>You’re all caught up</strong><p>No actions waiting for you.</p></div>';
  if (items.innerHTML !== markup) items.innerHTML = markup;
}

function partner(s) {
  if (!s.job) return '<h2>Incoming jobs</h2><p>A job will appear when the property manager assigns it.</p>';
  let action = '';
  const preference = s.job.payload.scheduling?.preferred_start_from;
  if (s.stage==='offered') action=button('accept','Accept job')+'<details><summary>Decline job</summary>'+form('reject','Reason','Unavailable for this repair.','Decline offer')+'</details>';
  if (s.stage==='accepted') action=(s.requestedNewSlots?'<p>The tenant requested different times.</p>':'')+'<form data-action="slots"><p>Enter two one-hour appointment options in Berlin time.</p>'+(preference?'<button type="button" class="quiet" data-preferred-slots="'+html(preference)+'">Suggest matching times</button><p class="slot-feedback" role="status"></p>':'')+'<label>First start time<input type="datetime-local" name="first" required></label><label>Second start time<input type="datetime-local" name="second" required></label><button class="primary">Propose two slots</button></form>';
  if (s.stage==='slots') action='<p>Waiting for the tenant to confirm an appointment.</p>';
  if (s.stage==='scheduled') action=form('complete','Completion report','Faulty heating valve replaced. The system was tested and heating was restored.','Submit report and complete repair');
  if (s.stage==='completed') action='<form data-action="invoice"><label>Invoice amount in EUR<input name="value" type="number" required step="0.01" min="0.01" max="10000" value="'+html(s.provider.estimate)+'"></label><button class="primary" ' +(s.invoiceFile?'':'disabled title="Upload the document first"')+ '>Submit separate invoice</button></form>';
  if (['completed','invoiced'].includes(s.stage)) action='<h3>Invoice document</h3><form data-action="upload"><label>Choose a PDF, PNG or JPEG (up to 2 MB)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></label><button class="quiet">Upload invoice file</button></form>'+action;
  const {property_context:property}=s.job.payload;
  const offer=s.job.payload;
  return '<h2>'+html(s.provider.name)+'</h2><p>'+html(offer.service.summary)+(offer.service.affected_room?' · '+html(offer.service.affected_room):'')+'</p>'
    +(preference?'<p class="voice-details">Tenant prefers '+html(preference)+' or later (Berlin time).</p>':'')+action
    +'<details><summary>Property details</summary><dl><dt>Address</dt><dd>'+html(property.address)+' · '+html(property.unit_label)+'</dd></dl></details><section class="integration-card"><span class="pill">PARTNER HANDOFF</span><h3>Job offer from Centrix City</h3><p>The service address, unit and repair category were prefilled. The tenant chooses an appointment through the portal.</p>'+details('Inspect partner offer',offer)+'</section>';
}

function timeline(stage) {
  const steps = ['Reported','Manager review','Craftsman assigned','Appointment','Repair complete','Invoice received'];
  const phases = {clarification:1,unavailable:1,review:1,rejected:1,consent:1,offered:2,accepted:2,slots:3,scheduled:3,completed:4,invoiced:5};
  const current = phases[stage];
  if (current === undefined) return '';
  return '<ol class="repair-timeline" aria-label="Repair timeline">'+steps.map((label,index)=>
    '<li class="'+(index<current?'done':'')+'"'+(index===current?' aria-current="step"':'')+'>'+label+'</li>').join('')+'</ol>';
}

function ratingCard(value) {
  const heading = '<h3>How was the repair?</h3>';
  if (value) return '<section class="rating-card">'+heading+'<span class="rating-saved" aria-hidden="true">'+ '★'.repeat(value)+'☆'.repeat(5-value)+'</span><p>Your rating: '+value+'/5</p></section>';
  const stars = [1,2,3,4,5].map(n=>'<label class="star-choice"><input type="radio" name="value" value="'+n+'" required aria-label="'+n+' out of 5 stars"><span aria-hidden="true">★</span></label>').join('');
  return '<section class="rating-card">'+heading+'<p>Optional feedback helps rank craftsmen for future repairs.</p><form data-action="rate"><fieldset><legend class="sr-only">Rate this repair</legend><div class="star-row">'+stars+'</div></fieldset><button class="primary">Submit rating</button></form></section>';
}

function render() {
  const s=state;
  const role=s.role;
  document.querySelector('#active-link').hidden = role!=='pm';
  document.querySelector('.mobile-menu').hidden = role!=='pm';
  document.querySelectorAll('.manager-link').forEach(link=>{link.hidden=role!=='pm';});
  const overview=document.querySelector('#overview-link');
  overview.href=role==='pm'?'/property-manager':role==='tenant'?'/tenant':'/craftsman';
  overview.textContent=role==='pm'?'Portfolio':role==='tenant'?'Report an issue':'Jobs';
  document.querySelectorAll('.sidebar nav a').forEach(link=>{
    if (link.pathname===location.pathname) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#reset').hidden = !s.demo;
  notifications(s);
  const context=s.context?'<p class="context">'+html(s.context.name)+' · '+html(s.context.unit_label)+' · '+html(s.context.address)+'</p>':'';
  const outcome=(s.appointment?'<p><strong>Appointment</strong> · '+slot(s.appointment)+' (Berlin)</p>':'')+(s.report?'<p><strong>Completion report</strong> · '+html(s.report.work_done)+'</p>':'')+(s.invoice?'<p><strong>Invoice</strong> · '+html(s.invoice.invoice_number)+' · €'+s.invoice.amount.toFixed(2)+'</p>':'')+(s.result?details('View simulated '+html(s.context?.unit_label ?? 'unit')+' write-back',s.result):'');
  const download=s.invoiceFile?'<p><a class="quiet" href="/api/demo/invoice?case='+encodeURIComponent(s.caseId)+'">Download '+html(s.invoiceFile)+'</a></p>':'';
  const rating=role==='tenant'&&finished(s.stage)?ratingCard(s.rating):'';
  const status=role==='partner'&&!s.job?'No assigned jobs':statusLabels[s.stage];
  if (role==='tenant') {
    document.body.classList.toggle('tenant-search',!tracking);
    document.querySelector('.dashboard-title').hidden=!tracking;
    const nav = '<nav class="tenant-nav" aria-label="Tenant"><a '+(!tracking?'aria-current="page" ':'')+'href="/tenant">Report an issue</a><a '+(tracking?'aria-current="page" ':'')+'href="/tenant/repair">My repairs'+(s.cases?.length?' · '+s.cases.length:'')+'</a></nav>';
    const report = ['ready','intake','summary','unassigned'].includes(s.stage);
    panel.innerHTML=nav+(tracking
      ? '<h2>My repairs</h2>'+caseList(s.cases??[],'/tenant/repair')+(report?'':context+'<div class="status"><span>Selected repair</span><strong>'+status+'</strong></div>'+timeline(s.stage)+'<div class="content">'+tenant(s)+(s.stage==='completed'?'<p><strong>Invoice pending</strong></p>':'')+ (s.result?unitRecord(s,download):outcome+download)+rating+'</div>')
      : '<div class="search-card">'+tenant(s)+centrixEvent(s)+'</div>');
    return;
  }
  const detail=new URLSearchParams(location.search).has('case') && s.caseId;
  if (role==='pm') {
    const home=location.pathname==='/property-manager' && !location.search;
    const lead=document.querySelector('.dashboard-title .muted');
    lead.textContent=home?'Portfolio overview':location.pathname.endsWith('/appointments')?'Appointment schedule':location.pathname.endsWith('/craftsmen')?'Provider directory':'Property maintenance';
    const active=s.cases.filter(item=>!finished(item.stage));
    const metrics='<div class="metrics">'+[['Open requests',active.length],['Active jobs',active.filter(item=>['offered','accepted','slots','scheduled'].includes(item.stage)).length],['Completed repairs',s.cases.filter(item=>finished(item.stage)).length]].map(([label,count])=>'<div class="metric"><span>'+label+'</span><strong>'+count+'</strong></div>').join('')+'</div>';
    panel.innerHTML=(home?metrics:'')+(detail?context+'<div class="status"><strong>'+status+'</strong></div>':'')+'<div class="content'+(home?' portfolio-content':'')+'">'+pm(s)+(detail?(s.result?unitRecord(s,download):outcome+download):'')+'</div>';
  } else {
    panel.innerHTML='<h2>Assigned jobs</h2>'+caseList(s.cases,'/craftsman')+'<div class="status"><strong>'+status+'</strong></div><div class="content">'+partner(s)+outcome+download+'</div>';
  }
}

function apiUrl() {
  const params=new URLSearchParams(location.search);
  const id=params.get('case');
  if (id) return '/api/demo?case='+encodeURIComponent(id);
  return location.pathname==='/tenant'?'/api/demo?draft=1':'/api/demo';
}

// Keep the original form nodes, including file selections, while the same action is available.
function refresh(data) {
  const sameCase = state?.caseId === data.caseId;
  const editing = [...panel.querySelectorAll('form[data-edited]')];
  const focused = document.activeElement;
  const search = panel.querySelector('#property-search');
  const open = [...panel.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent);
  state = data;
  render();
  if (search && panel.querySelector('#property-search')) {
    panel.querySelector('#property-search').replaceWith(search);
    search.dispatchEvent(new Event('input',{bubbles:true}));
  }
  if (sameCase) {
    for (const el of panel.querySelectorAll('details')) {
      if (open.includes(el.querySelector('summary')?.textContent)) el.open = true;
    }
  }
  for (const old of editing) {
    const replacement = sameCase && [...panel.querySelectorAll('form[data-action]')].find(el=>
      el.dataset.action === old.dataset.action && el.elements.tenantId?.value === old.elements.tenantId?.value);
    if (replacement) replacement.replaceWith(old);
    else {
      const typed = [...old.querySelectorAll('textarea,input:not([type=hidden]):not([type=file])')].map(el=>el.value).filter(Boolean);
      if (typed.length) {
        const preserved = document.createElement('p');
        preserved.className='saved-draft';
        preserved.textContent='Your previous entry (the repair changed): '+typed.join(' · ');
        error.before(preserved);
      }
    }
  }
  if (focused && focused !== document.body && focused.isConnected) focused.focus({preventScroll:true});
}
async function update(action,value) {
  if (busy || recognition) return;
  if (['answer','revise','reset'].includes(action)) window.speechSynthesis?.cancel();
  busy=true;
  panel.parentElement.insertBefore(error,panel);
  panel.setAttribute('aria-busy','true');
  error.hidden=true;
  try {
    const url=apiUrl();
    const response=await fetch(url,action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,value,revision:state.revision,caseId:state.caseId,caseRevision:state.caseRevision})}:{});
    const data=await response.json();
    if (response.status===401) return location.replace('/');
    if (!response.ok) {
      if (response.status===409) {
        const latest=await fetch(url);
        if (latest.status===401) return location.replace('/');
        if (latest.ok) {
          const snapshot=await latest.json();
          if (snapshot.accountKey !== state.accountKey || snapshot.role !== state.role) return location.reload();
          refresh(snapshot);
          if (action==='answer' && state.stage==='summary') return;

        }
      }
      throw new Error(data.error);
    }
    state=data;
    if (action==='submit' && !tracking) return location.assign('/tenant/repair?case='+encodeURIComponent(data.caseId));
    if (action==='reset' && tracking) return location.assign('/tenant');
    render();
    if (action) panel.focus();
    if (['trigger','revise'].includes(action) && data.stage==='intake' && data.trigger?.data.input_method==='voice') readIntakeQuestion();
  } catch (problem) {
    const feedback = panel.querySelector('#intake-feedback');
    (feedback ?? panel.parentElement).insertBefore(error, feedback ? null : panel);
    error.textContent=problem.message;
    error.hidden=false;
  } finally {
    busy=false;
    panel.removeAttribute('aria-busy');
  }
}

function handleVoice(control) {
  const form = control.form;
  const field = form.elements.value;
  const status = form.querySelector('.voice-status');
  if (recognition) {
    recognition.stop();
    return;
  }
  if (!VoiceRecognition) {
    status.textContent = 'Microphone dictation is unavailable in this browser. You can type here.';
    return;
  }
  window.speechSynthesis?.cancel();
  const mic = new VoiceRecognition();
  recognition = mic;
  mic.lang = 'en-GB';
  mic.continuous = false;
  mic.interimResults = false;
  status.textContent = 'Starting microphone…';
  control.title = 'Stop listening';
  control.setAttribute('aria-pressed','true');
  const actions = form.querySelectorAll('[type="submit"], [data-read-question], [data-action="answer"]');
  actions.forEach(button => { button.disabled = true; });
  function finish() {
    if (recognition !== mic) return;
    recognition = undefined;
    control.title = control.getAttribute('aria-label');
    control.setAttribute('aria-pressed','false');
    actions.forEach(button => { button.disabled = false; });
    if (/^(Starting|Listening)/.test(status.textContent)) status.textContent = 'No speech captured. Try again or type your report.';
  }
  mic.onstart = () => { status.textContent = 'Listening…'; };
  mic.onresult = event => {
    const text = event.results[0][0].transcript.trim();
    if (!text) return;
    field.value = [field.value.trim(),text].filter(Boolean).join(' ').slice(0,field.maxLength);
    form.dataset.method = 'voice';
    field.dispatchEvent(new Event('input',{bubbles:true}));
    status.textContent = 'Transcript ready. Review it before submitting.';
    field.focus();
  };
  mic.onerror = event => {
    status.textContent = event.error === 'not-allowed'
      ? 'Microphone permission was denied. Allow access in your browser or type your report.'
      : 'Could not transcribe speech. Try again or type here.';
    finish();
  };
  mic.onend = finish;
  try { mic.start(); }
  catch {
    status.textContent = 'Could not start the microphone. You can type here.';
    finish();
  }
}
function showSlotPreference(form) {
  const threshold = form.querySelector('[data-preferred-slots]')?.dataset.preferredSlots;
  if (!threshold) return;
  const earlier = ['first','second'].some(name => {
    const value = form.elements[name].value;
    return value && value.slice(11,16) < threshold;
  });
  form.querySelector('.slot-feedback').textContent = earlier ? 'At least one option is earlier than the tenant’s preferred time.' : '';
}
function readIntakeQuestion() {
  const question = document.querySelector('#intake-question');
  if (!question || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  window.speechSynthesis.cancel();
  const speech = new SpeechSynthesisUtterance(question.textContent);
  speech.lang = 'en-GB';
  window.speechSynthesis.speak(speech);
}
window.addEventListener('pagehide', () => {
  recognition?.abort();
  window.speechSynthesis?.cancel();
});

document.addEventListener('click',event=>{
  const control=event.target.closest('button');
  if (!control) return;
  if (control.dataset.voice) handleVoice(control);
  if (control.hasAttribute('data-read-question')) readIntakeQuestion();
  if (control.dataset.preferredSlots) {
    const berlinDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',dateStyle:'short'});
    const today = Date.parse(berlinDate.format(new Date())+'T00:00:00Z');
    for (const [i,name] of ['first','second'].entries()) {
      const day = new Date(today+(i+1)*86400000).toISOString().slice(0,10);
      const field = control.form.elements[name];
      field.value = day+'T'+control.dataset.preferredSlots;
      field.dispatchEvent(new Event('input',{bubbles:true}));
    }
  }
  if (control.matches('.mobile-menu')) control.setAttribute('aria-expanded',String(control.getAttribute('aria-expanded')==='false'));
  if (control.dataset.action) update(control.dataset.action,control.dataset.value);
  if (control.id==='reset'&&state&&confirm('Clear all demo repair reports and drafts?')) update('reset');
});
function closeNotifications(returnFocus = false) {
  notificationPanel.hidden=true;
  notificationLink.setAttribute('aria-expanded','false');
  if (returnFocus) notificationLink.focus();
}
notificationPanel.addEventListener('click', event => {
  if (event.target.closest('.notification-close')) closeNotifications(true);
  if (event.target.closest('a')) closeNotifications();
});
notificationLink.addEventListener('click', () => {
  if (!notificationPanel.hidden) return closeNotifications();
  notificationPanel.hidden = false;
  notificationLink.setAttribute('aria-expanded','true');
  if (state) {
    localStorage.setItem(alertStorageKey(state),JSON.stringify(alertIds));
    notifications(state);
  }
});
document.addEventListener('pointerdown',event => {
  if (!notificationPanel.hidden && !event.target.closest('.notification-menu')) closeNotifications();
});
document.addEventListener('keydown',event => {
  if (event.key==='Escape' && !notificationPanel.hidden) closeNotifications(true);
});
panel.addEventListener('submit',async event=>{
  event.preventDefault();
  const data=new FormData(event.target);
  const action=event.target.dataset.action;
  if (recognition) return;
  if (action==='trigger' && event.target.dataset.method) {
    return update(action,{description:data.get('value'),method:event.target.dataset.method});
  }
  if (action==='upload') {
    const file=data.get('file');
    if (!file?.size || file.size>2097152) {
      error.textContent='Choose an invoice file up to 2 MB.';
      error.hidden=false;
      return;
    }
    const reader=new FileReader();
    reader.onload=()=>update(action,{data:reader.result.split(',')[1]});
    reader.onerror=()=>{error.textContent='Could not read the selected file.';error.hidden=false;};
    reader.readAsDataURL(file);
    return;
  }
  update(action,action==='assignUnit'?{tenantId:data.get('tenantId'),unitId:data.get('unitId')}:action==='slots'?[data.get('first'),data.get('second')]:data.get('value'));
});
panel.addEventListener('input',event=>{
  if (event.target.form?.dataset.action) event.target.form.dataset.edited='true';
  if (event.target.form?.dataset.action==='slots') showSlotPreference(event.target.form);
  if (event.target.id==='property-search') {
    const query=event.target.value.trim().toLowerCase();
    panel.querySelectorAll('.portfolio-card').forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(query);});
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});
update();
let checkingForUpdates = false;
async function checkForUpdates() {
  if (document.hidden || busy || recognition || !state || checkingForUpdates) return;
  checkingForUpdates = true;
  try {
    const response = await fetch(apiUrl());
    if (response.status===401) return location.replace('/');
    if (!response.ok) return;
    const latest=await response.json();
    if (latest.role !== state.role || latest.accountKey !== state.accountKey) return location.reload();
    if (!busy && !recognition && latest.revision > state.revision) refresh(latest);
  } catch {
    // Keep the last known action list until the server can be reached again.
  } finally {
    checkingForUpdates = false;
  }
}
document.addEventListener('visibilitychange', checkForUpdates);
window.addEventListener('focus', checkForUpdates);
setInterval(checkForUpdates, 5000);
