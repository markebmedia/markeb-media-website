const http = require('http');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

// URLs for current and previous year
const currentYear = new Date().getFullYear();
const previousYear = currentYear - 1;

const CURRENT_YEAR_URL = `http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-${currentYear}.csv`;
const PREVIOUS_YEAR_URL = `http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-${previousYear}.csv`;

console.log(`📥 Downloading ${currentYear} and ${previousYear} data...`);

let currentYearData = '';
let previousYearData = '';

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      console.log(`Response from ${url.split('/').pop()}: ${response.statusCode}`);
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function downloadBothFiles() {
  try {
    console.log(`Downloading ${currentYear} data...`);
    currentYearData = await downloadFile(CURRENT_YEAR_URL);
    console.log(`✅ ${currentYear} data downloaded (${(currentYearData.length / 1024 / 1024).toFixed(2)} MB)`);
    
    console.log(`Downloading ${previousYear} data...`);
    previousYearData = await downloadFile(PREVIOUS_YEAR_URL);
    console.log(`✅ ${previousYear} data downloaded (${(previousYearData.length / 1024 / 1024).toFixed(2)} MB)`);
    
    processData();
  } catch (error) {
    console.error('❌ Download failed:', error.message);
    process.exit(1);
  }
}

downloadBothFiles();

// Region mapping (exact match to your dropdown)
const REGION_MAPPING = {
  // ===== ENGLAND - NORTH WEST =====
  'Cheshire East': 'CHESHIRE EAST',
  'Cheshire West and Chester': 'CHESHIRE WEST',
  'Cumbria': 'CUMBRIA',
  'Greater Manchester': 'GREATER MANCHESTER',
  'Lancashire': 'LANCASHIRE',
  'Merseyside': 'MERSEYSIDE',
  'Blackburn with Darwen': 'BLACKBURN',
  'Blackpool': 'BLACKPOOL',
  'Halton': 'HALTON',
  'Warrington': 'WARRINGTON',
  
  // ===== ENGLAND - NORTH EAST =====
  'County Durham': 'COUNTY DURHAM',
  'Northumberland': 'NORTHUMBERLAND',
  'Tyne and Wear': 'TYNE AND WEAR',
  
  // ===== ENGLAND - YORKSHIRE & HUMBER =====
  'East Riding of Yorkshire': 'EAST RIDING',
  'North Yorkshire': 'NORTH YORKSHIRE',
  'South Yorkshire': 'SOUTH YORKSHIRE',
  'West Yorkshire': 'WEST YORKSHIRE',
  'York': 'YORK',
  
  // ===== ENGLAND - EAST MIDLANDS =====
  'Derby': 'DERBY',
  'Derbyshire': 'DERBYSHIRE',
  'Leicestershire': 'LEICESTERSHIRE',
  'Lincolnshire': 'LINCOLNSHIRE',
  'Northamptonshire': 'NORTHAMPTONSHIRE',
  'Nottingham': 'NOTTINGHAM',
  'Nottinghamshire': 'NOTTINGHAMSHIRE',
  'Rutland': 'RUTLAND',
  
  // ===== ENGLAND - WEST MIDLANDS =====
  'Herefordshire': 'HEREFORDSHIRE',
  'Shropshire': 'SHROPSHIRE',
  'Staffordshire': 'STAFFORDSHIRE',
  'Stoke-on-Trent': 'STOKE',
  'Telford and Wrekin': 'TELFORD',
  'Warwickshire': 'WARWICKSHIRE',
  'West Midlands': 'WEST MIDLANDS',
  'Worcestershire': 'WORCESTERSHIRE',
  
  // ===== ENGLAND - EAST OF ENGLAND =====
  'Bedford': 'BEDFORD',
  'Cambridgeshire': 'CAMBRIDGESHIRE',
  'Central Bedfordshire': 'CENTRAL BEDFORDSHIRE',
  'Essex': 'ESSEX',
  'Hertfordshire': 'HERTFORDSHIRE',
  'Norfolk': 'NORFOLK',
  'Peterborough': 'PETERBOROUGH',
  'Suffolk': 'SUFFOLK',
  
  // ===== ENGLAND - SOUTH EAST =====
  'Berkshire': 'BERKSHIRE',
  'Brighton and Hove': 'BRIGHTON',
  'Buckinghamshire': 'BUCKINGHAMSHIRE',
  'East Sussex': 'EAST SUSSEX',
  'Hampshire': 'HAMPSHIRE',
  'Isle of Wight': 'ISLE OF WIGHT',
  'Kent': 'KENT',
  'Medway': 'MEDWAY',
  'Oxfordshire': 'OXFORDSHIRE',
  'Portsmouth': 'PORTSMOUTH',
  'Southampton': 'SOUTHAMPTON',
  'Surrey': 'SURREY',
  'West Sussex': 'WEST SUSSEX',
  
  // ===== ENGLAND - SOUTH WEST =====
  'Bath and North East Somerset': 'BATH',
  'Bournemouth, Christchurch and Poole': 'BOURNEMOUTH',
  'Bristol': 'BRISTOL',
  'Cornwall': 'CORNWALL',
  'Devon': 'DEVON',
  'Dorset': 'DORSET',
  'Gloucestershire': 'GLOUCESTERSHIRE',
  'North Somerset': 'NORTH SOMERSET',
  'Plymouth': 'PLYMOUTH',
  'Somerset': 'SOMERSET',
  'South Gloucestershire': 'SOUTH GLOUCESTERSHIRE',
  'Swindon': 'SWINDON',
  'Torbay': 'TORBAY',
  'Wiltshire': 'WILTSHIRE',
  
  // ===== ENGLAND - LONDON =====
  'Greater London': 'GREATER LONDON',
  
  // ===== SCOTLAND =====
  'Aberdeen City': 'ABERDEEN',
  'Aberdeenshire': 'ABERDEENSHIRE',
  'Angus': 'ANGUS',
  'Argyll and Bute': 'ARGYLL',
  'City of Edinburgh': 'EDINBURGH',
  'Clackmannanshire': 'CLACKMANNANSHIRE',
  'Dumfries and Galloway': 'DUMFRIES',
  'Dundee City': 'DUNDEE',
  'East Ayrshire': 'EAST AYRSHIRE',
  'East Dunbartonshire': 'EAST DUNBARTONSHIRE',
  'East Lothian': 'EAST LOTHIAN',
  'East Renfrewshire': 'EAST RENFREWSHIRE',
  'Falkirk': 'FALKIRK',
  'Fife': 'FIFE',
  'Glasgow City': 'GLASGOW',
  'Highland': 'HIGHLAND',
  'Inverclyde': 'INVERCLYDE',
  'Midlothian': 'MIDLOTHIAN',
  'Moray': 'MORAY',
  'Na h-Eileanan Siar': 'NA H-EILEANAN SIAR',
  'North Ayrshire': 'NORTH AYRSHIRE',
  'North Lanarkshire': 'NORTH LANARKSHIRE',
  'Orkney Islands': 'ORKNEY',
  'Perth and Kinross': 'PERTH',
  'Renfrewshire': 'RENFREWSHIRE',
  'Scottish Borders': 'SCOTTISH BORDERS',
  'Shetland Islands': 'SHETLAND',
  'South Ayrshire': 'SOUTH AYRSHIRE',
  'South Lanarkshire': 'SOUTH LANARKSHIRE',
  'Stirling': 'STIRLING',
  'West Dunbartonshire': 'WEST DUNBARTONSHIRE',
  'West Lothian': 'WEST LOTHIAN',
  
  // ===== WALES =====
  'Blaenau Gwent': 'BLAENAU GWENT',
  'Bridgend': 'BRIDGEND',
  'Caerphilly': 'CAERPHILLY',
  'Cardiff': 'CARDIFF',
  'Carmarthenshire': 'CARMARTHENSHIRE',
  'Ceredigion': 'CEREDIGION',
  'Conwy': 'CONWY',
  'Denbighshire': 'DENBIGHSHIRE',
  'Flintshire': 'FLINTSHIRE',
  'Gwynedd': 'GWYNEDD',
  'Isle of Anglesey': 'ANGLESEY',
  'Merthyr Tydfil': 'MERTHYR',
  'Monmouthshire': 'MONMOUTHSHIRE',
  'Neath Port Talbot': 'NEATH',
  'Newport': 'NEWPORT',
  'Pembrokeshire': 'PEMBROKESHIRE',
  'Powys': 'POWYS',
  'Rhondda Cynon Taf': 'RHONDDA',
  'Swansea': 'SWANSEA',
  'Torfaen': 'TORFAEN',
  'Vale of Glamorgan': 'VALE OF GLAMORGAN',
  'Wrexham': 'WREXHAM',
  
  // ===== NORTHERN IRELAND =====
  'Antrim and Newtownabbey': 'ANTRIM',
  'Ards and North Down': 'ARDS',
  'Armagh City, Banbridge and Craigavon': 'ARMAGH',
  'Belfast': 'BELFAST',
  'Causeway Coast and Glens': 'CAUSEWAY',
  'Derry City and Strabane': 'DERRY',
  'Fermanagh and Omagh': 'FERMANAGH',
  'Lisburn and Castlereagh': 'LISBURN',
  'Mid and East Antrim': 'MID ANTRIM',
  'Mid Ulster': 'MID ULSTER',
  'Newry, Mourne and Down': 'NEWRY'
};

function processData() {
  console.log('🔄 Processing data...');
  
  // Parse both CSV files
  const columnNames = [
    'transaction_id', 'price', 'date', 'postcode', 'property_type',
    'new_build', 'tenure', 'paon', 'saon', 'street', 'locality',
    'town_city', 'district', 'county', 'ppd_category', 'record_status'
  ];
  
  const currentRecords = parse(currentYearData, {
    columns: columnNames,
    skip_empty_lines: true,
    trim: true,
    from_line: 1
  });
  
  const previousRecords = parse(previousYearData, {
    columns: columnNames,
    skip_empty_lines: true,
    trim: true,
    from_line: 1
  });
  
  console.log(`📊 ${currentYear} transactions: ${currentRecords.length}`);
  console.log(`📊 ${previousYear} transactions: ${previousRecords.length}`);
  
  // Get the most recent 3 complete months from current year
  const currentPeriod = getMostRecentCompleteMonths(currentRecords, 3);
  
  console.log(`📅 Current period: ${currentPeriod.startMonth}/${currentYear} - ${currentPeriod.endMonth}/${currentYear}`);
  console.log(`📅 Comparing to: ${currentPeriod.startMonth}/${previousYear} - ${currentPeriod.endMonth}/${previousYear}`);
  
  const typeMapping = {
    'D': 'Detached',
    'S': 'Semi-detached',
    'T': 'Terraced',
    'F': 'Flats'
  };
  
  const regionalData = {};
  
  // Process each region
  Object.keys(REGION_MAPPING).forEach(region => {
    const searchTerm = REGION_MAPPING[region];
    
    // Current period data
    const currentTransactions = currentRecords.filter(record => {
      const matchesRegion = matchesLocation(record, searchTerm);
      const matchesPeriod = isInDateRange(record.date, currentPeriod.startMonth, currentPeriod.endMonth, currentYear);
      return matchesRegion && matchesPeriod;
    });
    
    // Same period last year
    const previousTransactions = previousRecords.filter(record => {
      const matchesRegion = matchesLocation(record, searchTerm);
      const matchesPeriod = isInDateRange(record.date, currentPeriod.startMonth, currentPeriod.endMonth, previousYear);
      return matchesRegion && matchesPeriod;
    });
    
    if (currentTransactions.length === 0) {
      console.log(`⚠️  No current data for ${region}`);
      return;
    }
    
    console.log(`✓ ${region}: ${currentTransactions.length} current, ${previousTransactions.length} previous year`);
    
    // Calculate statistics
    const currentStats = calculateStats(currentTransactions, typeMapping);
    const previousStats = calculateStats(previousTransactions, typeMapping);
    
    // Calculate real YoY changes
    const yoyChange = previousStats.averagePrice > 0 
      ? ((currentStats.averagePrice - previousStats.averagePrice) / previousStats.averagePrice * 100)
      : 0;
    
    const transactionChange = previousStats.totalTransactions > 0
      ? ((currentStats.totalTransactions - previousStats.totalTransactions) / previousStats.totalTransactions * 100)
      : 0;
    
    // Calculate property type YoY changes
    const propertyTypes = {};
    Object.keys(currentStats.byType).forEach(type => {
      const currentPrice = currentStats.byType[type].average;
      const previousPrice = previousStats.byType[type]?.average || 0;
      const typeYoY = previousPrice > 0 
        ? ((currentPrice - previousPrice) / previousPrice * 100)
        : 0;
      
      propertyTypes[type] = {
        averagePrice: Math.round(currentPrice),
        transactions: currentStats.byType[type].count,
        yoyChange: parseFloat(typeYoY.toFixed(1)),
        previousYearPrice: Math.round(previousPrice)
      };
    });
    
    regionalData[region] = {
      region: region,
      lastUpdated: new Date().toISOString(),
      dataPeriod: `${currentPeriod.startMonth}-${currentPeriod.endMonth}/${currentYear}`,
      snapshot: {
        averagePrice: Math.round(currentStats.averagePrice),
        momChange: 0, // Not calculated
        yoyChange: parseFloat(yoyChange.toFixed(1)),
        totalTransactions: currentStats.totalTransactions,
        transactionChange: parseFloat(transactionChange.toFixed(1)),
        previousYearPrice: Math.round(previousStats.averagePrice),
        previousYearTransactions: previousStats.totalTransactions
      },
      propertyTypes: propertyTypes,
      dataSource: `HM Land Registry Price Paid Data (${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentYear} vs ${previousYear})`,
      compliance: 'Insights derived from HM Land Registry Price Paid Data (Open Government Licence). Data reflects completed and registered sales.'
    };
  });
  
  // Save to JSON
  const outputDir = 'data';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(
    `${outputDir}/market-data.json`,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      dataPeriod: `${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentYear}`,
      comparisonPeriod: `${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${previousYear}`,
      regions: regionalData
    }, null, 2)
  );
  
  console.log('✅ Data processed and saved to data/market-data.json');
  console.log(`📈 Regions with data: ${Object.keys(regionalData).length}`);
}

function matchesLocation(record, searchTerm) {
  const county = (record.county || '').toUpperCase();
  const district = (record.district || '').toUpperCase();
  const city = (record.town_city || '').toUpperCase();
  
  return county.includes(searchTerm) || 
         district.includes(searchTerm) || 
         city.includes(searchTerm) ||
         searchTerm.includes(county) ||
         searchTerm.includes(district);
}

function isInDateRange(dateStr, startMonth, endMonth, year) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const dateYear = date.getFullYear();
  
  return dateYear === year && month >= startMonth && month <= endMonth;
}

function getMostRecentCompleteMonths(records, monthCount) {
  // Find the most recent month with significant data
  const monthCounts = {};
  
  records.forEach(record => {
    if (!record.date) return;
    const date = new Date(record.date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    
    // Only count current year data
    if (year === new Date().getFullYear()) {
      const key = `${year}-${month}`;
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    }
  });
  
  // Find the most recent month with at least 1000 transactions
  const sortedMonths = Object.keys(monthCounts)
    .filter(key => monthCounts[key] >= 1000)
    .sort()
    .reverse();
  
  if (sortedMonths.length === 0) {
    // Fallback to 3 months ago
    const now = new Date();
    const endMonth = now.getMonth() - 2; // 2 months ago to ensure complete data
    return {
      startMonth: endMonth - 2,
      endMonth: endMonth
    };
  }
  
  const mostRecentMonth = parseInt(sortedMonths[0].split('-')[1]);
  
  return {
    endMonth: mostRecentMonth,
    startMonth: mostRecentMonth - monthCount + 1
  };
}

function getMonthName(monthNum) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[monthNum - 1];
}

function calculateStats(transactions, typeMapping) {
  const byType = {};
  let totalPrice = 0;
  let totalCount = 0;
  
  transactions.forEach(tx => {
    const price = parseFloat(tx.price);
    const type = typeMapping[tx.property_type];
    
    if (!price || price <= 0 || !type) return;
    
    if (!byType[type]) {
      byType[type] = { prices: [], count: 0 };
    }
    
    byType[type].prices.push(price);
    byType[type].count++;
    totalPrice += price;
    totalCount++;
  });
  
  // Calculate averages per type
  const typeStats = {};
  Object.keys(byType).forEach(type => {
    const prices = byType[type].prices;
    const average = prices.reduce((a, b) => a + b, 0) / prices.length;
    typeStats[type] = {
      average: average,
      count: byType[type].count
    };
  });
  
  return {
    averagePrice: totalCount > 0 ? totalPrice / totalCount : 0,
    totalTransactions: totalCount,
    byType: typeStats
  };
}