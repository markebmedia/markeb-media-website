const Airtable = require('airtable');
const { sendReviewRewardEmail } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const PRIZE_CODES = {
  floor_plan:  { code: 'REVIEWFP2026', label: 'Free floor plan' },
  speed_tour:  { code: 'REVIEWST2026', label: 'Free speed tour' },
  discount_10: { code: 'REVIEW10OFF',  label: '10% off' }
};

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { email, prize, checkOnly } = JSON.parse(event.body);

    if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required' }) };

    const records = await base('Markeb Media Users')
      .select({ filterByFormula: `{Email} = '${email}'`, maxRecords: 1 })
      .firstPage();

    if (!records.length) return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };

    const user = records[0];
    const fields = user.fields;
    const eligible = fields['Google Review Reward Eligible'] || false;
    const alreadySpun = fields['Review Reward Spun'] || false;
    const existingPrize = fields['Review Reward Prize'] || null;

    // Check only — used on dashboard load
    if (checkOnly) {
return { statusCode: 200, headers, body: JSON.stringify({ eligible, alreadySpun, prize: existingPrize, wonDate: fields['Review Reward Won Date'] || null }) };
    }

    if (!eligible) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not eligible' }) };

    // Already spun — return existing prize
    if (alreadySpun && existingPrize) {
return { statusCode: 200, headers, body: JSON.stringify({ alreadySpun: true, prize: existingPrize, wonDate: fields['Review Reward Won Date'] || null, ...PRIZE_CODES[existingPrize] }) };
    }

    // Record the win
    const won = prize || Object.keys(PRIZE_CODES)[Math.floor(Math.random() * 3)];

    await base('Markeb Media Users').update(user.id, {
'Review Reward Spun': true,
'Review Reward Prize': won,
'Review Reward Won Date': new Date().toISOString()
    });

    // Send reward email
    try {
      await sendReviewRewardEmail(email, fields['Name'] || 'there', won);
    } catch (emailErr) {
      console.error('Review reward email failed:', emailErr.message);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ alreadySpun: false, prize: won, ...PRIZE_CODES[won] }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};