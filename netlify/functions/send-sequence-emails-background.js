// netlify/functions/send-sequence-emails-background.js
//
// Runs on a schedule (see netlify.toml) — finds every active sequence
// enrollment due today, looks up the LINKED Prospect record to get live
// name/email/company, sends the current step's email with %name% (first
// name), %company% and %email% merge tags replaced, then advances the
// enrollment to the next step (or marks it Completed).
//
// Sends are grouped into batches of 5 with a pause between each batch so we
// never fire a burst of emails at once. Named "-background" so Netlify gives
// it up to 15 minutes of runtime instead of the normal 10s limit.

const Airtable = require('airtable');
const { sendGenericEmail } = require('./email-service'); // see note at bottom

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

const BATCH_SIZE = 5;
const PAUSE_BETWEEN_BATCHES_MS = 4000; // 4s pause between each group of 5
const PAUSE_BETWEEN_EMAILS_MS = 500;   // small stagger within a batch

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function getFirstName(fullName) {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0];
}

function mergeTags(template, data) {
  return (template || '')
    .replace(/%name%/gi, data.firstName || '')
    .replace(/%company%/gi, data.company || '')
    .replace(/%email%/gi, data.email || '');
}

exports.handler = async (event) => {
  console.log('=== Send Sequence Emails (Background) ===');
  console.log('Triggered at:', new Date().toISOString());

  const today = todayStr();

  try {
    // 1. Fetch every active enrollment due to send today or earlier (catches anything missed)
    const enrollments = await base('Sequence Enrollments')
      .select({
        filterByFormula: `AND(
          {Status} = 'Active',
          {Next Send Date} <= '${today}'
        )`
      })
      .all();

    console.log(`Found ${enrollments.length} enrollment(s) due to send`);

    if (enrollments.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No enrollments due', count: 0 })
      };
    }

    // 2. Cache sequences so we don't refetch the same one per-enrollment
    const sequenceCache = {};
    async function getSequence(sequenceId) {
      if (sequenceCache[sequenceId]) return sequenceCache[sequenceId];
      const record = await base('Email Sequences').find(sequenceId);
      let steps = [];
      try {
        steps = JSON.parse(record.fields['Steps JSON'] || '[]');
      } catch (e) {
        steps = [];
      }
      sequenceCache[sequenceId] = { active: record.fields['Active'] === true, steps };
      return sequenceCache[sequenceId];
    }

    // Cache prospects too, in case the same prospect somehow has multiple due enrollments
    const prospectCache = {};
    async function getProspect(prospectId) {
      if (prospectCache[prospectId]) return prospectCache[prospectId];
      const record = await base('Prospects').find(prospectId);
      prospectCache[prospectId] = record;
      return record;
    }

    const results = [];

    // 3. Process in batches of 5
    for (let i = 0; i < enrollments.length; i += BATCH_SIZE) {
      const batch = enrollments.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} enrollment${batch.length !== 1 ? 's' : ''})`);

      for (const record of batch) {
        const f = record.fields;
        const enrollmentId = record.id;
        const sequenceId = f['Sequence ID'];
        const currentStep = f['Current Step'] || 0;
        const linkedProspectIds = f['Prospect'] || []; // Airtable link fields are arrays of record IDs

        try {
          if (!linkedProspectIds.length) {
            await base('Sequence Enrollments').update(enrollmentId, { 'Status': 'Stopped' });
            results.push({ enrollmentId, status: 'stopped', reason: 'no linked prospect' });
            continue;
          }

          // Fetch the live prospect record — if it's been deleted, this throws and we catch below
          const prospectRecord = await getProspect(linkedProspectIds[0]);
          const prospectFields = prospectRecord.fields;
          const email = prospectFields['Email'];

          if (!email) {
            results.push({ enrollmentId, status: 'skipped', reason: 'prospect has no email' });
            continue;
          }

          const sequence = await getSequence(sequenceId);

          if (!sequence.active) {
            // Sequence was paused/deactivated centrally — pause this enrollment too
            await base('Sequence Enrollments').update(enrollmentId, { 'Status': 'Paused' });
            results.push({ enrollmentId, status: 'paused', reason: 'sequence inactive' });
            continue;
          }

          const step = sequence.steps[currentStep];

          if (!step) {
            // No more steps — mark complete
            await base('Sequence Enrollments').update(enrollmentId, { 'Status': 'Completed' });
            results.push({ enrollmentId, status: 'completed' });
            continue;
          }

          const mergeData = {
            firstName: getFirstName(prospectFields['Name']),
            company: prospectFields['Company'] || '',
            email
          };

          await sendGenericEmail({
            to: email,
            subject: mergeTags(step.subject, mergeData),
            html: mergeTags(step.body, mergeData)
          });

          const nextStep = sequence.steps[currentStep + 1];
          const nextSendDate = nextStep
            ? new Date(Date.now() + (nextStep.day - step.day) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
            : null;

          await base('Sequence Enrollments').update(enrollmentId, {
            'Current Step': currentStep + 1,
            'Last Sent Date': today,
            'Next Send Date': nextSendDate,
            'Status': nextStep ? 'Active' : 'Completed'
          });

          console.log(`✅ Sent step ${currentStep} of "${f['Sequence Name']}" to ${email} (${mergeData.firstName})`);
          results.push({ enrollmentId, status: 'sent', email, step: currentStep });

        } catch (err) {
          console.error(`❌ Failed enrollment ${enrollmentId}:`, err.message);
          results.push({ enrollmentId, status: 'failed', error: err.message });
        }

        // Stagger individual sends within the batch
        await sleep(PAUSE_BETWEEN_EMAILS_MS);
      }

      // Pause between batches of 5 (skip the pause after the very last batch)
      if (i + BATCH_SIZE < enrollments.length) {
        await sleep(PAUSE_BETWEEN_BATCHES_MS);
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const completed = results.filter(r => r.status === 'completed').length;

    console.log(`Summary: ${sent} sent, ${failed} failed, ${completed} completed`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Sequence emails processed for ${today}`,
        sent,
        failed,
        completed,
        results
      })
    };

  } catch (error) {
    console.error('Error in send-sequence-emails:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process sequence emails', details: error.message })
    };
  }
};