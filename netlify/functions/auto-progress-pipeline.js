const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Maps each stage to what it auto-advances to after 7 days of no update.
// Stages not listed here (New, Responded, Meeting Booked, Proposal Sent, Won, Lost, Closed)
// never auto-advance — they only move when someone changes them manually.
const PROGRESSION = {
  'Contacted': 'Follow Up 1',
  'Follow Up 1': 'Follow Up 2',
  'Follow Up 2': 'Follow Up 3',
  'Follow Up 3': 'Closed'
};

exports.handler = async function () {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoff = sevenDaysAgo.toISOString().split('T')[0];

  let movedCount = 0;
  const movedDetails = [];

  try {
    const stageFilter = Object.keys(PROGRESSION)
      .map(s => `{Stage} = "${s}"`)
      .join(',');

    const records = await base('Prospects')
      .select({
        filterByFormula: `AND(
          OR(${stageFilter}),
          IS_BEFORE({Stage Changed Date}, "${cutoff}")
        )`
      })
      .all();

    for (const record of records) {
      const currentStage = record.get('Stage');
      const nextStage = PROGRESSION[currentStage];
      if (!nextStage) continue;

      await base('Prospects').update(record.id, {
        'Stage': nextStage,
        'Stage Changed Date': todayStr,
        'Updated Date': todayStr
      });

      movedCount++;
      movedDetails.push({
        id: record.id,
        name: record.get('Name') || record.get('Email'),
        from: currentStage,
        to: nextStage
      });
    }

    console.log(`auto-progress-pipeline: moved ${movedCount} prospect(s)`, movedDetails);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, moved: movedCount, details: movedDetails })
    };

  } catch (error) {
    console.error('auto-progress-pipeline error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};