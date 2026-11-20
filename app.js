const panel = document.querySelector('#panel');
const error = document.querySelector('#error');
const notificationPanel = document.querySelector('#notifications');
const notificationLink = document.querySelector('#notification-link');
const tracking = location.pathname === '/tenant/repair';
let audio;
let notificationKey;
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
const statusLabels = {unassigned:'No assigned unit',ready:'Ready to report',intake:'Intake in progress',summary:'Review summary',review:'Awaiting provider selection',consent:'Awaiting provider selection',offered:'Job offered',accepted:'Job accepted',rejected:'Partner declined',slots:'Slots available',scheduled:'Appointment confirmed',completed:'Task completed — invoice pending',invoiced:'Invoice submitted · Result linked'};
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (action,label,value='') => '<button class="primary" data-action="'+action+'" data-value="'+html(value)+'">'+html(label)+'</button>';
const form = (action,label,value,submit) => '<form data-action="'+action+'"><label>'+label+'<textarea name="value" required maxlength="1000">'+html(value)+'</textarea></label><button class="primary">'+submit+'</button></form>';
const details = (title,data) => '<details><summary>'+title+'</summary><pre>'+html(JSON.stringify(data,null,2))+'</pre></details>';
const format = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'});
const time = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',timeStyle:'short'});
const slot = item => format.format(new Date(item.start))+'–'+time.format(new Date(item.end));
let state;
let busy = false;

function tenant(s) {
  switch(s.stage) {
    case 'unassigned': return '<h2>Your account is ready</h2><p>A property manager must assign you to a unit before you can report a repair. Use the demo tenant to explore Unit 4B.</p>';
    case 'ready': return '<h2>Report a maintenance issue</h2><p>The demo currently supports heating repairs.</p>'+form('trigger','Describe what’s wrong in your own words','','Continue');
    case 'intake': return '<h2>Tell us about the heating</h2><p class="pill">Deterministic AI intake · Demo mode</p><blockquote>'+html(s.trigger.data.initial_description)+'</blockquote><p>'+html(s.question || 'What did you notice, and where is the problem happening?')+'</p><div id="intake-feedback"></div>'+form('answer','Your answer','','Generate summary')+'<details><summary>Edit original report</summary>'+form('revise','Original description',s.trigger.data.initial_description,'Update description')+'</details>';
    case 'summary': return '<h2>Review your issue summary</h2><p>'+html(s.summary.problem_type)+' · Cause unconfirmed</p>'+form('submit','Edit or confirm the summary',s.summary.summary,'Confirm and submit request');
    case 'slots': return '<h2>Choose an appointment</h2><p>Times shown in Europe/Berlin.</p><div class="actions">'+s.slots.map(item=>button('book',slot(item),item.id)).join('')+'</div>';
    default: return '<h2>Your heating repair</h2><p>'+({review:'The property manager is reviewing your request.',offered:'The provider has received the offer.',accepted:'The provider accepted and will propose slots.',rejected:'The property manager can select a replacement.'}[s.stage]||statusLabels[s.stage])+'.</p>';
  }
}

function propertyCase(s) {
  if (!s.request) return '<h2>Maintenance requests</h2><p>The tenant’s confirmed request will appear here.</p>';
  const summary = '<h2>'+html(s.summary.title)+'</h2><p><strong>'+(s.summary.category==='heating'?'Heating':'Needs classification')+'</strong></p><p>'+html(s.summary.summary)+'</p><p>'+html(s.summary.problem_type)+' · Cause unconfirmed</p>';
  const history = s.history.length?'<h3>Assignment history</h3><ul>'+s.history.map(item=>'<li>'+html(item.provider)+' · '+html(item.status)+(item.reason?' · '+html(item.reason):'')+'</li>').join('')+'</ul>':'';
  if (!['review','rejected','consent'].includes(s.stage)) return summary+history;
  if (s.summary.category==='unclassified') return summary+'<p>Confirm this is a heating repair before assigning a craftsman.</p>'+button('confirmHeating','Confirm heating category');
  const select = item => s.history.some(old=>old.providerId===item.id&&old.status==='rejected')?'<p>Declined this case</p>':button('select','Select provider',item.id);
  const approved = s.registrations.filter(item => item.approved && ['Heating not warming the home','Possible heating-system fault'].includes(s.summary.problem_type));
  return summary+'<h3>Ranked fictional providers</h3><p>Filtered by repair specialty, then scored by availability, distance, rating and estimated cost.</p><div class="providers">'+s.recommendations.map((item,index)=>'<article><span class="pill">Rank '+(index+1)+' · Score '+item.score+'</span><h3>'+html(item.name)+'</h3><p>'+html(item.specialties?.join(' · '))+'</p><p>'+html(item.availability)+' · '+item.km+' km · '+item.rating+'/5 '+(item.reviewCount?'('+item.reviewCount+' tenant '+(item.reviewCount===1?'rating':'ratings')+')':'(demo baseline)')+' · €'+item.estimate+' estimate</p>'+select(item)+'</article>').join('')+'</div>'
    +(approved.length?'<h3>Approved heating repair registrations</h3><p>These providers have no ranking data yet.</p>'+approved.map(item=>'<p>'+html(item.name)+' '+select(item)+'</p>').join(''):'')+history;
}

const finished = stage => ['completed','invoiced'].includes(stage);
const needsManager = stage => ['review','rejected','consent'].includes(stage);
function caseList(items, path, status = true) {
  return items.length ? '<div class="case-list">'+items.map(item=>'<a href="'+path+'?case='+encodeURIComponent(item.id)+'"><span><strong>'+html(item.title)+'</strong><small>'+html(item.address)+' · '+html(item.unit)+'</small></span>'+(status?'<span class="pill">'+html(statusLabels[item.stage])+'</span>':'')+'<span aria-hidden="true">→</span></a>').join('')+'</div>' : '<p class="muted">No requests here yet.</p>';
}
function pm(s) {
  const path = location.pathname;
  const active = s.cases.filter(item=>!finished(item.stage));
  if (s.caseId && new URLSearchParams(location.search).has('case')) return '<a class="request-back" href="/property-manager/tasks"><span aria-hidden="true">←</span> Back to requests</a>'+propertyCase(s);
  if (path.endsWith('/tasks')) {
    const samples=s.properties.flatMap(property=>property.tasks.filter(item=>item.status!=='Completed').map(item=>'<li>'+html(property.name+' · '+item.title+' · '+item.status)+'</li>'));
    return '<section id="active-tasks"><h2>Active tasks</h2>'+caseList(active,'/property-manager/tasks')+'<ul>'+samples.join('')+'</ul></section><h3>Completed repairs</h3>'+caseList(s.cases.filter(item=>finished(item.stage)),'/property-manager/tasks');
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
      '<ul>'+property.tasks.filter(item=>(item.status==='Completed')===done).map(item=>'<li>'+html(item.title+' · '+item.status)+'</li>').join('')+'</ul>';
    return '<a href="/property-manager">← Portfolio</a><h2>'+html(property.name)+'</h2><p>'+html(property.address+' · '+property.heating)+'</p>'+section('Requests',false)+section('Repair history',true);
  }
  const needs = active.filter(item=>needsManager(item.stage));
  const cards=s.properties.map(property=>{
    const open=active.filter(item=>item.propertyId===property.id).length + property.tasks.filter(item=>item.status!=='Completed').length;
    const attention=needs.some(item=>item.propertyId===property.id);
    return '<a class="portfolio-card" href="/property-manager?property='+property.id+'"><span class="role-icon" aria-hidden="true">▤</span><span class="card-arrow" aria-hidden="true">→</span><h3>'+html(property.name)+'</h3><small>'+html(property.address)+'</small><div class="property-counts"><span><b>'+property.units+'</b> Units</span><span><b>'+open+'</b> Open</span></div>'+(attention?'<span class="attention">Action needed</span>':'')+'</a>';
  }).join('');
  return '<div class="portfolio-heading"><h2>Your properties</h2><input type="search" id="property-search" aria-label="Search properties" placeholder="Search properties"></div><div class="providers">'+cards+'</div><h3>Requests requiring attention</h3>'+caseList(needs,'/property-manager/tasks',false);
}

const nextActions = {
  tenant: { intake:'Answer the repair follow-up.',summary:'Review and confirm the repair summary.',slots:'Choose an appointment slot.' },
  pm: { review:'Review the new request and select a craftsman.',consent:'Select a craftsman to send the offer.',rejected:'The offer was declined. Select a replacement.' },
  partner: { offered:'Accept or decline the assigned job.',accepted:'Propose appointment slots for the tenant.',scheduled:'Submit the completion report after the visit.',completed:'The repair is completed. Submit the outstanding invoice.' }
};
function notifications(s) {
  const links = [];
  const path = {tenant:'/tenant/repair',pm:'/property-manager/tasks',partner:'/craftsman'}[s.role];
  for (const item of s.cases ?? []) {
    const action = nextActions[s.role][item.stage];
    if (action) links.push({ text:action+' '+item.title, href:path+'?case='+encodeURIComponent(item.id) });
  }
  if (s.role==='tenant' && ['intake','summary'].includes(s.stage)) links.push({text:nextActions.tenant[s.stage],href:'/tenant'});
  if (s.registrations?.some(item=>!item.approved)) links.push({ text:'Review pending craftsman registrations.',href:'/property-manager/craftsmen#registrations' });
  const key = JSON.stringify(links.map(item=>item.text));
  const seenKey = 'centrix-alerts-'+s.role;
  const unread = links.length > 0 && localStorage.getItem(seenKey) !== key;
  if (!links.length) {
    localStorage.removeItem(seenKey);
    pendingChime = false;
  }
  if (notificationKey !== key && unread) chime();
  notificationKey = key;
  notificationLink.classList.toggle('unread', unread);
  notificationLink.setAttribute('aria-label', unread ? 'Notifications, new actions' : 'Notifications');
  const markup = '<h2>Notifications</h2>'+(links.length?'<ul>'+links.map(item=>'<li><a href="'+html(item.href)+'">'+html(item.text)+'</a></li>').join('')+'</ul>':'<p>No actions waiting for you.</p>');
  if (notificationPanel.innerHTML !== markup) notificationPanel.innerHTML = markup;
}

function partner(s) {
  if (!s.job) return '<h2>Incoming jobs</h2><p>A job will appear when the property manager assigns it.</p>';
  let action = '';
  if (s.stage==='offered') action=button('accept','Accept job')+'<details><summary>Decline job</summary>'+form('reject','Reason','Unavailable for this repair.','Decline offer')+'</details>';
  if (s.stage==='accepted') action='<form data-action="slots"><p>Enter two one-hour appointment options in Berlin time.</p><label>First start time<input type="datetime-local" name="first" required></label><label>Second start time<input type="datetime-local" name="second" required></label><button class="primary">Propose two slots</button></form>';
  if (s.stage==='slots') action='<p>Waiting for the tenant to confirm an appointment.</p>';
  if (s.stage==='scheduled') action=form('complete','Completion report','Faulty heating valve replaced. The system was tested and heating was restored.','Submit report and complete repair');
  if (s.stage==='completed') action='<form data-action="invoice"><label>Invoice amount in EUR<input name="value" type="number" required step="0.01" min="0.01" max="10000" value="'+html(s.provider.estimate)+'"></label><button class="primary">Submit separate invoice</button></form>';
  if (['completed','invoiced'].includes(s.stage)) action='<h3>Invoice document</h3><form data-action="upload"><label>Choose a PDF, PNG or JPEG (up to 2 MB)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" required></label><button class="quiet">Upload invoice file</button></form>'+action;
  const {property_context:property}=s.job.payload;
  return '<h2>'+html(s.provider.name)+'</h2><p>'+html(s.job.payload.service.summary)+'</p>'+action
    +'<details><summary>Property details</summary><dl><dt>Address</dt><dd>'+html(property.address)+' · '+html(property.unit_label)+'</dd></dl></details>';
}

function timeline(stage) {
  const steps = ['Reported','Manager review','Craftsman assigned','Appointment','Repair complete','Invoice received'];
  const phases = {review:1,rejected:1,consent:1,offered:2,accepted:2,slots:3,scheduled:3,completed:4,invoiced:5};
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
      ? '<h2>My repairs</h2>'+caseList(s.cases??[],'/tenant/repair')+(report?'':context+'<div class="status"><span>Selected repair</span><strong>'+status+'</strong></div>'+timeline(s.stage)+'<div class="content">'+tenant(s)+(s.stage==='completed'?'<p><strong>Invoice pending</strong></p>':'')+outcome+download+rating+'</div>')
      : '<div class="search-card">'+tenant(s)+'</div>');
    return;
  }
  const detail=new URLSearchParams(location.search).has('case') && s.caseId;
  if (role==='pm') {
    const home=location.pathname==='/property-manager' && !location.search;
    const lead=document.querySelector('.dashboard-title .muted');
    lead.textContent=home?'Portfolio overview':location.pathname.endsWith('/appointments')?'Appointment schedule':location.pathname.endsWith('/craftsmen')?'Provider directory':'Property maintenance';
    const active=s.cases.filter(item=>!finished(item.stage));
    const metrics='<div class="metrics">'+[['Open requests',active.length],['Active jobs',active.filter(item=>['offered','accepted','slots','scheduled'].includes(item.stage)).length],['Completed repairs',s.cases.filter(item=>finished(item.stage)).length]].map(([label,count])=>'<div class="metric"><span>'+label+'</span><strong>'+count+'</strong></div>').join('')+'</div>';
    panel.innerHTML=(home?metrics:'')+(detail?context+'<div class="status"><strong>'+status+'</strong></div>':'')+'<div class="content'+(home?' portfolio-content':'')+'">'+pm(s)+(detail?outcome+download:'')+'</div>';
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

async function update(action,value) {
  if (busy) return;
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
          state=await latest.json();
          render();
          if (action==='answer' && state.stage==='summary') return;
          if (action==='answer' && state.stage==='intake') panel.querySelector('form[data-action="answer"] textarea').value=value;
        }
      }
      throw new Error(data.error);
    }
    state=data;
    if (action==='submit' && !tracking) return location.assign('/tenant/repair?case='+encodeURIComponent(data.caseId));
    if (action==='reset' && tracking) return location.assign('/tenant');
    render();
    if (action) panel.focus();
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

document.addEventListener('click',event=>{
  const control=event.target.closest('button');
  if (!control) return;
  if (control.dataset.action) update(control.dataset.action,control.dataset.value);
  if (control.id==='reset'&&state&&confirm('Clear all demo repair reports and drafts?')) update('reset');
});
notificationPanel.addEventListener('click', async event => {
  const link = event.target.closest('a');
  if (!link) return;
  notificationPanel.hidden=true;
  notificationLink.setAttribute('aria-expanded','false');
});
notificationLink.addEventListener('click', () => {
  notificationPanel.hidden = !notificationPanel.hidden;
  notificationLink.setAttribute('aria-expanded',String(!notificationPanel.hidden));
  if (!notificationPanel.hidden && state) {
    localStorage.setItem('centrix-alerts-'+state.role, notificationKey);
    notificationLink.classList.remove('unread');
  }
});
panel.addEventListener('submit',async event=>{
  event.preventDefault();
  const data=new FormData(event.target);
  const action=event.target.dataset.action;
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
  update(action,action==='slots'?[data.get('first'),data.get('second')]:data.get('value'));
});
panel.addEventListener('input',event=>{
  if (event.target.id==='property-search') {
    const query=event.target.value.trim().toLowerCase();
    panel.querySelectorAll('.portfolio-card').forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(query);});
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});
update();
setInterval(async () => {
  if (document.hidden || busy) return;
  try {
    const response = await fetch(apiUrl());
    if (response.ok) notifications(await response.json());
  } catch {
    // Keep the last known action list until the server can be reached again.
  }
}, 5000);




