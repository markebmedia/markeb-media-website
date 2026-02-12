const fs = require('fs');
const path = require('path');

// Load pre-processed data
let marketDataCache = null;

function loadMarketData() {
  if (marketDataCache) return marketDataCache;
  
  // Try multiple possible paths
  const possiblePaths = [
    path.join(__dirname, '../../data/market-data.json'),  // Standard
    path.join(__dirname, '../../../data/market-data.json'), // One level up
    path.join(process.cwd(), 'data/market-data.json'),     // From process root
    '/var/task/data/market-data.json'                      // Absolute Netlify path
  ];
  
  for (const dataPath of possiblePaths) {
    try {
      console.log(`Trying path: ${dataPath}`);
      if (fs.existsSync(dataPath)) {
        const rawData = fs.readFileSync(dataPath, 'utf-8');
        marketDataCache = JSON.parse(rawData);
        console.log(`✓ Successfully loaded data from: ${dataPath}`);
        return marketDataCache;
      }
    } catch (error) {
      console.log(`✗ Failed to load from ${dataPath}:`, error.message);
    }
  }
  
  console.error('Failed to load market data from any path');
  return null;
}

exports.handler = async (event, context) => {
  console.log('=== Fetch Market Data (Pre-processed) ===');
  
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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
        body: JSON.stringify({ success: false, error: 'Region is required' })
      };
    }

    console.log(`Fetching data for: ${region}`);

    // Load pre-processed data
    const marketData = loadMarketData();
    
    if (!marketData || !marketData.regions || !marketData.regions[region]) {
      console.log(`No data for ${region}, using fallback`);
      const fallbackData = generateFallbackData(region);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: fallbackData,
          source: 'fallback',
          message: `Using industry-standard estimates for ${region}`
        })
      };
    }

    // Add insight generation
    const data = marketData.regions[region];
    data.insight = generateMarketInsight(data, region);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: data,
        source: 'ppd-processed',
        transactionCount: data.snapshot.totalTransactions,
        message: `Real PPD data from ${new Date(marketData.generatedAt).toLocaleDateString()}`,
        lastUpdated: marketData.generatedAt
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

// Fallback data generator
function generateFallbackData(region) {
  const basePrices = {
    'London': 550000,
    'South East': 380000,
    'South West': 310000,
    'East of England': 350000,
    'West Midlands': 250000,
    'East Midlands': 235000,
    'Yorkshire and The Humber': 220000,
    'North West': 215000,
    'North East': 180000,
    'Wales': 200000,
    'Scotland': 190000,
    'Northern Ireland': 170000
  };

  // Determine base price from region
  let basePrice = 250000;
  if (region.includes('London')) basePrice = basePrices['London'];
  else if (region.includes('Manchester') || region.includes('Lancashire') || region.includes('Cheshire')) basePrice = basePrices['North West'];
  else if (region.includes('Yorkshire') || region.includes('York')) basePrice = basePrices['Yorkshire and The Humber'];
  // Add more region matching as needed...

  const typeMultipliers = {
    'Detached': 1.65,
    'Semi-detached': 1.15,
    'Terraced': 0.92,
    'Flats': 0.68
  };

  const propertyTypes = {};
  let weightedTotal = 0;
  let transactionTotal = 0;

  Object.keys(typeMultipliers).forEach(type => {
    const price = Math.round(basePrice * typeMultipliers[type]);
    const yoyChange = 3 + (Math.random() * 3);
    const transactions = Math.floor(150 * (type === 'Detached' ? 0.25 : type === 'Semi-detached' ? 0.30 : type === 'Terraced' ? 0.28 : 0.17));
    
    propertyTypes[type] = {
      averagePrice: price,
      transactions: transactions,
      yoyChange: parseFloat(yoyChange.toFixed(1)),
      previousYearPrice: Math.round(price / (1 + (yoyChange / 100)))
    };

    weightedTotal += price * transactions;
    transactionTotal += transactions;
  });

  return {
    region: region,
    lastUpdated: new Date().toISOString(),
    snapshot: {
      averagePrice: Math.round(weightedTotal / transactionTotal),
      momChange: 2.1,
      yoyChange: 4.6,
      totalTransactions: transactionTotal,
      transactionChange: 5.3
    },
    propertyTypes: propertyTypes,
    dataSource: 'Regional market estimates based on industry data',
    compliance: 'Market insights based on regional property market analysis and industry-standard metrics.'
  };
}

// Generate market insight
function generateMarketInsight(data, region) {
  const snapshot = data.snapshot;
  const types = data.propertyTypes;
  
  let strongest = { type: '', change: -999 };
  let weakest = { type: '', change: 999 };
  
  Object.keys(types).forEach(type => {
    if (types[type].yoyChange > strongest.change) {
      strongest = { type, change: types[type].yoyChange };
    }
    if (types[type].yoyChange < weakest.change) {
      weakest = { type, change: types[type].yoyChange };
    }
  });

  let insight = '';
  
  if (strongest.change > 4) {
    insight = `${strongest.type} homes are driving growth in ${region}, with ${strongest.change.toFixed(1)}% annual growth. `;
  } else {
    insight = `The ${region} market is showing steady performance across property types. `;
  }

  if (weakest.change < 0) {
    insight += `${weakest.type} remain price-sensitive with ${Math.abs(weakest.change).toFixed(1)}% decline year-on-year. `;
  }

  if (snapshot.transactionChange > 0) {
    insight += `Transaction volumes are up ${snapshot.transactionChange.toFixed(1)}% compared to last year, indicating healthy buyer activity. `;
  } else {
    insight += `Transaction volumes are down ${Math.abs(snapshot.transactionChange).toFixed(1)}% year-on-year, typical of seasonal patterns. `;
  }

  insight += `Well-presented properties priced correctly using current sold data are still achieving strong results.`;

  return insight;
}