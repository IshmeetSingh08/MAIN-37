const assert = require('node:assert/strict');

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.DEMO_BROWSER || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(14000);
    page.on('dialog', dialog => dialog.accept());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.DEMO_URL || 'http://127.0.0.1:3000';
    await page.goto(new URL('/tenant', base).href);
    const click = (name, container = page) => container.getByRole('button', { name, exact: true }).click();
    const status = text => ['Ready to report','Intake in progress','No assigned unit'].includes(text)
      ? page.getByRole('heading', {name:{'Ready to report':'Report a maintenance issue','Intake in progress':'Tell us about the heating','No assigned unit':'Your account is ready'}[text],exact:true}).waitFor()
      : page.locator('.status strong').getByText(text, { exact: true }).waitFor();
    const landing = () => page.getByRole('heading', { name: 'Choose your role' }).waitFor();
    const login = async (role, name, path) => {
      if (new URL(page.url()).pathname !== '/') await click('Switch account');
      await landing();
      await page.getByRole('link', { name: role + ' log in', exact:true }).click();
      if (name === 'Jonas Weber') await page.getByText('More demo tenants').click();
      if (name === 'WärmeFix GmbH') await page.getByText('More demo craftsmen').click();
      await click('Continue as ' + name);
      await page.waitForURL(new URL(path, base).href);
      await page.locator('#panel[tabindex] h2').first().waitFor();
      assert.equal(await page.locator('.map').count(), 0);
    };
    const tenant = async () => {
      await login('Tenant', 'Demo Tenant', '/tenant');
      const repair = page.getByRole('link', {name:/^My repairs ·/});
      if (await repair.isVisible()) await repair.click();
    };
    const portfolio = () => login('Property Manager', 'Demo Property Manager', '/property-manager');
    const manager = async () => {
      await portfolio();
      await page.locator('#active-link').click();
      await page.locator('.case-list a').first().click();
    };
    const craftsman = () => login('Craftsman', 'Müller Heiztechnik', '/craftsman');
    const report = async () => {
      await page.locator('textarea').fill('All the rooms are freezing even with the dial turned up.');
      await click('Continue');
      await page.getByRole('heading',{name:'Review your issue summary'}).waitFor();
      await page.getByText('Tenant report received', {exact:true}).waitFor();

      await click('Confirm and submit request');
    };
    await landing();
    assert.equal((await page.request.get(base + '/api/demo')).status(), 401);
    assert(await page.locator('.map img').evaluate(image => image.naturalWidth > 0));
    await tenant();
    await click('Reset demo');
    await status('Ready to report');
    await report();
    await status('Awaiting provider selection');
    await portfolio();
    await page.locator('.portfolio-card .attention').waitFor();
    await page.getByRole('button', { name: /Notifications/ }).click();
    await page.locator('#notifications').getByText(/select a craftsman/i).waitFor();
    await page.getByRole('link', { name: 'Requests', exact:true }).click();
    await page.waitForURL('**/property-manager/tasks');
    await page.locator('#active-tasks').getByText(/All the rooms are freezing/).waitFor();
    await page.getByRole('link', {name:'Portfolio'}).click();
    await page.locator('.portfolio-card').filter({hasText:'Lindenhof'}).click();
    await page.getByText(/Entrance door adjusted/).waitFor();
    await page.locator('#active-link').click();
    await page.locator('.case-list a').first().click();
    const scoped = await (await page.request.get(base + '/api/demo?role=partner')).json();
    assert.equal(scoped.role, 'pm');
    await click('Select provider', page.locator('article').filter({ hasText: 'Müller Heiztechnik' }));
    await status('Job offered');
    await craftsman();
    await page.getByText('Job offer from Centrix City', {exact:true}).waitFor();
    await click('Accept job');
    const nextDate = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    await page.getByLabel('First start time').fill(nextDate+'T09:00');
    await page.getByLabel('Second start time').fill(nextDate+'T13:00');
    await click('Propose two slots');
    await status('Slots available');
    await tenant();
    await page.getByRole('button', { name: /09:00–10:00/ }).click();
    await status('Appointment confirmed');
    await craftsman();
    await click('Submit report and complete repair');
    await status('Task completed — invoice pending');
    await page.getByRole('button', { name: /Notifications/ }).click();
    await page.locator('#notifications').getByText(/outstanding invoice/).waitFor();
    await manager();
    await status('Task completed — invoice pending');
    await page.getByRole('link', {name:'Requests',exact:true}).click();
    await page.locator('#active-tasks h2').waitFor();
    assert.equal(await page.locator('#active-tasks .case-list').first().getByText(/All the rooms are freezing/).count(), 0);
    await craftsman();
    await page.locator('input[type=file]').setInputFiles({name:'invoice.pdf', mimeType:'application/pdf', buffer:Buffer.from('%PDF-1.4\n%%EOF')});
    await click('Upload invoice file');
    await page.getByRole('link',{name:'Download invoice.pdf'}).waitFor();
    await click('Submit separate invoice');
    await status('Invoice submitted · Result linked');
    await manager();
    await status('Invoice submitted · Result linked');
    await tenant();
    const download = await page.request.get(await page.getByRole('link',{name:'Download invoice.pdf'}).getAttribute('href').then(path=>base+path));
    await page.getByRole('heading',{name:'Unit 4B maintenance record'}).waitFor();
    assert.equal((await download.body()).toString(),'%PDF-1.4\n%%EOF');
    await page.getByRole('radio',{name:'5 out of 5 stars'}).check();
    await click('Submit rating');
    await page.getByText('Your rating: 5/5').waitFor();
    await page.getByText('View simulated Unit 4B write-back').click();
    await page.locator('pre').getByText(/INV-\d{4}-/).waitFor();
    await page.reload();
    await status('Invoice submitted · Result linked');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.setViewportSize({width:1280,height:800});
    await click('Reset demo');
    await status('Ready to report');
    await report();
    await manager();
    await click('Select provider', page.locator('article').filter({ hasText: 'Müller Heiztechnik' }));
    await craftsman();
    const originalCraftsman = await page.context().storageState();
    await page.getByText('Decline job', { exact: true }).click();
    await click('Decline offer');
    await status('Partner declined');
    await manager();
    await click('Select provider', page.locator('article').filter({ hasText: 'WärmeFix GmbH' }));
    await login('Craftsman', 'WärmeFix GmbH', '/craftsman');
    await status('Job offered');
    await page.getByText('Property details').click();
    await page.locator('dl').getByText(/Musterstraße 12/).waitFor();
    const priorSession = await browser.newContext({ storageState: originalCraftsman });
    const response = await priorSession.request.get(base + '/api/demo');
    assert.equal((await response.json()).job, undefined);
    await priorSession.close();
    await click('Reset demo');
    await status('No assigned jobs');
    await click('Switch account');
    await landing();
    assert.equal((await page.request.get(base + '/api/demo')).status(), 401);
    await page.getByRole('link', { name: 'Register', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Demo Heating Service');
    await page.getByLabel('Registration email').fill('heating@example.test');
    await page.getByLabel('Create password').fill('browser-test-password');
    await click('Submit registration');
    await page.getByRole('status').getByText(/Registration submitted/).waitFor();
    const signInRegistration = async () => {
      await page.getByLabel('Email', { exact: true }).fill('heating@example.test');
      await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
      await click('Login');
    };
    await signInRegistration();
    await page.getByRole('status').getByText(/awaiting manager approval/).waitFor();
    await page.getByRole('link', { name: 'Back to role selection' }).click();
    await portfolio();
    await page.getByRole('link',{name:'Craftsmen'}).click();
    await click('Approve Demo Heating Service');
    await page.getByText(/Demo Heating Service.*Approved/).waitFor();
    await click('Switch account');
    await page.getByRole('link', { name: 'Craftsman log in', exact:true }).click();
    await signInRegistration();
    await status('No assigned jobs');
    await page.getByRole('heading', { name: 'Demo Heating Service' }).waitFor();
    assert.equal(await page.locator('#reset').isVisible(), false);
    await click('Switch account');
    await page.getByRole('link', { name: 'Tenant log in' }).click();
    await page.getByText('Register', { exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Test Tenant');
    await page.getByLabel('Registration email').fill('tenant@example.test');
    await page.getByLabel('Create password').fill('browser-test-password');
    await click('Submit registration');
    await page.getByRole('status').getByText(/Account created/).waitFor();
    const tenantCredentials = async password => {
      await page.getByLabel('Email', { exact: true }).fill('tenant@example.test');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await click('Login');
    };
    await tenantCredentials('incorrect');
    await page.getByRole('status').getByText(/incorrect/).waitFor();
    await tenantCredentials('browser-test-password');
    await status('No assigned unit');
    assert.equal((await (await page.request.get(base + '/api/demo')).json()).context, undefined);
    const managerContext = await browser.newContext({viewport:{width:360,height:780}});
    try {
      await managerContext.request.post(base+'/demo/login',{form:{role:'pm',mode:'demo'}});
      const observer = await managerContext.newPage();
      observer.setDefaultTimeout(14000);
      await observer.goto(base+'/property-manager');
      await observer.getByRole('button',{name:'Menu'}).click();
      await observer.getByRole('link',{name:'Requests',exact:true}).click();
      await observer.getByRole('heading',{name:'Active tasks'}).waitFor();
      await observer.goto(base+'/property-manager');
      const assign = observer.locator('form[data-action=assignUnit]').filter({hasText:'Test Tenant'});
      await assign.locator('select').selectOption({index:1});
      await assign.getByRole('button',{name:'Assign unit'}).click();
      await status('Ready to report');
      assert(await observer.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
      await observer.locator('#property-search').fill('Linden');
      await page.getByLabel('Describe what’s wrong in your own words').fill('Only the bedroom radiator is cold. Call private demo number.');
      await click('Continue');
      await page.getByLabel('Edit or confirm the summary').fill('One radiator stays cold.');
      const other = await browser.newContext();
      try {
        await other.request.post(base+'/demo/login',{form:{role:'tenant',mode:'demo',identity:'maya'}});
        const url = base+'/api/demo?draft=1';
        const draft = await (await other.request.get(url)).json();
        const response = await other.request.post(url,{data:{action:'trigger',value:'The boiler has an error.',revision:draft.revision}});
        assert(response.ok());
      } finally {await other.close();}
      assert.equal(await page.getByLabel('Edit or confirm the summary').inputValue(),'One radiator stays cold.');
      await click('Confirm and submit request');
      const link = observer.locator('.case-list a').filter({hasText:'bedroom radiator'});
      await link.waitFor();
      assert.equal(await observer.locator('#property-search').inputValue(),'Linden');
      await link.click();
      await observer.getByText('Why this craftsman?').click();
      await observer.locator('article').filter({hasText:'Müller Heiztechnik'}).getByRole('button',{name:'Select provider'}).click();
      await observer.locator('.status strong').getByText('Job offered').waitFor();
      const partner = await browser.newContext();
      try {
        await partner.request.post(base+'/demo/login',{form:{role:'partner',mode:'demo'}});
        const partnerView = await (await partner.request.get(base+'/api/demo')).json();
        assert.equal(partnerView.cases[0].title,'Single radiator not warming');
        assert(!JSON.stringify(partnerView).includes('private demo number'));
      } finally {await partner.close();}
    } finally { await managerContext.close(); }
    await click('Switch account');
    await landing();
    assert.equal((await page.request.get(base + '/api/demo')).status(), 401);
    await login('Tenant','Jonas Weber','/tenant');
    await report();
    await status('Awaiting provider selection');
    await page.getByRole('link',{name:'Report an issue',exact:true}).last().click();
    await report();
    await status('Awaiting provider selection');
    const jonas = await (await page.request.get(base+'/api/demo')).json();
    assert.equal(jonas.cases.length,2);
    assert(jonas.cases.every(item=>item.propertyId==='parkblick'));
    await tenant();
    const lena = await (await page.request.get(base+'/api/demo?case='+jonas.cases[0].id)).json();
    assert.equal(lena.cases.length,0);
    assert.equal(lena.caseId,undefined);
    console.log('Multi-case and tenant isolation verified. Credentials, demo sessions, portfolio, action notifications, invoice-pending completion, replacement and approval verified.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });




