const http = require('http');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

// URLs for current month and previous year
const MONTHLY_UPDATE_URL = 'http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-monthly-update-new-version.csv';

const currentYear = new Date().getFullYear();
const previousYear = currentYear - 1;
const PREVIOUS_YEAR_URL = `http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-${previousYear}.csv`;

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

console.log(`📥 Downloading monthly update and ${previousYear} data...`);

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
  
  console.log(`📊 Monthly update transactions: ${monthlyRecords.length}`);
  console.log(`📊 ${previousYear} transactions: ${previousRecords.length}`);
  
  // Determine the month/year from monthly update data
  const currentPeriod = getCurrentPeriod(monthlyRecords);
  const comparisonMonth = currentPeriod.month;
  const comparisonYear = previousYear;
  
  console.log(`📅 Current period: ${currentPeriod.month}/${currentPeriod.year}`);
  console.log(`📅 Comparing to: ${comparisonMonth}/${comparisonYear}`);
  
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
    
    // Current month data (from monthly update)
    const currentTransactions = monthlyRecords.filter(record => 
      matchesLocation(record, searchTerm)
    );
    
    // Same month last year (from previous year file)
    const previousTransactions = previousRecords.filter(record => {
      const matchesRegion = matchesLocation(record, searchTerm);
      const matchesMonth = isInMonth(record.date, comparisonMonth, comparisonYear);
      return matchesRegion && matchesMonth;
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
      dataPeriod: `${currentPeriod.month}/${currentPeriod.year}`,
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
      dataSource: `HM Land Registry Price Paid Data (${currentPeriod.month}/${currentPeriod.year} vs ${comparisonMonth}/${comparisonYear})`,
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
      dataPeriod: `${currentPeriod.month}/${currentPeriod.year}`,
      comparisonPeriod: `${comparisonMonth}/${comparisonYear}`,
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

function isInMonth(dateStr, month, year) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return date.getMonth() + 1 === month && date.getFullYear() === year;
}

function getCurrentPeriod(records) {
  // Find the most common month in the monthly update data
  const months = {};
  
  records.slice(0, 1000).forEach(record => {
    if (!record.date) return;
    const date = new Date(record.date);
    const monthYear = `${date.getMonth() + 1}/${date.getFullYear()}`;
    months[monthYear] = (months[monthYear] || 0) + 1;
  });
  
  // Get the most common month
  let maxCount = 0;
  let mostCommonPeriod = null;
  
  Object.keys(months).forEach(period => {
    if (months[period] > maxCount) {
      maxCount = months[period];
      mostCommonPeriod = period;
    }
  });
  
  if (mostCommonPeriod) {
    const [month, year] = mostCommonPeriod.split('/').map(Number);
    return { month, year };
  }
  
  // Fallback to previous month
  const now = new Date();
  let month = now.getMonth(); // 0-11
  let year = now.getFullYear();
  
  if (month === 0) {
    month = 12;
    year--;
  }
  
  return { month, year };
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