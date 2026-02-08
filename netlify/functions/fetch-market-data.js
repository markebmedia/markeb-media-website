const fetch = require('node-fetch');

// UK House Price Index SPARQL Endpoint
const SPARQL_ENDPOINT = 'https://landregistry.data.gov.uk/landregistry/query';

// Complete mapping of all UK regions to official HPI region codes
const REGION_CODE_MAP = {
  // Your Service Regions
  'Cheshire': 'E06000050',
  'Greater London': 'E12000007',
  'Greater Manchester': 'E11000001',
  'Essex': 'E10000012',
  'West Midlands': 'E11000005',
  'Leicestershire': 'E10000018',
  
  // Yorkshire & Humber
  'South Yorkshire': 'E11000003',
  'West Yorkshire': 'E11000006',
  'North Yorkshire': 'E10000023',
  'East Riding of Yorkshire': 'E06000011',
  
  // North West England
  'Cumbria': 'E10000006',
  'Lancashire': 'E10000017',
  'Merseyside': 'E11000002',
  
  // North East England
  'County Durham': 'E06000047',
  'Northumberland': 'E06000057',
  'Tyne and Wear': 'E11000007',
  
  // Midlands
  'Derbyshire': 'E10000007',
  'Herefordshire': 'E06000019',
  'Lincolnshire': 'E10000019',
  'Northamptonshire': 'E10000021',
  'Nottinghamshire': 'E10000024',
  'Rutland': 'E06000017',
  'Shropshire': 'E06000051',
  'Staffordshire': 'E10000028',
  'Warwickshire': 'E10000031',
  'Worcestershire': 'E10000034',
  
  // East England
  'Bedfordshire': 'E06000055',
  'Cambridgeshire': 'E10000003',
  'Hertfordshire': 'E10000015',
  'Norfolk': 'E10000020',
  'Suffolk': 'E10000029',
  
  // South East England
  'Berkshire': 'E06000037',
  'Buckinghamshire': 'E10000002',
  'East Sussex': 'E10000011',
  'Hampshire': 'E10000014',
  'Isle of Wight': 'E06000046',
  'Kent': 'E10000016',
  'Oxfordshire': 'E10000025',
  'Surrey': 'E10000030',
  'West Sussex': 'E10000032',
  
  // South West England
  'Bristol': 'E06000023',
  'Cornwall': 'E06000052',
  'Devon': 'E10000008',
  'Dorset': 'E06000059',
  'Gloucestershire': 'E10000013',
  'Somerset': 'E10000027',
  'Wiltshire': 'E06000054',
  
  // Scotland
  'City of Edinburgh': 'S12000036',
  'Glasgow City': 'S12000049',
  'Aberdeenshire': 'S12000034',
  'Angus': 'S12000041',
  'Dumfries and Galloway': 'S12000006',
  'Fife': 'S12000015',
  'Highland': 'S12000017',
  'North Lanarkshire': 'S12000050',
  'Perth and Kinross': 'S12000048',
  'Scottish Borders': 'S12000026',
  'South Lanarkshire': 'S12000029',
  'Stirling': 'S12000030',
  
  // Wales
  'Cardiff': 'W06000015',
  'Swansea': 'W06000011',
  'Newport': 'W06000022',
  'Carmarthenshire': 'W06000010',
  'Ceredigion': 'W06000008',
  'Gwynedd': 'W06000002',
  'Pembrokeshire': 'W06000009',
  'Powys': 'W06000023',
  
  // Northern Ireland
  'Antrim': 'N09000001',
  'Armagh': 'N09000002',
  'Down': 'N09000003',
  'Fermanagh': 'N09000004',
  'Londonderry': 'N09000005',
  'Tyrone': 'N09000006'
};

async function getMarketData(region) {
  // Map friendly region name to HPI code
  const regionCode = REGION_CODE_MAP[region];
  
  if (!regionCode) {
    throw new Error(`Region "${region}" not found in mapping. Please check the region name.`);
  }
  
  console.log(`Fetching market data for: ${region} (code: ${regionCode})`);
  
  const query = `
    PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    
    SELECT ?month ?price ?volume ?monthlyChange ?annualChange
    WHERE {
      ?data ukhpi:refRegion <http://landregistry.data.gov.uk/id/region/${regionCode}> ;
            ukhpi:refPeriodStart ?month ;
            ukhpi:averagePrice ?price ;
            ukhpi:salesVolume ?volume ;
            ukhpi:percentageChange ?monthlyChange ;
            ukhpi:percentageAnnualChange ?annualChange .
    }
    ORDER BY DESC(?month)
    LIMIT 12
  `;
  
  try {
    const response = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json'
      },
      body: query
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HPI API Error (${response.status}):`, errorText);
      throw new Error(`HPI API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.results || !data.results.bindings || data.results.bindings.length === 0) {
      throw new Error(`No data available for ${region} (${regionCode})`);
    }
    
    // Parse the results
    const results = data.results.bindings;
    const historicalPrices = [];
    const historicalVolumes = [];
    
    // Results come in reverse chronological order (newest first)
    // Reverse them so oldest is first for our arrays
    results.reverse().forEach(result => {
      historicalPrices.push({
        month: result.month.value,
        price: parseFloat(result.price.value)
      });
      
      historicalVolumes.push({
        month: result.month.value,
        volume: parseInt(result.volume.value)
      });
    });
    
    // Get latest data point (last in array after reversing)
    const latest = results[results.length - 1];
    
    const averagePrice = parseFloat(latest.price.value);
    const salesVolume = parseInt(latest.volume.value);
    const monthlyChange = parseFloat(latest.monthlyChange.value);
    const annualChange = parseFloat(latest.annualChange.value);
    const currentMonth = latest.month.value;
    
    // Calculate market health score
    const marketHealth = calculateMarketHealth(annualChange, salesVolume, monthlyChange);
    
    return {
      region,
      regionCode,
      currentMonth,
      averagePrice,
      salesVolume,
      monthlyChange,
      annualChange,
      marketHealth,
      historicalPrices,
      historicalVolumes
    };
    
  } catch (error) {
    console.error(`Error fetching market data for ${region}:`, error);
    throw error;
  }
}

// Calculate market health score (0-100)
function calculateMarketHealth(annualChange, salesVolume, monthlyChange) {
  let score = 50; // Neutral baseline
  
  // Factor 1: Annual price change (±30 points max)
  // Healthy growth: +3-8% per year
  if (annualChange >= 3 && annualChange <= 8) {
    score += 20;
  } else if (annualChange > 8) {
    // Overheating market
    score += Math.min(30, 10 + (annualChange - 8));
  } else if (annualChange < 0) {
    // Declining market
    score += Math.max(-30, annualChange * 2);
  } else {
    // Slow growth (0-3%)
    score += annualChange * 5;
  }
  
  // Factor 2: Sales volume (±20 points max)
  // Normalize based on typical ranges
  // Low volume: <500, Medium: 500-3000, High: >3000
  if (salesVolume > 3000) {
    score += 20;
  } else if (salesVolume > 1500) {
    score += 10;
  } else if (salesVolume < 500) {
    score -= 10;
  }
  
  // Factor 3: Monthly momentum (±10 points max)
  if (monthlyChange > 1) {
    score += 10;
  } else if (monthlyChange < -1) {
    score -= 10;
  } else {
    score += monthlyChange * 5;
  }
  
  // Cap score between 0-100
  score = Math.min(Math.max(score, 0), 100);
  
  // Determine status label
  let status = 'Neutral';
  let emoji = '➖';
  
  if (score >= 80) {
    status = 'Very Strong';
    emoji = '🔥';
  } else if (score >= 65) {
    status = 'Strong';
    emoji = '📈';
  } else if (score >= 50) {
    status = 'Healthy';
    emoji = '✅';
  } else if (score >= 35) {
    status = 'Weak';
    emoji = '⚠️';
  } else if (score >= 20) {
    status = 'Declining';
    emoji = '📉';
  } else {
    status = 'Distressed';
    emoji = '🚨';
  }
  
  return { 
    score: Math.round(score), 
    status,
    emoji
  };
}

// Format price for display
function formatPrice(price) {
  return `£${price.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}

// Format percentage change
function formatPercentage(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers,
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
    };
  }

  try {
    const { region } = JSON.parse(event.body);

    if (!region) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Region is required' 
        })
      };
    }

    console.log(`Fetching market data for: ${region}`);
    const marketData = await getMarketData(region);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: marketData,
        formatted: {
          averagePrice: formatPrice(marketData.averagePrice),
          monthlyChange: formatPercentage(marketData.monthlyChange),
          annualChange: formatPercentage(marketData.annualChange)
        }
      })
    };

  } catch (error) {
    console.error('Error in fetch-market-data:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to fetch market data',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};