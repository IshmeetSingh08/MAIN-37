const context = {
  unit_id: 'unit_4b', unit_label: 'Unit 4B', contact_id: 'c_202',
  name: 'Lena Hoffmann', address: 'Musterstraße 12, 52062 Aachen',
  phone: '+49 151 00000000', heating: 'Gas central heating'
};

exports.getTenantContext = () => ({ ...context });
exports.tenants = { tenant: {...context, propertyId:'aachen-12'}, maya:{...context,name:'Maya Keller',unit_id:'unit_linden_2',unit_label:'Unit 2',contact_id:'c_203',propertyId:'lindenhof',address:'Lindenweg 8, 52074 Aachen',phone:'+49 151 00000001'}, jonas:{...context,name:'Jonas Weber',unit_id:'unit_park_7',unit_label:'Unit 7',contact_id:'c_204',propertyId:'parkblick',address:'Parkstraße 24, 52066 Aachen',phone:'+49 151 00000002'} };
exports.trigger = (description, tenant = context, id = '001') => ({
  schema_version: '1.0', event_id: 'evt_heating_' + id,
  event: 'maintenance.issue_reported', source: 'centrix_mock',
  occurred_at: '2026-11-20T09:14:00Z',
  unit_id: tenant.unit_id, contact_id: tenant.contact_id,
  data: { issue_channel: 'tenant_portal', initial_description: description }
});
exports.writeMaintenanceResult = (result, tenant = context) => ({
  schema_version: '1.0', unit_id: tenant.unit_id, contact_id: tenant.contact_id,
  maintenance_result: result
});
