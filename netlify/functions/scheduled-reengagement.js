// netlify/functions/scheduled-reengagement.js
// Runs daily at 09:00 UTC — schedule set in netlify.toml

const AIRTABLE_API = 'https://api.airtable.com/v0';
const SITE_URL     = 'https://markebmedia.com';

function toYMD(date) {
  return date.toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYMD(d);
}

async function airtableGet(table, formula) {
  const url = new URL(`${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`);
  url.searchParams.set('filterByFormula', formula);
  url.searchParams.set('pageSize', '100');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` }
  });
  if (!res.ok) throw new Error(`Airtable error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.records || [];
}

async function fireReengagementEmail(email, name, company, region) {
  const res = await fetch(`${SITE_URL}/.netlify/functions/send-reengagement-email`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, name, company, region })
  });
  if (!res.ok) throw new Error(`send-reengagement-email failed (${res.status}): ${await res.text()}`);
  return res.json();
}

exports.handler = async () => {
  console.log(`[scheduled-reengagement] Running at ${new Date().toISOString()}`);

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_USER_TABLE) {
    console.error('[scheduled-reengagement] Missing env vars — aborting');
    return { statusCode: 500 };
  }

  const targetDate    = daysAgo(14);
  const thirtyDaysAgo = daysAgo(30);

  console.log(`[scheduled-reengagement] Looking for Last Login = ${targetDate}`);

  const formula = `AND(
    {Account Status} = "Active",
    {Last Login} = "${targetDate}",
    OR(
      {Reengagement Sent} = "",
      IS_BEFORE({Reengagement Sent}, "${thirtyDaysAgo}")
    )
  )`;

  let users;
  try {
    users = await airtableGet(process.env.AIRTABLE_USER_TABLE, formula);
  } catch (err) {
    console.error('[scheduled-reengagement] Airtable fetch failed:', err.message);
    return { statusCode: 500 };
  }

  console.log(`[scheduled-reengagement] Found ${users.length} user(s) to re-engage`);
  if (users.length === 0) return { statusCode: 200 };

  const results = { sent: 0, failed: 0, skipped: 0 };

  for (const user of users) {
    const f = user.fields;
    if (!f['Email'] || !f['Name']) {
      results.skipped++;
      continue;
    }

    try {
      await fireReengagementEmail(f['Email'], f['Name'], f['Company'] || '', f['Region'] || '');
      console.log(`[scheduled-reengagement] ✓ Sent to ${f['Email']}`);

      const currentCount = typeof f['Reengagement Count'] === 'number' ? f['Reengagement Count'] : 0;

      await fetch(`${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(process.env.AIRTABLE_USER_TABLE)}/${user.id}`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Reengagement Sent': toYMD(new Date()), 'Reengagement Count': currentCount + 1 } })
      }).catch(err => console.warn(`[scheduled-reengagement] PATCH failed for ${user.id}:`, err.message));

      results.sent++;
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.error(`[scheduled-reengagement] ✗ Failed for ${f['Email']}:`, err.message);
      results.failed++;
    }
  }

  console.log(`[scheduled-reengagement] Done — sent: ${results.sent}, failed: ${results.failed}, skipped: ${results.skipped}`);
  return { statusCode: 200 };
};