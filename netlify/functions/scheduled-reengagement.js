// netlify/functions/scheduled-reengagement.js
// Runs daily at 09:00 UTC via Netlify scheduled functions.
// Finds every dashboard user whose Last Login was exactly 14 days ago
// and fires the re-engagement email automatically.
//
// netlify.toml config needed:
// [[functions]]
//   schedule = "0 9 * * *"
//   name = "scheduled-reengagement"

const { schedule } = require('@netlify/functions');

const AIRTABLE_API   = 'https://api.airtable.com/v0';
const SITE_URL       = 'https://markebmedia.com';

// ── helpers ──────────────────────────────────────────────────
function toYMD(date) {
  return date.toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYMD(d);
}

async function airtableGet(table, formula) {
  const url = new URL(
    `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`
  );
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
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`send-reengagement-email failed (${res.status}): ${txt}`);
  }
  return res.json();
}

async function markReengagementSent(recordId) {
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(
    process.env.AIRTABLE_USER_TABLE
  )}/${recordId}`;

  await fetch(url, {
    method:  'PATCH',
    headers: {
      Authorization:  `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fields: {
        'Reengagement Sent':    toYMD(new Date()),
        'Reengagement Count':   null   // incremented below after we read current value
      }
    })
  });
}

// ── main handler ─────────────────────────────────────────────
const handler = async () => {
  console.log(`[scheduled-reengagement] Running at ${new Date().toISOString()}`);

  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_USER_TABLE) {
    console.error('[scheduled-reengagement] Missing env vars — aborting');
    return { statusCode: 500 };
  }

  const targetDate = daysAgo(14);   // exactly 14 days ago
  console.log(`[scheduled-reengagement] Looking for Last Login = ${targetDate}`);

  // ── fetch eligible users ──────────────────────────────────
  // Criteria:
  //   • Account Status = Active
  //   • Last Login = exactly 14 days ago  (catches the window once per day)
  //   • Reengagement Sent is blank OR was sent more than 30 days ago
  //     (prevents hammering the same person every 14 days indefinitely)
  const thirtyDaysAgo = daysAgo(30);

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

  if (users.length === 0) {
    return { statusCode: 200 };
  }

  // ── fire emails one by one (avoid rate-limit bursts) ─────
  const results = { sent: 0, failed: 0, skipped: 0 };

  for (const user of users) {
    const f = user.fields;

    const email   = f['Email'];
    const name    = f['Name'];
    const company = f['Company']  || '';
    const region  = f['Region']   || '';

    if (!email || !name) {
      console.warn(`[scheduled-reengagement] Skipping record ${user.id} — missing email/name`);
      results.skipped++;
      continue;
    }

    try {
      await fireReengagementEmail(email, name, company, region);
      console.log(`[scheduled-reengagement] ✓ Sent to ${email}`);

      // Record that we sent it — non-fatal if this PATCH fails
      const currentCount = typeof f['Reengagement Count'] === 'number'
        ? f['Reengagement Count']
        : 0;

      const patchUrl = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(
        process.env.AIRTABLE_USER_TABLE
      )}/${user.id}`;

      await fetch(patchUrl, {
        method:  'PATCH',
        headers: {
          Authorization:  `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            'Reengagement Sent':  toYMD(new Date()),
            'Reengagement Count': currentCount + 1
          }
        })
      }).catch(err =>
        console.warn(`[scheduled-reengagement] PATCH failed for ${user.id}:`, err.message)
      );

      results.sent++;

      // 300 ms pause between sends to avoid Resend rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.error(`[scheduled-reengagement] ✗ Failed for ${email}:`, err.message);
      results.failed++;
    }
  }

  console.log(
    `[scheduled-reengagement] Done — sent: ${results.sent}, failed: ${results.failed}, skipped: ${results.skipped}`
  );

  return { statusCode: 200 };
};

exports.handler = schedule('0 9 * * *', handler);