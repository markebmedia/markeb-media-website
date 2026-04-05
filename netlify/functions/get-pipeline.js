// /.netlify/functions/get-pipeline.js
// Fetches all records from "Sales Pipeline - BDM" in Markeb Media - Performance HQ
const BASE_ID = process.env.AIRTABLE_BASE_ID_PIPELINE;
const TABLE   = 'Sales Pipeline - BDM';
const PAT     = process.env.AIRTABLE_PAT;

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!PAT) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'AIRTABLE_PAT environment variable not set' })
    };
  }

  try {
    const records = await fetchAllRecords();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ records, count: records.length })
    };
  } catch (err) {
    console.error('Pipeline fetch error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

function resolveBDM(val) {
  if (!val) return '';
  if (Array.isArray(val)) {
    return val.map(x => (typeof x === 'object' ? x.name || x.email || '' : x)).join(', ');
  }
  if (typeof val === 'object') return val.name || val.email || '';
  return val;
}

// Strip all dash variants so "Closed - Won", "Closed – Won", "Closed Won" all become "Closed Won"
function normaliseStage(stage) {
  if (!stage) return '';
  return stage
    .replace(/Closed\s*[\u2013\u2014\-]\s*Won/g,  'Closed Won')
    .replace(/Closed\s*[\u2013\u2014\-]\s*Lost/g, 'Closed Lost')
    .trim();
}

async function fetchAllRecords() {
  const all = [];
  let offset = null;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`
    );
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${PAT}` }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable error ${res.status}: ${text}`);
    }

    const data = await res.json();
    (data.records || []).forEach(r => {
      const f = r.fields;
      all.push({
id:                        r.id,
leadName:                  f['Lead Name']                       || '',
location:                  f['Location']                        || '',
agencyCompany:             f['Agency/Company Name']             || '',
email:                     f['Email']                           || '',
phone:                     f['Phone']                           || '',
bdm:                       resolveBDM(f['Business Development Manager']),
outboundOrInbound:         f['Outbound or Inbound']             || '',
outboundChannel:           f['Outbound Communication Channel']  || '',
inboundChannel:            f['Inbound Communication Channel']   || '',
outboundPitch:             f['Outbound Communication Pitch']    || '',
referral:                  f['Referral']                        || '',
salesStage:                normaliseStage(f['Sales Stage']),
salesStageNotes:           f['Sales Stage Notes']               || '',
meetingStatus:             f['Meeting Status']                  || '',
meetingType:               f['Meeting Type']                    || '',
meetingDate:               f['Meeting Date']                    || null,
dashboardSignUpDate:       f['Dashboard Sign Up Date']          || null,
closeDate:                 f['Close Date']                      || null,
dealValue:                 parseFloat(f['Deal Value (£)'])      || 0,
monthlyContractValue:      parseFloat(f['Monthly Contract Value (£)']) || 0,
notes:                     f['Sales Stage Notes']               || '',
createdTime:               r.createdTime                        || null
      });
    });

    offset = data.offset || null;
  } while (offset);

  return all;
}