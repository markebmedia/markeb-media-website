const fs = require('fs');
const path = require('path');

// Load pre-processed data
let marketDataCache = null;

function loadMarketData() {
  if (marketDataCache) return marketDataCache;
  
  try {
    const dataPath = path.join(__dirname, '../../data/market-data.json');
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    marketDataCache = JSON.parse(rawData);
    return marketDataCache;
  } catch (error) {
    console.error('Failed to load market data:', error);
    return null;
  }
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
    
    if (!marketData || !marketData.regions[region]) {
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

// Same generateFallbackData and generateMarketInsight functions from before...
function generateFallbackData(region) {
  // ... keep existing fallback logic
}

function generateMarketInsight(data, region) {
  // ... keep existing insight logic
}