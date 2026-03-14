// netlify/functions/get-route-times.js
// Returns drive times and distances between consecutive postcodes
// Uses Google Maps Distance Matrix API

const fetch = require('node-fetch');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { postcodes } = body;

  if (!postcodes || !Array.isArray(postcodes) || postcodes.length < 2) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'At least 2 postcodes required', legs: [] })
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Google Maps API key not configured', legs: [] })
    };
  }

  const legs = [];

  // Calculate drive time between each consecutive pair
  for (let i = 0; i < postcodes.length - 1; i++) {
    const origin      = encodeURIComponent(postcodes[i] + ', UK');
    const destination = encodeURIComponent(postcodes[i + 1] + ', UK');

    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&mode=driving&units=imperial&departure_time=now&key=${apiKey}`;
      const res  = await fetch(url);
      const data = await res.json();

      if (data.status !== 'OK') {
        legs.push({ error: `API error: ${data.status}`, minutes: null, miles: null });
        continue;
      }

      const element = data.rows[0]?.elements[0];

      if (!element || element.status !== 'OK') {
        legs.push({ error: `No route found: ${element?.status}`, minutes: null, miles: null });
        continue;
      }

      const duration = element.duration_in_traffic || element.duration;
      const distance = element.distance;

      const minutes = Math.ceil(duration.value / 60);
      // Distance Matrix with units=imperial returns miles
      const miles   = (distance.value * 0.000621371).toFixed(1);

      legs.push({
        from:    postcodes[i],
        to:      postcodes[i + 1],
        minutes,
        miles,
        error:   null
      });

    } catch (err) {
      console.error(`Error getting drive time ${postcodes[i]} → ${postcodes[i + 1]}:`, err);
      legs.push({ error: err.message, minutes: null, miles: null });
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ legs })
  };
};