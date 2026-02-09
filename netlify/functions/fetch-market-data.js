const fetch = require('node-fetch');

// UK House Price Index SPARQL Endpoint
const SPARQL_ENDPOINT = 'https://landregistry.data.gov.uk/landregistry/query';

// ✅ CORRECTED: Complete mapping of UK regions to official HPI region codes
const REGION_CODE_MAP = {
  // ===== YOUR SERVICE REGIONS (CORRECTED) =====
  'Cheshire East': 'E06000049',
  'Cheshire West and Chester': 'E06000050',
  'Greater London': 'E12000007',
  'Greater Manchester': 'E11000001',
  'Essex': 'E10000012',
  'West Midlands': 'E11000005',
  'Leicestershire': 'E10000018',
  
  // ===== YORKSHIRE & HUMBER =====
  'South Yorkshire': 'E11000003',
  'West Yorkshire': 'E11000006',
  'North Yorkshire': 'E10000023',
  'East Riding of Yorkshire': 'E06000011',
  'York': 'E06000014',
  
  // ===== NORTH WEST ENGLAND =====
  'Cumbria': 'E10000006',
  'Lancashire': 'E10000017',
  'Merseyside': 'E11000002',
  'Blackburn with Darwen': 'E06000008',
  'Blackpool': 'E06000009',
  'Halton': 'E06000006',
  'Warrington': 'E06000007',
  
  // ===== NORTH EAST ENGLAND =====
  'County Durham': 'E06000047',
  'Northumberland': 'E06000057',
  'Tyne and Wear': 'E11000007',
  
  // ===== MIDLANDS =====
  'Derbyshire': 'E10000007',
  'Derby': 'E06000015',
  'Herefordshire': 'E06000019',
  'Lincolnshire': 'E10000019',
  'Northamptonshire': 'E10000021',
  'Nottinghamshire': 'E10000024',
  'Nottingham': 'E06000018',
  'Rutland': 'E06000017',
  'Shropshire': 'E06000051',
  'Telford and Wrekin': 'E06000020',
  'Staffordshire': 'E10000028',
  'Stoke-on-Trent': 'E06000021',
  'Warwickshire': 'E10000031',
  'Worcestershire': 'E10000034',
  
  // ===== EAST ENGLAND =====
  'Bedford': 'E06000055',
  'Central Bedfordshire': 'E06000056',
  'Cambridgeshire': 'E10000003',
  'Peterborough': 'E06000031',
  'Hertfordshire': 'E10000015',
  'Norfolk': 'E10000020',
  'Suffolk': 'E10000029',
  
  // ===== SOUTH EAST ENGLAND =====
  'Berkshire': 'E10000002',
  'Buckinghamshire': 'E06000060',
  'East Sussex': 'E10000011',
  'Brighton and Hove': 'E06000043',
  'Hampshire': 'E10000014',
  'Portsmouth': 'E06000044',
  'Southampton': 'E06000045',
  'Isle of Wight': 'E06000046',
  'Kent': 'E10000016',
  'Medway': 'E06000035',
  'Oxfordshire': 'E10000025',
  'Surrey': 'E10000030',
  'West Sussex': 'E10000032',
  
  // ===== SOUTH WEST ENGLAND =====
  'Bristol': 'E06000023',
  'Cornwall': 'E06000052',
  'Devon': 'E10000008',
  'Plymouth': 'E06000026',
  'Torbay': 'E06000027',
  'Dorset': 'E06000059',
  'Bournemouth, Christchurch and Poole': 'E06000058',
  'Gloucestershire': 'E10000013',
  'Somerset': 'E10000027',
  'Bath and North East Somerset': 'E06000022',
  'North Somerset': 'E06000024',
  'South Gloucestershire': 'E06000025',
  'Wiltshire': 'E06000054',
  'Swindon': 'E06000030',
  
  // ===== SCOTLAND =====
  'Aberdeen City': 'S12000033',
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
  'Na h-Eileanan Siar': 'S12000013',
  
  // ===== WALES =====
  'Isle of Anglesey': 'W06000001',
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
  
  // ===== NORTHERN IRELAND =====
  'Antrim and Newtownabbey': 'N09000001',
  'Ards and North Down': 'N09000011',
  'Armagh City, Banbridge and Craigavon': 'N09000002',
  'Belfast': 'N09000003',
  'Causeway Coast and Glens': 'N09000004',
  'Derry City and Strabane': 'N09000005',
  'Fermanagh and Omagh': 'N09000006',
  'Lisburn and Castlereagh': 'N09000007',
  'Mid and East Antrim': 'N09000008',
  'Mid Ulster': 'N09000009',
  'Newry, Mourne and Down': 'N09000010'
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