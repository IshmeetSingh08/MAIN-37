const picker = document.querySelector('#island-case');
const owner = document.querySelector('#island-owner');
const stageTitle = document.querySelector('#island-stage');
const next = document.querySelector('#island-next');
const message = document.querySelector('#island-error');
const landmarks = [...document.querySelectorAll('.landmark')];
const phases = {
  review:['manager','Report submitted','The property manager reviews the report and chooses a craftsman.'],
  consent:['manager','Ready for assignment','The property manager can assign a craftsman.'],
  clarification:['tenant','Question from the manager','The tenant can reply in My repairs.'],
  rejected:['manager','Offer declined','The property manager reviews the available specialists.'],
  unavailable:['manager','Specialist unavailable','The property manager is following up.'],
  offered:['partner','Job offered','The craftsman can accept or decline the repair.'],
  accepted:['partner','Job accepted','The craftsman proposes appointment times.'],
  slots:['tenant','Appointment options ready','The tenant chooses a time in My repairs.'],
  scheduled:['partner','Appointment booked','The craftsman visits and submits the repair report.'],
  completed:['partner','Repair complete · Invoice pending','The craftsman uploads and submits the invoice.'],
  invoiced:['tenant','Invoice available','The repair and invoice are linked to the unit record.']
};
let cases = [];
let rendered;
let loading = false;

function showCase() {
  const selected = cases.find(item=>item.id===picker.value) ?? cases.at(-1);
  const key = selected ? selected.id+':'+selected.stage : '';
  if (key===rendered) return;
  rendered = key;
  const [role,title,description] = phases[selected?.stage] ?? ['', 'Waiting for a report', 'A repair will appear when the tenant submits a report.'];
  const active = document.getElementById(role+'-landmark');
  landmarks.forEach(mark => {
    if (mark===active) mark.setAttribute('aria-current','true');
    else mark.removeAttribute('aria-current');
  });
  owner.textContent = selected ? selected.unit+(active?' · '+active.textContent:'') : 'Repair status';
  stageTitle.textContent = title;
  next.textContent = description;
}

async function updateIsland() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch('/api/demo/island');
    if (response.status===401 || response.status===403) {
      location.replace('/demo/login?role=pm');
      return;
    }
    if (!response.ok) throw new Error('Island update failed');
    const data = await response.json();
    const selected = picker.value;
    if (cases.map(item=>item.id).join(',')!==data.cases.map(item=>item.id).join(',')) {
      picker.replaceChildren(new Option('Latest report',''), ...data.cases.map((item,index)=>
        new Option('Repair '+(index+1)+' · '+item.unit,item.id)));
      picker.value = data.cases.some(item=>item.id===selected) ? selected : '';
    }
    cases = data.cases;
    showCase();
    message.hidden = true;
  } catch {
    message.textContent = 'Live updates are temporarily unavailable. Reconnecting…';
    message.hidden = false;
  } finally {
    loading = false;
  }
}

picker.addEventListener('change',showCase);
window.addEventListener('focus',updateIsland);
updateIsland();
setInterval(updateIsland,2000);
