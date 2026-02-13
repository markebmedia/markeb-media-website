const http = require('http');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

// URLs - use monthly update for current + previous full year for comparison
const MONTHLY_UPDATE_URL = 'http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-monthly-update-new-version.csv';
const PREVIOUS_YEAR_URL = 'http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-2025.csv';

console.log(`📥 Downloading monthly update and 2025 data...`);

let monthlyData = '';
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
    console.log('Downloading monthly update...');
    monthlyData = await downloadFile(MONTHLY_UPDATE_URL);
    console.log(`✅ Monthly update downloaded (${(monthlyData.length / 1024 / 1024).toFixed(2)} MB)`);
    
    console.log('Downloading 2025 data...');
    previousYearData = await downloadFile(PREVIOUS_YEAR_URL);
    console.log(`✅ 2025 data downloaded (${(previousYearData.length / 1024 / 1024).toFixed(2)} MB)`);
    
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
  
  const monthlyRecords = parse(monthlyData, {
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
  
  console.log(`📊 Monthly update records: ${monthlyRecords.length}`);
  console.log(`📊 2025 transactions: ${previousRecords.length}`);
  
  // Get the most recent complete quarter from monthly data
  const currentPeriod = getMostRecentQuarter(monthlyRecords);
  
  console.log(`📅 Most recent quarter: ${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentPeriod.year}`);
  console.log(`📅 Comparing to: ${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} 2025`);
  
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
    
    // Filter monthly update for current period
    const currentTransactions = monthlyRecords.filter(record => {
      const matchesRegion = matchesLocation(record, searchTerm);
      const matchesPeriod = isInPeriod(record.date, currentPeriod);
      return matchesRegion && matchesPeriod;
    });
    
    // Filter 2025 data for same period
    const previousTransactions = previousRecords.filter(record => {
      const matchesRegion = matchesLocation(record, searchTerm);
      const matchesPeriod = isInDateRange(record.date, currentPeriod.startMonth, currentPeriod.endMonth, 2025);
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
      dataPeriod: `Most Recent Quarter (${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentPeriod.year})`,
      snapshot: {
        averagePrice: Math.round(currentStats.averagePrice),
        momChange: 0,
        yoyChange: parseFloat(yoyChange.toFixed(1)),
        totalTransactions: currentStats.totalTransactions,
        transactionChange: parseFloat(transactionChange.toFixed(1)),
        previousYearPrice: Math.round(previousStats.averagePrice),
        previousYearTransactions: previousStats.totalTransactions
      },
      propertyTypes: propertyTypes,
      dataSource: `HM Land Registry Price Paid Data (Most Recent Quarter vs Year Ago)`,
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
      dataPeriod: `Most Recent Quarter (${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentPeriod.year})`,
      comparisonPeriod: `Year Ago (${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} 2025)`,
      regions: regionalData
    }, null, 2)
  );
  
  console.log('✅ Data processed and saved to data/market-data.json');
  console.log(`📈 Regions with data: ${Object.keys(regionalData).length}`);
}

function getMostRecentQuarter(records) {
  // Count transactions by month for recent quarters
  const monthCounts = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  
  records.forEach(record => {
    if (!record.date) return;
    const date = new Date(record.date);
    
    // Look at transactions from last 12 months AND not in the future
    if (date >= twelveMonthsAgo && date <= today) {
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    }
  });
  
  // Find months with data (lowered threshold to catch more recent quarters)
  const validMonths = Object.keys(monthCounts)
    .filter(key => monthCounts[key] >= 100)
    .sort()
    .reverse();
  
  console.log('📊 Recent months with data:', validMonths.slice(0, 8).map(m => `${m} (${monthCounts[m]} txns)`));
  
  if (validMonths.length === 0) {
    // Fallback: use Q4 of previous year
    return {
      startMonth: 10,
      endMonth: 12,
      year: now.getFullYear() - 1
    };
  }
  
  // Get the most recent month with data
  const [year, month] = validMonths[0].split('-').map(Number);
  
  // Use quarterly period (3 months) ending with this month
  let endMonth = month;
  let startMonth = month - 2;
  let periodYear = year;
  
  // Handle year wrap (e.g., Q4 Oct-Dec → Q1 Jan-Mar crosses year)
  if (startMonth < 1) {
    startMonth += 12;
    // Year stays the same since we want current year data
  }
  
  return {
    startMonth,
    endMonth,
    year: periodYear
  };
}

function isInPeriod(dateStr, period) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  
  // Handle periods that cross year boundary (e.g. Nov-Jan)
  if (period.startMonth > period.endMonth) {
    return (year === period.year && month >= period.startMonth) ||
           (year === period.year && month <= period.endMonth);
  } else {
    return year === period.year && month >= period.startMonth && month <= period.endMonth;
  }
}

function isInDateRange(dateStr, startMonth, endMonth, year) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const dateYear = date.getFullYear();
  
  // Handle periods that cross year boundary
  if (startMonth > endMonth) {
    return (dateYear === year && month >= startMonth) ||
           (dateYear === year && month <= endMonth);
  } else {
    return dateYear === year && month >= startMonth && month <= endMonth;
  }
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