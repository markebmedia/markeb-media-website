// netlify/functions/get-client-gallery.js
// Fetches Client Reviews records for the logged-in client (opted-in only)

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = 'Client Reviews';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userEmail } = JSON.parse(event.body || '{}');

    if (!userEmail) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'userEmail is required' }),
      };
    }

    // Only return records where email matches AND Opted In is checked
    const formula = encodeURIComponent(
      `AND(
        LOWER({Client Email}) = "${userEmail.toLowerCase().trim()}",
        {Opted In} = TRUE()
      )`
    );

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NAME)}?filterByFormula=${formula}&sort[0][field]=Created At&sort[0][direction]=desc`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Airtable error:', err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to fetch from Airtable' }),
      };
    }

    const data = await response.json();

    const projects = (data.records || []).map((record) => {
      const f = record.fields;
      return {
        id: record.id,
        bookingId: f['Booking ID'] || '',
        projectAddress: f['Project Address'] || 'Unnamed Project',
        clientEmail: f['Client Email'] || '',

        // Split media links — only present if that media type was captured
        photosLink: f['Photos Dropbox Link'] || '',
        videoLink:  f['Video Dropbox Link']  || '',

        // Split client notes — one per media type
        photosNotes: f['Photos Notes'] || '',
        videoNotes:  f['Video Notes']  || '',

        // Status & meta
        reviewStatus:      f['Review Status']      || 'Pending Review',
        submittedAt:       f['Submitted At']        || null,
        createdAt:         f['Created At']          || record.createdTime,
        shootDate:         f['Shoot Date']          || null,
        serviceType:       f['Service Type']        || '',
        photographerName:  f['Photographer Name']   || '',
        photoCount:        f['Photo Count']         || null,
        videoCount:        f['Video Count']         || null,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, projects }),
    };
  } catch (error) {
    console.error('get-client-gallery error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};