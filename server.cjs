const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { fresh, apply, view, safeTitle } = require('./workflow.cjs');
const { accounts } = require('./accounts.cjs');
const { providerName, rankProviders } = require('./partner.cjs');
const { tenants } = require('./centrix.cjs');

const db = new DatabaseSync(process.env.DEMO_DB || join(__dirname, 'demo.sqlite'));
const auth = require('./auth.cjs')(db);
const portfolio = require('./portfolio.cjs')(db);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const managerEmail = process.env.CENTRIX_MANAGER_EMAIL?.trim().toLowerCase();
const managerPassword = process.env.CENTRIX_MANAGER_PASSWORD;
if (managerEmail || managerPassword) {
  if (!managerEmail || !emailPattern.test(managerEmail) || !managerPassword || managerPassword.length < 10 || managerPassword.length > 128) {
    throw new Error('Set a valid manager email and a password of 10–128 characters.');
  }
  const manager = auth.byEmail(managerEmail);
  if (manager && manager.role !== 'pm') throw new Error('The manager email already belongs to another role.');
  if (!manager) auth.register(randomUUID(), managerEmail, accounts.pm.name, 'pm', managerPassword);
}
let credentialAttempts = 0;
let credentialWindow = Date.now();
db.exec('CREATE TABLE IF NOT EXISTS demo (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)');
const save = db.prepare('INSERT INTO demo VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state');
const read = db.prepare('SELECT state FROM demo WHERE id=1');
function current() {
  const saved = JSON.parse(read.get()?.state ?? JSON.stringify(fresh()));
  if (saved.cases) return saved;
  return { revision:saved.revision, registrations:saved.registrations ?? [],
    cases:saved.stage==='ready'?[]:[{...saved,id:'001',owner:'tenant',context:tenants.tenant}] };
}
const assets = { '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/island.svg': ['island.svg', 'image/svg+xml'] };
const dashboardPaths = [...Object.values(accounts).map(account => account.path), '/tenant/repair', '/property-manager/tasks', '/property-manager/appointments', '/property-manager/craftsmen'];
const page = (name) => readFileSync(join(__dirname, name), 'utf8');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 2810000) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  return raw;
}
function partnerOwnsJob(state, session) {
  const attempt = state.attempts.at(-1);
  return !['clarification','review','unavailable'].includes(state.stage) && attempt?.job && attempt.provider.id === session.providerId;
}
const unitCatalog = portfolio().flatMap(property => Array.from({length: property.units}, (_, i) => {
  const label = property.id === 'aachen-12' ? 'Unit 4B' : 'Unit ' + (i + 1);
  return {unit_id:property.id + '_' + (i + 1),unit_label:label,propertyId:property.id,address:property.address,heating:property.heating};
})).filter(unit => !Object.values(tenants).some(t => t.propertyId === unit.propertyId && t.unit_label === unit.unit_label));
const registeredTenants = db.prepare("SELECT id,name,email FROM accounts WHERE role='tenant' AND demo=0 ORDER BY name");
const ownerKey = session => session.demo ? session.id.slice(5) : session.id;
function tenantContext(state,session) {
  if (session.demo) return tenants[ownerKey(session)];
  const unit = unitCatalog.find(unit => unit.unit_id === state.assignments?.[session.id]);
  return unit && {...unit,name:session.name,contact_id:'resident_' + session.id};
}
function visibleCases(state,session) {
  return state.cases.filter(item => session.role==='pm' ? Boolean(item.request) :
    session.role==='tenant' ? item.owner===ownerKey(session) : partnerOwnsJob(item,session));
}
function selectedCase(state, session, url) {
  const cases = visibleCases(state,session);
  const id = url.searchParams.get('case');
  if (id) return cases.find(item=>item.id===id);
  if (url.searchParams.has('draft')) return cases.find(item=>!item.request);
  return session.role==='tenant'?cases.filter(item=>item.request).at(-1):cases.at(-1);
}
function sessionView(state, session, url, selected = selectedCase(state,session,url)) {
  if (session.role === 'tenant' && !tenantContext(state,session)) {
    return { role: 'tenant', accountKey:session.id, stage: 'unassigned', revision: state.revision, demo: false };
  }
  const cases = visibleCases(state,session).filter(item=>item.request).map(item=>({
    id:item.id, title:session.role === 'partner' ? safeTitle(item) : item.trigger.data.initial_description, stage:item.stage, appointment:item.appointment,
    issueLabel:item.summary?.category === 'heating' ? ({
      'Single radiator not warming':'Radiator not warming',
      'Possible heating controls or boiler issue':'Boiler or thermostat issue'
    }[safeTitle(item)] ?? 'Heating problem') : 'Maintenance issue',
    propertyId:item.context.propertyId, address:item.context.address, unit:item.context.unit_label
  }));
  const role = session.role;
  const reviews = Object.create(null);
  if (role==='pm') for (const item of state.cases) {
    const provider = item.attempts.at(-1)?.provider.id;
    if (provider && ['completed','invoiced'].includes(item.stage) && Number.isInteger(item.rating) && item.rating>=1 && item.rating<=5) {
      (reviews[provider] ??= []).push(item.rating);
    }
  }
  return {
    ...view(selected ?? {...fresh(),context:role === 'tenant' ? tenantContext(state,session) : undefined}, role), accountKey:session.id, role, demo: Boolean(session.demo), revision:state.revision,
    caseId:selected?.id, caseRevision:selected?.revision, cases,
    ...(role === 'pm' ? { registrations: state.registrations, properties: portfolio(),
      unassignedTenants:registeredTenants.all().filter(t=>!state.assignments?.[t.id]),
      availableUnits:unitCatalog.filter(unit=>!Object.values(state.assignments ?? {}).includes(unit.unit_id)),
      providers:rankProviders('heating_repair',null,reviews),
      ...(selected?.summary ? {recommendations:rankProviders(selected.summary.required_specialisation,selected.summary.problem_type,reviews)} : {})
    } : {})
  };
}
const server = createServer(async (req, res) => {
  const send = (status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const redirect = (location, cookie) => {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...(cookie && { 'Set-Cookie': cookie }) });
    res.end();
  };
  const html = (content) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    const session = auth.read(req.headers.cookie);
    if (req.method === 'POST' && (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host))) {
      return send(403, { error: 'Open CENTRIX CITY directly to perform this action.' });
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return html(page('index.html'));
    }
    if (req.method === 'GET' && url.pathname === '/demo/login') {
      const role = url.searchParams.get('role');
      if (!Object.hasOwn(accounts, role)) return redirect('/');
      const account = accounts[role];
      const status = {
        submitted: 'Registration submitted. Ask the property manager to approve it before signing in.',
        pending: 'This registration is awaiting manager approval.',
        unknown: 'No approved craftsman account was found for that email.',
        invalid: 'Enter a name, a valid email address and a password of 10–128 characters.',
        credentials: 'Email or password is incorrect.',
        created: 'Account created. Sign in with your email and password.',
        exists: 'An account already uses that email. Sign in or use a different email.',
        limited: 'Too many attempts. Try again in a minute.'
      }[url.searchParams.get('status')] ?? '';
      let partnerOptions = role === 'pm' ? '' : page('craftsman-access.html')
        .replaceAll('%%KEY%%', role).replaceAll('%%TYPE%%', role === 'tenant' ? 'tenant' : 'craftsman')
        .replace('%%NOTE%%', role === 'tenant' ? 'A registered tenant needs an assigned unit before reporting a repair.' : 'A manager must approve your application before you can sign in or receive work.');
      if (url.searchParams.get('register') === '1') {
        partnerOptions = partnerOptions.replace('<details id="register">', '<details id="register" open>');
      }
      return html(page('login.html').replaceAll('%%ROLE%%', account.label).replaceAll('%%KEY%%', role)
        .replace('%%DEMO_LABEL%%', role === 'tenant' ? 'Demo Tenant' : escapeHtml(account.name))
        .replace('%%STATUS%%', status)
        .replace('%%OPTIONS%%', partnerOptions + (role==='tenant'||role==='partner'?
          '<details><summary>More demo '+(role==='tenant'?'tenants':'craftsmen')+'</summary>'+
          (role==='tenant'?Object.entries(tenants).filter(([id])=>id!=='tenant').map(([id,item])=>({id,name:item.name})):rankProviders('heating_repair').filter(item=>item.id!=='craft_001'))
            .map(item=>'<form method="post" action="/demo/login"><input type="hidden" name="role" value="'+role+'"><input type="hidden" name="mode" value="demo"><button class="quiet" name="identity" value="'+item.id+'">Continue as '+escapeHtml(item.name)+'</button></form>').join('')+'</details>':'')));
    }
    if (req.method === 'POST' && url.pathname === '/demo/register') {
      const form = new URLSearchParams(await readBody(req));
      const role = form.get('role');
      if (!['tenant', 'partner'].includes(role)) return redirect('/');
      const name = form.get('name')?.trim();
      const email = form.get('email')?.trim().toLowerCase();
      const password = form.get('password') ?? '';
      const loginPath = '/demo/login?role=' + role + '&status=';
      if (!name || name.length > 80 || !email || email.length > 160 || !emailPattern.test(email) || password.length < 10 || password.length > 128) {
        return redirect(loginPath + 'invalid&register=1');
      }
      if (auth.byEmail(email)) return redirect(loginPath + 'exists');
      const id = randomUUID();
      if (role === 'tenant') {
        db.exec('BEGIN');
        try {
          auth.register(id, email, name, role, password);
          const state = current();
          state.revision++;
          save.run(JSON.stringify(state));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return redirect(loginPath + 'created');
      }
      const state = current();
      state.registrations ??= [];
      if (state.registrations.some(item => item.email === email)) return redirect(loginPath + 'exists');
      const providerId = 'craft_reg_' + id;
      state.registrations.push({ id: providerId, name, email, skills: ['heating_repair'], approved: false });
      state.revision++;
      db.exec('BEGIN');
      try {
        auth.register(id, email, name, role, password, providerId);
        save.run(JSON.stringify(state));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return redirect(loginPath + 'submitted');
    }
    if (req.method === 'POST' && url.pathname === '/demo/login') {
      const form = new URLSearchParams(await readBody(req));
      const role = form.get('role');
      if (!Object.hasOwn(accounts, role)) return redirect('/');
      const state = current();
      let account;
      if (form.get('mode') === 'demo') {
        // Registered providers must use their own credentials.
        const preferred = form.get('identity') ?? 'craft_001';
        const seededProvider = providerName(preferred) ? {id:preferred,name:providerName(preferred)} : { id: 'craft_001', name: accounts.partner.name };
        const tenantKey = Object.hasOwn(tenants,form.get('identity')) ? form.get('identity') : 'tenant';
        account = role === 'partner'
          ? auth.demo(seededProvider.id, seededProvider.name, role, seededProvider.id)
          : role==='tenant'?auth.demo(tenantKey,tenants[tenantKey].name,role):auth.demo(role, accounts[role].name, role);
      } else {
        if (Date.now() - credentialWindow >= 60000) {
          credentialWindow = Date.now();
          credentialAttempts = 0;
        }
        const loginPath = '/demo/login?role=' + role + '&status=';
        if (++credentialAttempts > 20) return redirect(loginPath + 'limited');
        const email = (form.get('email') ?? '').trim().toLowerCase();
        const password = form.get('password') ?? '';
        account = email.length <= 160 ? auth.byEmail(email) : null;
        if (password.length > 128 || !auth.verify(account, password) || account.role !== role) return redirect(loginPath + 'credentials');
        if (role === 'partner' && !state.registrations?.some(item => item.id === account.provider_id && item.approved)) {
          return redirect(loginPath + 'pending');
        }
      }
      return redirect(accounts[role].path, auth.login(account, req.headers.cookie));
    }
    if (req.method === 'POST' && url.pathname === '/demo/logout') {
      return redirect('/', auth.logout(req.headers.cookie));
    }
    if (req.method === 'GET' && dashboardPaths.includes(url.pathname)) {
      if (!session) return redirect('/');
      const account = accounts[session.role];
      if (account.path !== url.pathname && !url.pathname.startsWith(account.path + '/')) return redirect(account.path);
      const name = session.name;
      return html(page('dashboard.html').replaceAll('%%ROLE%%', account.label).replaceAll('%%ACCOUNT%%', () => escapeHtml(name)));
    }
    if (req.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
      const [name, type] = assets[url.pathname];
      const content = readFileSync(join(__dirname, name));
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      return res.end(content);
    }
    if (req.method==='GET' && url.pathname==='/api/demo/invoice') {
      if (!session) return send(401,{error:'Sign in to download the invoice.'});
      const item=selectedCase(current(),session,url);
      if (!item?.invoiceFile || (!item.invoice && session.role!=='partner')) return send(404,{error:'Invoice unavailable.'});
      res.writeHead(200,{'Content-Type':item.invoiceFile.type,'Content-Disposition':'attachment; filename="'+item.invoiceFile.name+'"',
        'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
      return res.end(Buffer.from(item.invoiceFile.data,'base64'));
    }
    if (url.pathname !== '/api/demo') return send(404, { error: 'Page not found.' });
    if (!session) return send(401, { error: 'Choose a demo account to continue.' });
    if (req.method === 'GET') return send(200, sessionView(current(), session, url));
    if (req.method !== 'POST') return send(405, { error: 'Method unavailable.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON required.' });
    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch (error) {
      if (error.status) throw error;
      return send(400, { error: 'Invalid request.' });
    }
    if (!body || typeof body.action !== 'string') return send(400, { error: 'Invalid request.' });
    const previous = current();
    if (session.role === 'tenant' && !tenantContext(previous,session)) return send(403, { error: 'This account has no assigned unit.' });
    let selected = selectedCase(previous,session,url);
    const globalAction = ['reset','approve','assignUnit'].includes(body.action);
    const newDraft = body.action === 'trigger' && !selected && !body.caseId && !url.searchParams.has('case');
    const sameCase = selected && selected.id === body.caseId && selected.revision === body.caseRevision;
    if (globalAction ? body.revision !== previous.revision : !(sameCase || newDraft)) {
      return send(409, { error: 'This repair changed. Review the latest details before trying again.' });
    }
    if (body.action === 'reset') {
      if (!session.demo) return send(403, { error: 'Only a demo account can reset the repair.' });
      previous.cases = [];
      selected = undefined;
    } else if (body.action === 'assignUnit') {
      if (session.role !== 'pm') return send(403,{error:'Manager access required.'});
      const {tenantId,unitId} = body.value ?? {};
      previous.assignments ??= {};
      if (!registeredTenants.all().some(t=>t.id===tenantId) || previous.assignments[tenantId] ||
          !unitCatalog.some(u=>u.unit_id===unitId) || Object.values(previous.assignments).includes(unitId)) {
        return send(409,{error:'Review the available tenants and units.'});
      }
      previous.assignments[tenantId] = unitId;
    } else if (body.action === 'approve') {
      if (session.role !== 'pm') return send(403, { error: 'Only the property manager can approve registrations.' });
      const registration = previous.registrations?.find(item => item.id === body.value);
      if (!registration) return send(404, { error: 'Registration not found.' });
      registration.approved = true;
    } else {
      if (body.action==='trigger' && session.role==='tenant' && !selected && !url.searchParams.has('case')) {
        const owner=ownerKey(session);
        selected={...fresh(),id:previous.revision===0?'001':randomUUID(),owner,context:tenantContext(previous,session)};
        previous.cases.push(selected);
      }
      if (!selected) return send(403, {error:'This repair is unavailable for your account.'});
      selected.registrations=previous.registrations;
      apply(selected,{...body, role:session.role,revision:selected.revision});
      delete selected.registrations;
    }
    previous.revision++;
    const output = sessionView(previous, session, url, selected);
    save.run(JSON.stringify(previous));
    send(200, output);
  } catch (error) {
    if (!error.status) console.error(error);
    send(error.status || 500, { error: error.status ? error.message : 'The demo could not complete this action.' });
  }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
  console.log('CENTRIX CITY http://127.0.0.1:' + server.address().port);
});
