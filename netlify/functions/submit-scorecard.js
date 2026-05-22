// netlify/functions/submit-scorecard.js
// Submits Phase 1 interview scorecard results to Airtable Recruitment base

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
    const {
      candidateName,
      roleAppliedFor,
      interviewer,
      date,
      score,
      verdict,
      answers,
      notes
    } = JSON.parse(event.body);

    const tableId = process.env.AIRTABLE_PHASE_1_INTERVIEW_SCORECARD_TABL;

    if (!tableId) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Scorecard table not configured. Add AIRTABLE_PHASE_1_INTERVIEW_SCORECARD_TABL to Netlify env vars.'
        })
      };
    }

    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_RECRUITMENT_BASE_ID}/${tableId}`;

    // Helper — each question field stores Yes, No, or Not answered
    const ans = (id) => answers[id] === true ? 'Yes' : answers[id] === false ? 'No' : 'Not answered';

    // Helper — append notes to answer if present
    const field = (id) => {
      const a = ans(id);
      const n = notes[id] ? notes[id].trim() : '';
      return n ? `${a} — ${n}` : a;
    };

    const fields = {
      'Candidate Name':                                             candidateName,
      'Role Applied For':                                           roleAppliedFor || '',
      'Interviewer':                                                interviewer || '',
      'Date':                                                       date,
      'Score':                                                      score,
      'Verdict':                                                    verdict,
      'Are they based in and around Sheffield?':                    field(1),
      'What do they currently do?':                                 field(2),
      'What have they done in the past?':                           field(3),
      'What is their goal for the future?':                         field(4),
      'What are their interests outside of work?':                  field(5),
      'Do they drive and have their own vehicle?':                  field(6),
      'Are they available or on a notice period?':                  field(7),
      'Do they have relevant skills or tools experience?':          field(8),
      'Do they come across as motivated and commercially aware?':   field(9),
      'Do they show resilience and a positive attitude under pressure?': field(10),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_RECRUITMENT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Airtable error:', data);
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          success: false,
          error: data.error?.message || 'Airtable submission failed'
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, recordId: data.id })
    };

  } catch (error) {
    console.error('Submit scorecard error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};