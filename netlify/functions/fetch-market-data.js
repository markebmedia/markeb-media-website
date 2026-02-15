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
  console.log('=== Fetch Market Data (Three-Tier System) ===');
  
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
    
    if (!marketData) {
      console.log(`Failed to load market data, using fallback for ${region}`);
      const fallbackData = generateFallbackData(region);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: fallbackData,
          source: 'fallback',
          tier: 'FALLBACK',
          message: `Using industry-standard estimates for ${region}`
        })
      };
    }

    // THREE-TIER FALLBACK LOGIC
    let data = null;
    let usedTier = null;
    let fallbackReason = null;

    // TIER 1: Try district first (minimum 1 transaction)
    if (marketData.districts && marketData.districts[region]) {
      const districtData = marketData.districts[region];
      if (districtData.snapshot.totalTransactions >= 1) {
        data = districtData;
        usedTier = 'DISTRICT';
        console.log(`✓ Using DISTRICT data for ${region} (${districtData.snapshot.totalTransactions} transactions)`);
      } else {
        fallbackReason = `District found but only ${districtData.snapshot.totalTransactions} transactions`;
        console.log(`⚠️ ${fallbackReason}`);
      }
    }

    // TIER 2: Fallback to sub-region if district insufficient
    if (!data && marketData.subRegions) {
      const subRegionData = marketData.subRegions[region];
      if (subRegionData && subRegionData.snapshot.totalTransactions >= 1) {
        data = subRegionData;
        usedTier = 'SUB_REGION';
        fallbackReason = fallbackReason || 'District not found, using sub-region';
        console.log(`✓ Using SUB-REGION data for ${region} (${subRegionData.snapshot.totalTransactions} transactions)`);
      }
    }

    // TIER 3: Fallback to broad region if sub-region insufficient
    if (!data && marketData.regions) {
      const regionData = marketData.regions[region];
      if (regionData && regionData.snapshot.totalTransactions >= 1) {
        data = regionData;
        usedTier = 'REGION';
        fallbackReason = fallbackReason || 'District and sub-region not found, using broad region';
        console.log(`✓ Using REGION data for ${region} (${regionData.snapshot.totalTransactions} transactions)`);
      }
    }

    // TIER 4: Try case-insensitive matching if exact match fails
    if (!data) {
      const regionUpper = region.toUpperCase();
      
      // Try districts
      if (marketData.districts) {
        const districtMatch = Object.keys(marketData.districts).find(
          key => key.toUpperCase() === regionUpper
        );
        if (districtMatch) {
          const districtData = marketData.districts[districtMatch];
          if (districtData.snapshot.totalTransactions >= 1) {
            data = districtData;
            usedTier = 'DISTRICT';
            fallbackReason = 'Case-insensitive district match';
            console.log(`✓ Using DISTRICT data (case-insensitive) for ${districtMatch}`);
          }
        }
      }

      // Try sub-regions
      if (!data && marketData.subRegions) {
        const subRegionMatch = Object.keys(marketData.subRegions).find(
          key => key.toUpperCase() === regionUpper
        );
        if (subRegionMatch) {
          const subRegionData = marketData.subRegions[subRegionMatch];
          if (subRegionData.snapshot.totalTransactions >= 1) {
            data = subRegionData;
            usedTier = 'SUB_REGION';
            fallbackReason = 'Case-insensitive sub-region match';
            console.log(`✓ Using SUB-REGION data (case-insensitive) for ${subRegionMatch}`);
          }
        }
      }

      // Try regions
      if (!data && marketData.regions) {
        const regionMatch = Object.keys(marketData.regions).find(
          key => key.toUpperCase() === regionUpper
        );
        if (regionMatch) {
          data = marketData.regions[regionMatch];
          usedTier = 'REGION';
          fallbackReason = 'Case-insensitive region match';
          console.log(`✓ Using REGION data (case-insensitive) for ${regionMatch}`);
        }
      }
    }

    // TIER 5: Try finding parent sub-region for district with insufficient data
    if (!data && marketData.districts && marketData.districts[region]) {
      for (const [subRegionName, subRegionData] of Object.entries(marketData.subRegions || {})) {
        if (subRegionData.districts && subRegionData.districts.includes(region)) {
          if (subRegionData.snapshot.totalTransactions >= 1) {
            data = subRegionData;
            usedTier = 'SUB_REGION';
            fallbackReason = `District has insufficient data, using parent sub-region ${subRegionName}`;
            console.log(`✓ ${fallbackReason}`);
            break;
          }
        }
      }
    }

    // TIER 6: Try finding parent region for sub-region with insufficient data
    if (!data && marketData.subRegions && marketData.subRegions[region]) {
      for (const [regionName, regionData] of Object.entries(marketData.regions || {})) {
        if (regionData.districts && regionData.districts.some(d => 
          marketData.subRegions[region].districts.includes(d)
        )) {
          data = regionData;
          usedTier = 'REGION';
          fallbackReason = `Sub-region has insufficient data, using parent region ${regionName}`;
          console.log(`✓ ${fallbackReason}`);
          break;
        }
      }
    }

    // FINAL FALLBACK: Use generated fallback data
    if (!data) {
      console.log(`No PPD data for ${region}, using fallback estimates`);
      const fallbackData = generateFallbackData(region);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: fallbackData,
          source: 'fallback',
          tier: 'FALLBACK',
          message: `Using industry-standard estimates for ${region}`,
          fallbackReason: fallbackReason || 'No matching location found in PPD data'
        })
      };
    }

    // Add insight generation
    data.insight = generateMarketInsight(data, data.name || region);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: data,
        source: 'ppd-processed',
        tier: usedTier,
        transactionCount: data.snapshot.totalTransactions,
        dataQuality: getDataQualityRating(data.snapshot.totalTransactions),
        message: `Real PPD data from ${new Date(marketData.generatedAt).toLocaleDateString()}`,
        lastUpdated: marketData.generatedAt,
        fallbackApplied: fallbackReason ? true : false,
        fallbackReason: fallbackReason
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

// Helper function to rate data quality based on transaction count
function getDataQualityRating(transactions) {
  if (transactions >= 500) return 'EXCELLENT';
  if (transactions >= 200) return 'GOOD';
  if (transactions >= 100) return 'FAIR';
  if (transactions >= 50) return 'LIMITED';
  if (transactions >= 10) return 'VERY_LIMITED';
  return 'MINIMAL';
}

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
  if (region.includes('London') || region.toUpperCase().includes('LONDON')) basePrice = basePrices['London'];
  else if (region.includes('Manchester') || region.includes('Lancashire') || region.includes('Cheshire')) basePrice = basePrices['North West'];
  else if (region.includes('Yorkshire') || region.includes('York') || region.toUpperCase().includes('YORKSHIRE')) basePrice = basePrices['Yorkshire and The Humber'];
  else if (region.includes('Birmingham') || region.includes('Midlands')) basePrice = basePrices['West Midlands'];
  else if (region.includes('Essex') || region.includes('Cambridge') || region.includes('Norfolk')) basePrice = basePrices['East of England'];
  else if (region.includes('Bristol') || region.includes('Cornwall') || region.includes('Devon')) basePrice = basePrices['South West'];
  else if (region.includes('Kent') || region.includes('Surrey') || region.includes('Sussex')) basePrice = basePrices['South East'];
  else if (region.includes('Scotland') || region.includes('Edinburgh') || region.includes('Glasgow')) basePrice = basePrices['Scotland'];
  else if (region.includes('Wales') || region.includes('Cardiff')) basePrice = basePrices['Wales'];

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
    name: region,
    tier: 'FALLBACK',
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
  } else if (strongest.change > 0) {
    insight = `The ${region} market is showing steady performance across property types. `;
  } else {
    insight = `The ${region} market is experiencing price adjustments. `;
  }

  if (weakest.change < 0) {
    insight += `${weakest.type} remain price-sensitive with ${Math.abs(weakest.change).toFixed(1)}% decline year-on-year. `;
  }

  if (snapshot.transactionChange > 0) {
    insight += `Transaction volumes are up ${snapshot.transactionChange.toFixed(1)}% compared to last year, indicating healthy buyer activity. `;
  } else if (snapshot.transactionChange < 0) {
    insight += `Transaction volumes are down ${Math.abs(snapshot.transactionChange).toFixed(1)}% year-on-year, typical of seasonal patterns. `;
  }

  insight += `Well-presented properties priced correctly using current sold data are still achieving strong results.`;

  return insight;
}