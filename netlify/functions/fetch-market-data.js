const fetch = require('node-fetch');

// UK House Price Index API (Government - Free)
const HPI_API_BASE = 'http://landregistry.data.gov.uk/data/ukhpi';

// Complete mapping of all UK regions to official HPI region codes
const REGION_CODES = {
  // England - Regional groupings
  'North East': 'E12000001',
  'North West': 'E12000002',
  'Yorkshire and The Humber': 'E12000003',
  'East Midlands': 'E12000004',
  'West Midlands': 'E12000005',
  'East of England': 'E12000006',
  'London': 'E12000007',
  'South East': 'E12000008',
  'South West': 'E12000009',
  
  // Your 7 core service regions (mapped to specific codes)
  'Yorkshire': 'E12000003',
  'Cheshire': 'E06000050',
  'Essex': 'E10000012',
  'Manchester': 'E11000001',
  'Leicester': 'E06000016',
  
  // England - All Counties & Unitary Authorities
  'Bedfordshire': 'E10000001',
  'Berkshire': 'E10000002',
  'Bristol': 'E06000023',
  'Buckinghamshire': 'E10000003',
  'Cambridgeshire': 'E10000003',
  'Cornwall': 'E06000052',
  'Cumbria': 'E10000006',
  'Derbyshire': 'E10000007',
  'Devon': 'E10000008',
  'Dorset': 'E06000059',
  'Durham': 'E06000047',
  'East Sussex': 'E10000011',
  'Gloucestershire': 'E10000013',
  'Greater London': 'E12000007',
  'Greater Manchester': 'E11000001',
  'Hampshire': 'E10000014',
  'Herefordshire': 'E06000019',
  'Hertfordshire': 'E10000015',
  'Isle of Wight': 'E06000046',
  'Kent': 'E10000016',
  'Lancashire': 'E10000017',
  'Leicestershire': 'E10000018',
  'Lincolnshire': 'E10000019',
  'Merseyside': 'E11000002',
  'Norfolk': 'E10000020',
  'Northamptonshire': 'E10000021',
  'Northumberland': 'E06000057',
  'North Yorkshire': 'E10000023',
  'Nottinghamshire': 'E10000024',
  'Oxfordshire': 'E10000025',
  'Rutland': 'E06000017',
  'Shropshire': 'E06000051',
  'Somerset': 'E10000027',
  'South Yorkshire': 'E11000003',
  'Staffordshire': 'E10000028',
  'Suffolk': 'E10000029',
  'Surrey': 'E10000030',
  'Tyne and Wear': 'E11000007',
  'Warwickshire': 'E10000031',
  'West Sussex': 'E10000032',
  'West Yorkshire': 'E11000006',
  'Wiltshire': 'E06000054',
  'Worcestershire': 'E10000034',
  
  // Scotland - All Council Areas
  'Scotland': 'S92000003',
  'Aberdeenshire': 'S12000034',
  'Angus': 'S12000041',
  'Argyll and Bute': 'S12000035',
  'City of Edinburgh': 'S12000036',
  'Clackmannanshire': 'S12000005',
  'Dumfries and Galloway': 'S12000006',
  'Dundee City': 'S12000042',
  'East Ayrshire': 'S12000008',
  'East Dunbartonshire': 'S12000045',
  'East Lothian': 'S12000010',
  'East Renfrewshire': 'S12000011',
  'Falkirk': 'S12000014',
  'Fife': 'S12000015',
  'Glasgow City': 'S12000049',
  'Highland': 'S12000017',
  'Inverclyde': 'S12000018',
  'Midlothian': 'S12000019',
  'Moray': 'S12000020',
  'North Ayrshire': 'S12000021',
  'North Lanarkshire': 'S12000050',
  'Orkney Islands': 'S12000023',
  'Perth and Kinross': 'S12000048',
  'Renfrewshire': 'S12000038',
  'Scottish Borders': 'S12000026',
  'Shetland Islands': 'S12000027',
  'South Ayrshire': 'S12000028',
  'South Lanarkshire': 'S12000029',
  'Stirling': 'S12000030',
  'West Dunbartonshire': 'S12000039',
  'West Lothian': 'S12000040',
  'Western Isles': 'S12000013',
  
  // Wales - All Principal Areas
  'Wales': 'W92000004',
  'Anglesey': 'W06000001',
  'Blaenau Gwent': 'W06000019',
  'Bridgend': 'W06000013',
  'Caerphilly': 'W06000018',
  'Cardiff': 'W06000015',
  'Carmarthenshire': 'W06000010',
  'Ceredigion': 'W06000008',
  'Conwy': 'W06000003',
  'Denbighshire': 'W06000004',
  'Flintshire': 'W06000005',
  'Gwynedd': 'W06000002',
  'Merthyr Tydfil': 'W06000024',
  'Monmouthshire': 'W06000021',
  'Neath Port Talbot': 'W06000012',
  'Newport': 'W06000022',
  'Pembrokeshire': 'W06000009',
  'Powys': 'W06000023',
  'Rhondda Cynon Taf': 'W06000016',
  'Swansea': 'W06000011',
  'Torfaen': 'W06000020',
  'Vale of Glamorgan': 'W06000014',
  'Wrexham': 'W06000006',
  
  // Northern Ireland - All Districts
  'Northern Ireland': 'N92000002',
  'Antrim': 'N09000001',
  'Armagh': 'N09000002',
  'Down': 'N09000003',
  'Fermanagh': 'N09000004',
  'Londonderry': 'N09000005',
  'Tyrone': 'N09000006'
};

async function getMarketData(region) {
  const regionCode = REGION_CODES[region];
  
  if (!regionCode) {
    throw new Error(`Unknown region: ${region}. Please check region mapping.`);
  }

  try {
    // SPARQL query to get last 12 months of data from UK HPI
    const query = `
      PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      
      SELECT ?date ?averagePrice ?salesVolume ?monthlyChange ?annualChange
      WHERE {
        ?data ukhpi:refRegion <http://landregistry.data.gov.uk/id/region/${regionCode}> ;
              ukhpi:refMonth ?month ;
              ukhpi:averagePrice ?averagePrice ;
              ukhpi:salesVolume ?salesVolume ;
              ukhpi:percentageChange ?monthlyChange ;
              ukhpi:percentageAnnualChange ?annualChange .
        
        ?month rdfs:label ?date .
      }
      ORDER BY DESC(?date)
      LIMIT 12
    `;

    const response = await fetch(`${HPI_API_BASE}/query?query=${encodeURIComponent(query)}`, {
      headers: { 
        'Accept': 'application/sparql-results+json'
      }
    });

    if (!response.ok) {
      throw new Error(`HPI API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.results || !data.results.bindings || data.results.bindings.length === 0) {
      throw new Error(`No data available for ${region}. The API may not have recent data for this region.`);
    }

    // Parse and format data
    const results = data.results.bindings.map(row => ({
      date: row.date.value,
      averagePrice: parseFloat(row.averagePrice.value),
      salesVolume: parseInt(row.salesVolume.value),
      monthlyChange: parseFloat(row.monthlyChange.value),
      annualChange: parseFloat(row.annualChange.value)
    }));

    // Sort by date (newest first)
    results.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Get key data points
    const latest = results[0];
    const previous = results[1] || latest;
    const yearAgo = results[11] || results[results.length - 1];

    // Calculate market statistics
    const marketData = {
      region,
      regionCode,
      currentMonth: latest.date,
      averagePrice: latest.averagePrice,
      salesVolume: latest.salesVolume,
      monthlyChange: latest.monthlyChange,
      annualChange: latest.annualChange,
      
      // Month-over-month comparisons
      priceVsPreviousMonth: latest.averagePrice - previous.averagePrice,
      volumeVsPreviousMonth: latest.salesVolume - previous.salesVolume,
      
      // Year-over-year comparisons
      priceVsYearAgo: latest.averagePrice - yearAgo.averagePrice,
      volumeVsYearAgo: latest.salesVolume - yearAgo.salesVolume,
      
      // Historical data for charts (reversed to chronological order)
      historicalPrices: results.reverse().map(r => ({
        month: r.date,
        price: r.averagePrice
      })),
      
      historicalVolumes: results.map(r => ({
        month: r.date,
        volume: r.salesVolume
      })),
      
      historicalChanges: results.map(r => ({
        month: r.date,
        monthlyChange: r.monthlyChange,
        annualChange: r.annualChange
      })),
      
      // Market health score
      marketHealth: calculateMarketHealth(latest),
      
      // Metadata
      dataSource: 'UK House Price Index (HM Land Registry)',
      lastUpdated: new Date().toISOString()
    };

    return marketData;

  } catch (error) {
    console.error(`Error fetching market data for ${region}:`, error);
    throw error;
  }
}

// Calculate market health score (0-100)
function calculateMarketHealth(data) {
  let score = 50; // Neutral baseline
  
  // Factor 1: Annual price change (±30 points max)
  // Healthy growth: +3-8% per year
  if (data.annualChange >= 3 && data.annualChange <= 8) {
    score += 20;
  } else if (data.annualChange > 8) {
    // Overheating market
    score += Math.min(30, 10 + (data.annualChange - 8));
  } else if (data.annualChange < 0) {
    // Declining market
    score += Math.max(-30, data.annualChange * 2);
  } else {
    // Slow growth (0-3%)
    score += data.annualChange * 5;
  }
  
  // Factor 2: Sales volume (±20 points max)
  // Normalize based on typical ranges
  // Low volume: <500, Medium: 500-3000, High: >3000
  if (data.salesVolume > 3000) {
    score += 20;
  } else if (data.salesVolume > 1500) {
    score += 10;
  } else if (data.salesVolume < 500) {
    score -= 10;
  }
  
  // Factor 3: Monthly momentum (±10 points max)
  if (data.monthlyChange > 1) {
    score += 10;
  } else if (data.monthlyChange < -1) {
    score -= 10;
  } else {
    score += data.monthlyChange * 5;
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