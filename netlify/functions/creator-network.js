// netlify/functions/creator-network.js
// CRUD proxy for the Creator Network system:
//   - Creator Network table (freelancer profiles)
//   - Creator Region Assignments table (region + priority per creator)
// Also exposes a combined lookup used by the admin panel to render
// creators alongside their region assignments in one call.

const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const { action, ...payload } = JSON.parse(event.body);

    switch (action) {
      case 'list-creators':
        return await listCreators(headers);

      case 'get-creator':
        return await getCreator(headers, payload);

      case 'create-creator':
        return await createCreator(headers, payload);

      case 'update-creator':
        return await updateCreator(headers, payload);

      case 'delete-creator':
        return await deleteCreator(headers, payload);

      case 'list-assignments':
        return await listAssignments(headers, payload);

      case 'create-assignment':
        return await createAssignment(headers, payload);

      case 'update-assignment':
        return await updateAssignment(headers, payload);

      case 'delete-assignment':
        return await deleteAssignment(headers, payload);

      case 'get-full-roster':
        return await getFullRoster(headers);

      case 'get-active-specialist-for-region':
        return await getActiveSpecialistForRegion(headers, payload);

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: `Unknown action: ${action}` })
        };
    }

  } catch (error) {
    console.error('creator-network error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message || 'Internal error' })
    };
  }
};

// ── CREATOR NETWORK TABLE ──────────────────────────────────────────────────

async function listCreators(headers) {
  const records = await base('Creator Network')
    .select({ sort: [{ field: 'Name', direction: 'asc' }] })
    .all();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      creators: records.map(r => ({ id: r.id, fields: r.fields }))
    })
  };
}

async function getCreator(headers, { recordId }) {
  if (!recordId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'recordId required' }) };
  }
  const record = await base('Creator Network').find(recordId);
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, creator: { id: record.id, fields: record.fields } })
  };
}

async function createCreator(headers, { fields }) {
  if (!fields || !fields['Name']) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Name is required' }) };
  }

  const record = await base('Creator Network').create({
    'Name': fields['Name'],
    'Email': fields['Email'] || '',
    'Phone': fields['Phone'] || '',
    'Status': fields['Status'] || 'Active',
    'Services': fields['Services'] || [],
    'Day Rate / Notes': fields['Day Rate / Notes'] || '',
    'Contract Start': fields['Contract Start'] || undefined,
    'Contract End': fields['Contract End'] || undefined
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, creator: { id: record.id, fields: record.fields } })
  };
}

async function updateCreator(headers, { recordId, fields }) {
  if (!recordId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'recordId required' }) };
  }

  const record = await base('Creator Network').update(recordId, fields);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, creator: { id: record.id, fields: record.fields } })
  };
}

async function deleteCreator(headers, { recordId }) {
  if (!recordId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'recordId required' }) };
  }

  // Clean up any region assignments pointing at this creator first,
  // so the roster lookup never returns orphaned assignment rows.
  const orphaned = await base('Creator Region Assignments')
    .select({ filterByFormula: `FIND('${recordId}', ARRAYJOIN({Creator}))` })
    .all();

  for (const record of orphaned) {
    await base('Creator Region Assignments').destroy(record.id);
  }

  await base('Creator Network').destroy(recordId);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, deletedAssignments: orphaned.length })
  };
}

// ── CREATOR REGION ASSIGNMENTS TABLE ───────────────────────────────────────

async function listAssignments(headers, { region } = {}) {
  const filterByFormula = region ? `{Region} = '${region}'` : undefined;

  const records = await base('Creator Region Assignments')
    .select({
      filterByFormula,
      sort: [{ field: 'Region', direction: 'asc' }, { field: 'Priority', direction: 'asc' }]
    })
    .all();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      assignments: records.map(r => ({ id: r.id, fields: r.fields }))
    })
  };
}

async function createAssignment(headers, { fields }) {
  if (!fields || !fields['Creator'] || !fields['Region']) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Creator and Region are required' }) };
  }

  const record = await base('Creator Region Assignments').create({
    'Creator': fields['Creator'],
    'Region': fields['Region'],
    'Priority': fields['Priority'] || 1,
    'Active': fields['Active'] !== undefined ? fields['Active'] : true
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, assignment: { id: record.id, fields: record.fields } })
  };
}

async function updateAssignment(headers, { recordId, fields }) {
  if (!recordId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'recordId required' }) };
  }

  const record = await base('Creator Region Assignments').update(recordId, fields);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, assignment: { id: record.id, fields: record.fields } })
  };
}

async function deleteAssignment(headers, { recordId }) {
  if (!recordId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'recordId required' }) };
  }

  await base('Creator Region Assignments').destroy(recordId);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true })
  };
}

// ── SINGLE-REGION LOOKUP (for booking.html postcode check) ─────────────────
// Returns the top-priority Active creator assigned to this region, or null
// if no creator override exists (caller should fall back to in-house).
async function getActiveSpecialistForRegion(headers, { region }) {
  if (!region) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'region required' }) };
  }

  try {
    const assignments = await base('Creator Region Assignments')
      .select({
        filterByFormula: `AND({Region} = '${region}', {Active} = TRUE())`,
        sort: [{ field: 'Priority', direction: 'asc' }]
      })
      .all();

    for (const record of assignments) {
      const linkedIds = record.fields['Creator'] || [];
      if (linkedIds.length === 0) continue;
      const creatorRecord = await base('Creator Network').find(linkedIds[0]);
      if (creatorRecord.fields['Status'] === 'Active') {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            specialistName: creatorRecord.fields['Name'],
            specialistServices: creatorRecord.fields['Services'] || []
          })
        };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, specialistName: null, specialistServices: null })
    };

  } catch (error) {
    console.error('Error in getActiveSpecialistForRegion:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, specialistName: null, specialistServices: null })
    };
  }
}

// ── COMBINED ROSTER LOOKUP (for admin panel table) ─────────────────────────
// Returns every creator with their region assignments nested inline, so the
// admin UI can render the whole roster in one fetch instead of stitching
// two tables together client-side.

async function getFullRoster(headers) {
  const [creatorRecords, assignmentRecords] = await Promise.all([
    base('Creator Network').select({ sort: [{ field: 'Name', direction: 'asc' }] }).all(),
    base('Creator Region Assignments').select({ sort: [{ field: 'Priority', direction: 'asc' }] }).all()
  ]);

  const assignmentsByCreator = {};
  assignmentRecords.forEach(a => {
    const linkedIds = a.fields['Creator'] || [];
    linkedIds.forEach(creatorId => {
      if (!assignmentsByCreator[creatorId]) assignmentsByCreator[creatorId] = [];
      assignmentsByCreator[creatorId].push({
        id: a.id,
        region: a.fields['Region'],
        priority: a.fields['Priority'],
        active: a.fields['Active'] === true
      });
    });
  });

  const roster = creatorRecords.map(c => ({
    id: c.id,
    name: c.fields['Name'],
    email: c.fields['Email'] || '',
    phone: c.fields['Phone'] || '',
    status: c.fields['Status'] || 'Active',
    services: c.fields['Services'] || [],
    notes: c.fields['Day Rate / Notes'] || '',
    contractStart: c.fields['Contract Start'] || '',
    contractEnd: c.fields['Contract End'] || '',
    assignments: (assignmentsByCreator[c.id] || []).sort((a, b) => a.priority - b.priority)
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, roster })
  };
}