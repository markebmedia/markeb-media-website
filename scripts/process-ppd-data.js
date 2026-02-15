const http = require('http');
const fs = require('fs');
const { parse } = require('csv-parse/sync');

// URLs - use monthly update for current + previous full year for comparison
const MONTHLY_UPDATE_URL = 'http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-monthly-update-new-version.csv';
const PREVIOUS_YEAR_URL = 'http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-2024.csv';

console.log(`📥 Downloading monthly update and 2024 data...`);

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
    
    console.log('Downloading 2024 data...');
    previousYearData = await downloadFile(PREVIOUS_YEAR_URL);
    console.log(`✅ 2024 data downloaded (${(previousYearData.length / 1024 / 1024).toFixed(2)} MB)`);
    
    processData();
  } catch (error) {
    console.error('❌ Download failed:', error.message);
    process.exit(1);
  }
}

downloadBothFiles();

// SUB-REGIONAL GROUPINGS (Middle tier - e.g., South Yorkshire, Greater Manchester)
const SUB_REGIONAL_GROUPINGS = {
  // Yorkshire sub-regions
  'SOUTH YORKSHIRE': ['Sheffield', 'Doncaster', 'Rotherham', 'Barnsley'],
  'WEST YORKSHIRE': ['Leeds', 'Bradford', 'Wakefield', 'Kirklees', 'Calderdale'],
  'NORTH YORKSHIRE': ['North Yorkshire', 'York'],
  'EAST YORKSHIRE': ['East Riding of Yorkshire'],
  
  // North West sub-regions
  'GREATER MANCHESTER': ['Manchester', 'Salford', 'Bolton', 'Bury', 'Oldham', 'Rochdale', 'Stockport', 'Tameside', 'Trafford', 'Wigan'],
  'MERSEYSIDE': ['Merseyside'],
  'LANCASHIRE': ['Lancashire', 'Blackburn with Darwen', 'Blackpool'],
  'CHESHIRE': ['Cheshire East', 'Cheshire West and Chester', 'Halton', 'Warrington'],
  'CUMBRIA': ['Cumbria'],
  
  // East of England sub-regions
  'ESSEX': ['Basildon', 'Braintree', 'Brentwood', 'Castle Point', 'Chelmsford', 'Colchester', 'Epping Forest', 'Harlow', 'Maldon', 'Rochford', 'Tendring', 'Uttlesford', 'Southend-on-Sea', 'Thurrock'],
  'HERTFORDSHIRE': ['Hertfordshire'],
  'BEDFORDSHIRE': ['Bedford', 'Central Bedfordshire'],
  'CAMBRIDGESHIRE': ['Cambridgeshire', 'Peterborough'],
  'NORFOLK': ['Norfolk'],
  'SUFFOLK': ['Suffolk'],
  
  // West Midlands sub-regions
  'WEST MIDLANDS CONURBATION': ['Birmingham', 'Coventry', 'Dudley', 'Sandwell', 'Solihull', 'Walsall', 'Wolverhampton'],
  'STAFFORDSHIRE': ['Staffordshire', 'Stoke-on-Trent'],
  'WARWICKSHIRE': ['Warwickshire'],
  'WORCESTERSHIRE': ['Worcestershire'],
  'SHROPSHIRE': ['Shropshire', 'Telford and Wrekin'],
  'HEREFORDSHIRE': ['Herefordshire'],
  
  // East Midlands sub-regions
  'NOTTINGHAMSHIRE': ['Nottingham', 'Nottinghamshire'],
  'DERBYSHIRE': ['Derby', 'Derbyshire'],
  'LEICESTERSHIRE': ['Leicester', 'Leicestershire'],
  'LINCOLNSHIRE': ['Lincolnshire'],
  'NORTHAMPTONSHIRE': ['Northamptonshire'],
  'RUTLAND': ['Rutland'],
  
  // South East sub-regions
  'KENT': ['Kent', 'Medway'],
  'SURREY': ['Surrey'],
  'SUSSEX': ['East Sussex', 'West Sussex', 'Brighton and Hove'],
  'HAMPSHIRE': ['Hampshire', 'Portsmouth', 'Southampton', 'Isle of Wight'],
  'BERKSHIRE': ['Berkshire'],
  'BUCKINGHAMSHIRE': ['Buckinghamshire'],
  'OXFORDSHIRE': ['Oxfordshire'],
  
  // South West sub-regions
  'BRISTOL AND BATH': ['Bristol', 'Bath and North East Somerset', 'North Somerset', 'South Gloucestershire'],
  'DEVON': ['Devon', 'Plymouth', 'Torbay'],
  'CORNWALL': ['Cornwall'],
  'DORSET': ['Dorset', 'Bournemouth, Christchurch and Poole'],
  'GLOUCESTERSHIRE': ['Gloucestershire'],
  'SOMERSET': ['Somerset'],
  'WILTSHIRE': ['Wiltshire', 'Swindon'],
};

// BROAD REGIONAL GROUPINGS (Top tier - e.g., Yorkshire, North West)
const REGIONAL_GROUPINGS = {
  'NORTH WEST': ['Cheshire East', 'Cheshire West and Chester', 'Cumbria', 'Manchester', 'Salford', 'Bolton', 'Bury', 'Oldham', 'Rochdale', 'Stockport', 'Tameside', 'Trafford', 'Wigan', 'Lancashire', 'Merseyside', 'Blackburn with Darwen', 'Blackpool', 'Halton', 'Warrington'],
  
  'NORTH EAST': ['County Durham', 'Northumberland', 'Tyne and Wear'],
  
  'YORKSHIRE': ['East Riding of Yorkshire', 'North Yorkshire', 'Sheffield', 'Doncaster', 'Rotherham', 'Barnsley', 'Leeds', 'Bradford', 'Wakefield', 'Kirklees', 'Calderdale', 'York'],
  
  'EAST MIDLANDS': ['Derby', 'Derbyshire', 'Leicester', 'Leicestershire', 'Lincolnshire', 'Northamptonshire', 'Nottingham', 'Nottinghamshire', 'Rutland'],
  
  'WEST MIDLANDS': ['Herefordshire', 'Shropshire', 'Staffordshire', 'Stoke-on-Trent', 'Telford and Wrekin', 'Warwickshire', 'Birmingham', 'Coventry', 'Dudley', 'Sandwell', 'Solihull', 'Walsall', 'Wolverhampton', 'Worcestershire'],
  
  'EAST OF ENGLAND': ['Bedford', 'Cambridgeshire', 'Central Bedfordshire', 'Basildon', 'Braintree', 'Brentwood', 'Castle Point', 'Chelmsford', 'Colchester', 'Epping Forest', 'Harlow', 'Maldon', 'Rochford', 'Tendring', 'Uttlesford', 'Southend-on-Sea', 'Thurrock', 'Hertfordshire', 'Norfolk', 'Peterborough', 'Suffolk'],
  
  'SOUTH EAST': ['Berkshire', 'Brighton and Hove', 'Buckinghamshire', 'East Sussex', 'Hampshire', 'Isle of Wight', 'Kent', 'Medway', 'Oxfordshire', 'Portsmouth', 'Southampton', 'Surrey', 'West Sussex'],
  
  'SOUTH WEST': ['Bath and North East Somerset', 'Bournemouth, Christchurch and Poole', 'Bristol', 'Cornwall', 'Devon', 'Dorset', 'Gloucestershire', 'North Somerset', 'Plymouth', 'Somerset', 'South Gloucestershire', 'Swindon', 'Torbay', 'Wiltshire'],
  
  'LONDON': ['City of London', 'Barking and Dagenham', 'Barnet', 'Bexley', 'Brent', 'Bromley', 'Camden', 'Croydon', 'Ealing', 'Enfield', 'Greenwich', 'Hackney', 'Hammersmith and Fulham', 'Haringey', 'Harrow', 'Havering', 'Hillingdon', 'Hounslow', 'Islington', 'Kensington and Chelsea', 'Kingston upon Thames', 'Lambeth', 'Lewisham', 'Merton', 'Newham', 'Redbridge', 'Richmond upon Thames', 'Southwark', 'Sutton', 'Tower Hamlets', 'Waltham Forest', 'Wandsworth', 'Westminster'],
  
  'SCOTLAND': ['Aberdeen City', 'Aberdeenshire', 'Angus', 'Argyll and Bute', 'City of Edinburgh', 'Clackmannanshire', 'Dumfries and Galloway', 'Dundee City', 'East Ayrshire', 'East Dunbartonshire', 'East Lothian', 'East Renfrewshire', 'Falkirk', 'Fife', 'Glasgow City', 'Highland', 'Inverclyde', 'Midlothian', 'Moray', 'Na h-Eileanan Siar', 'North Ayrshire', 'North Lanarkshire', 'Orkney Islands', 'Perth and Kinross', 'Renfrewshire', 'Scottish Borders', 'Shetland Islands', 'South Ayrshire', 'South Lanarkshire', 'Stirling', 'West Dunbartonshire', 'West Lothian'],
  
  'WALES': ['Blaenau Gwent', 'Bridgend', 'Caerphilly', 'Cardiff', 'Carmarthenshire', 'Ceredigion', 'Conwy', 'Denbighshire', 'Flintshire', 'Gwynedd', 'Isle of Anglesey', 'Merthyr Tydfil', 'Monmouthshire', 'Neath Port Talbot', 'Newport', 'Pembrokeshire', 'Powys', 'Rhondda Cynon Taf', 'Swansea', 'Torfaen', 'Vale of Glamorgan', 'Wrexham'],
  
  'NORTHERN IRELAND': ['Antrim and Newtownabbey', 'Ards and North Down', 'Armagh City, Banbridge and Craigavon', 'Belfast', 'Causeway Coast and Glens', 'Derry City and Strabane', 'Fermanagh and Omagh', 'Lisburn and Castlereagh', 'Mid and East Antrim', 'Mid Ulster', 'Newry, Mourne and Down']
};

// DISTRICT MAPPING (Most granular tier)
const DISTRICT_MAPPING = {
  // ===== ENGLAND - NORTH WEST =====
  'Cheshire East': 'CHESHIRE EAST',
  'Cheshire West and Chester': 'CHESHIRE WEST AND CHESTER',
  'Cumbria': 'CUMBRIA',
  
  // Greater Manchester - broken down by district
  'Manchester': 'MANCHESTER',
  'Salford': 'SALFORD',
  'Bolton': 'BOLTON',
  'Bury': 'BURY',
  'Oldham': 'OLDHAM',
  'Rochdale': 'ROCHDALE',
  'Stockport': 'STOCKPORT',
  'Tameside': 'TAMESIDE',
  'Trafford': 'TRAFFORD',
  'Wigan': 'WIGAN',
  
  'Lancashire': 'LANCASHIRE',
  'Merseyside': 'MERSEYSIDE',
  'Blackburn with Darwen': 'BLACKBURN WITH DARWEN',
  'Blackpool': 'BLACKPOOL',
  'Halton': 'HALTON',
  'Warrington': 'WARRINGTON',
  
  // ===== ENGLAND - NORTH EAST =====
  'County Durham': 'COUNTY DURHAM',
  'Northumberland': 'NORTHUMBERLAND',
  'Tyne and Wear': 'TYNE AND WEAR',
  
  // ===== ENGLAND - YORKSHIRE & HUMBER =====
  'East Riding of Yorkshire': 'EAST RIDING OF YORKSHIRE',
  'North Yorkshire': 'NORTH YORKSHIRE',
  
  // South Yorkshire - broken down by district
  'Sheffield': 'SHEFFIELD',
  'Doncaster': 'DONCASTER',
  'Rotherham': 'ROTHERHAM',
  'Barnsley': 'BARNSLEY',
  
  // West Yorkshire - broken down by district
  'Leeds': 'LEEDS',
  'Bradford': 'BRADFORD',
  'Wakefield': 'WAKEFIELD',
  'Kirklees': 'KIRKLEES',
  'Calderdale': 'CALDERDALE',
  
  'York': 'YORK',
  
  // ===== ENGLAND - EAST MIDLANDS =====
  'Derby': 'DERBY',
  'Derbyshire': 'DERBYSHIRE',
  'Leicester': 'LEICESTER',
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
  'Stoke-on-Trent': 'STOKE-ON-TRENT',
  'Telford and Wrekin': 'TELFORD AND WREKIN',
  'Warwickshire': 'WARWICKSHIRE',
  
  // West Midlands - broken down by district
  'Birmingham': 'BIRMINGHAM',
  'Coventry': 'COVENTRY',
  'Dudley': 'DUDLEY',
  'Sandwell': 'SANDWELL',
  'Solihull': 'SOLIHULL',
  'Walsall': 'WALSALL',
  'Wolverhampton': 'WOLVERHAMPTON',
  
  'Worcestershire': 'WORCESTERSHIRE',
  
  // ===== ENGLAND - EAST OF ENGLAND =====
  'Bedford': 'BEDFORD',
  'Cambridgeshire': 'CAMBRIDGESHIRE',
  'Central Bedfordshire': 'CENTRAL BEDFORDSHIRE',
  
  // Essex - broken down by district
  'Basildon': 'BASILDON',
  'Braintree': 'BRAINTREE',
  'Brentwood': 'BRENTWOOD',
  'Castle Point': 'CASTLE POINT',
  'Chelmsford': 'CHELMSFORD',
  'Colchester': 'COLCHESTER',
  'Epping Forest': 'EPPING FOREST',
  'Harlow': 'HARLOW',
  'Maldon': 'MALDON',
  'Rochford': 'ROCHFORD',
  'Tendring': 'TENDRING',
  'Uttlesford': 'UTTLESFORD',
  'Southend-on-Sea': 'SOUTHEND-ON-SEA',
  'Thurrock': 'THURROCK',
  
  'Hertfordshire': 'HERTFORDSHIRE',
  'Norfolk': 'NORFOLK',
  'Peterborough': 'PETERBOROUGH',
  'Suffolk': 'SUFFOLK',
  
  // ===== ENGLAND - SOUTH EAST =====
  'Berkshire': 'BERKSHIRE',
  'Brighton and Hove': 'BRIGHTON AND HOVE',
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
  'Bath and North East Somerset': 'BATH AND NORTH EAST SOMERSET',
  'Bournemouth, Christchurch and Poole': 'BOURNEMOUTH CHRISTCHURCH AND POOLE',
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
  
  // ===== ENGLAND - LONDON (32 boroughs) =====
  'City of London': 'CITY OF LONDON',
  'Barking and Dagenham': 'BARKING AND DAGENHAM',
  'Barnet': 'BARNET',
  'Bexley': 'BEXLEY',
  'Brent': 'BRENT',
  'Bromley': 'BROMLEY',
  'Camden': 'CAMDEN',
  'Croydon': 'CROYDON',
  'Ealing': 'EALING',
  'Enfield': 'ENFIELD',
  'Greenwich': 'GREENWICH',
  'Hackney': 'HACKNEY',
  'Hammersmith and Fulham': 'HAMMERSMITH AND FULHAM',
  'Haringey': 'HARINGEY',
  'Harrow': 'HARROW',
  'Havering': 'HAVERING',
  'Hillingdon': 'HILLINGDON',
  'Hounslow': 'HOUNSLOW',
  'Islington': 'ISLINGTON',
  'Kensington and Chelsea': 'KENSINGTON AND CHELSEA',
  'Kingston upon Thames': 'KINGSTON UPON THAMES',
  'Lambeth': 'LAMBETH',
  'Lewisham': 'LEWISHAM',
  'Merton': 'MERTON',
  'Newham': 'NEWHAM',
  'Redbridge': 'REDBRIDGE',
  'Richmond upon Thames': 'RICHMOND UPON THAMES',
  'Southwark': 'SOUTHWARK',
  'Sutton': 'SUTTON',
  'Tower Hamlets': 'TOWER HAMLETS',
  'Waltham Forest': 'WALTHAM FOREST',
  'Wandsworth': 'WANDSWORTH',
  'Westminster': 'WESTMINSTER',
  
  // ===== SCOTLAND =====
  'Aberdeen City': 'ABERDEEN CITY',
  'Aberdeenshire': 'ABERDEENSHIRE',
  'Angus': 'ANGUS',
  'Argyll and Bute': 'ARGYLL AND BUTE',
  'City of Edinburgh': 'CITY OF EDINBURGH',
  'Clackmannanshire': 'CLACKMANNANSHIRE',
  'Dumfries and Galloway': 'DUMFRIES AND GALLOWAY',
  'Dundee City': 'DUNDEE CITY',
  'East Ayrshire': 'EAST AYRSHIRE',
  'East Dunbartonshire': 'EAST DUNBARTONSHIRE',
  'East Lothian': 'EAST LOTHIAN',
  'East Renfrewshire': 'EAST RENFREWSHIRE',
  'Falkirk': 'FALKIRK',
  'Fife': 'FIFE',
  'Glasgow City': 'GLASGOW CITY',
  'Highland': 'HIGHLAND',
  'Inverclyde': 'INVERCLYDE',
  'Midlothian': 'MIDLOTHIAN',
  'Moray': 'MORAY',
  'Na h-Eileanan Siar': 'NA H-EILEANAN SIAR',
  'North Ayrshire': 'NORTH AYRSHIRE',
  'North Lanarkshire': 'NORTH LANARKSHIRE',
  'Orkney Islands': 'ORKNEY ISLANDS',
  'Perth and Kinross': 'PERTH AND KINROSS',
  'Renfrewshire': 'RENFREWSHIRE',
  'Scottish Borders': 'SCOTTISH BORDERS',
  'Shetland Islands': 'SHETLAND ISLANDS',
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
  'Isle of Anglesey': 'ISLE OF ANGLESEY',
  'Merthyr Tydfil': 'MERTHYR TYDFIL',
  'Monmouthshire': 'MONMOUTHSHIRE',
  'Neath Port Talbot': 'NEATH PORT TALBOT',
  'Newport': 'NEWPORT',
  'Pembrokeshire': 'PEMBROKESHIRE',
  'Powys': 'POWYS',
  'Rhondda Cynon Taf': 'RHONDDA CYNON TAF',
  'Swansea': 'SWANSEA',
  'Torfaen': 'TORFAEN',
  'Vale of Glamorgan': 'VALE OF GLAMORGAN',
  'Wrexham': 'WREXHAM',
  
  // ===== NORTHERN IRELAND =====
  'Antrim and Newtownabbey': 'ANTRIM AND NEWTOWNABBEY',
  'Ards and North Down': 'ARDS AND NORTH DOWN',
  'Armagh City, Banbridge and Craigavon': 'ARMAGH CITY BANBRIDGE AND CRAIGAVON',
  'Belfast': 'BELFAST',
  'Causeway Coast and Glens': 'CAUSEWAY COAST AND GLENS',
  'Derry City and Strabane': 'DERRY CITY AND STRABANE',
  'Fermanagh and Omagh': 'FERMANAGH AND OMAGH',
  'Lisburn and Castlereagh': 'LISBURN AND CASTLEREAGH',
  'Mid and East Antrim': 'MID AND EAST ANTRIM',
  'Mid Ulster': 'MID ULSTER',
  'Newry, Mourne and Down': 'NEWRY MOURNE AND DOWN'
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
  console.log(`📊 2024 transactions: ${previousRecords.length}`);
  
  // Get the most recent complete quarter from monthly data
  const currentPeriod = getMostRecentQuarter(monthlyRecords);
  
  console.log(`📅 Most recent period: ${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentPeriod.year}`);
  console.log(`📅 Comparing to: ${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentPeriod.year - 1}`);
  
  const typeMapping = {
    'D': 'Detached',
    'S': 'Semi-detached',
    'T': 'Terraced',
    'F': 'Flats'
  };
  
  const districtData = {};
  const subRegionalData = {};
  const regionalData = {};
  
  // ===== TIER 1: PROCESS DISTRICTS (Most granular) =====
  console.log('\n📍 Processing District-level data...');
  Object.keys(DISTRICT_MAPPING).forEach(district => {
    const searchTerm = DISTRICT_MAPPING[district];
    
    // Filter monthly update for current period
    const currentTransactions = monthlyRecords.filter(record => {
      const matchesLocation = matchesLocationSearch(record, searchTerm);
      const matchesPeriod = isInPeriod(record.date, currentPeriod);
      return matchesLocation && matchesPeriod;
    });
    
    // Filter 2024 data for same period
    const previousTransactions = previousRecords.filter(record => {
      const matchesLocation = matchesLocationSearch(record, searchTerm);
      const matchesPeriod = isInDateRange(record.date, currentPeriod.startMonth, currentPeriod.endMonth, currentPeriod.year - 1);
      return matchesLocation && matchesPeriod;
    });
    
    if (currentTransactions.length === 0) {
      console.log(`⚠️  No current data for ${district}`);
      return;
    }
    
    console.log(`✓ ${district}: ${currentTransactions.length} current, ${previousTransactions.length} previous year`);
    
    districtData[district] = createDataObject(
      district,
      currentTransactions,
      previousTransactions,
      typeMapping,
      'DISTRICT',
      null
    );
  });
  
  // ===== TIER 2: PROCESS SUB-REGIONS (Middle tier - e.g., South Yorkshire) =====
  console.log('\n🗺️  Processing Sub-Regional data...');
  Object.keys(SUB_REGIONAL_GROUPINGS).forEach(subRegionName => {
    const districts = SUB_REGIONAL_GROUPINGS[subRegionName];
    
    // Aggregate all transactions from districts in this sub-region
    const currentTransactions = monthlyRecords.filter(record => {
      const matchesPeriod = isInPeriod(record.date, currentPeriod);
      const matchesDistrict = districts.some(district => 
        matchesLocationSearch(record, DISTRICT_MAPPING[district])
      );
      return matchesPeriod && matchesDistrict;
    });
    
    const previousTransactions = previousRecords.filter(record => {
      const matchesPeriod = isInDateRange(record.date, currentPeriod.startMonth, currentPeriod.endMonth, currentPeriod.year - 1);
      const matchesDistrict = districts.some(district => 
        matchesLocationSearch(record, DISTRICT_MAPPING[district])
      );
      return matchesPeriod && matchesDistrict;
    });
    
    if (currentTransactions.length === 0) {
      console.log(`⚠️  No sub-regional data for ${subRegionName}`);
      return;
    }
    
    console.log(`✓ ${subRegionName}: ${currentTransactions.length} current, ${previousTransactions.length} previous year`);
    
    subRegionalData[subRegionName] = createDataObject(
      subRegionName,
      currentTransactions,
      previousTransactions,
      typeMapping,
      'SUB_REGION',
      districts
    );
  });
  
  // ===== TIER 3: PROCESS BROAD REGIONS (Top tier - e.g., Yorkshire) =====
  console.log('\n🌍 Processing Regional data...');
  Object.keys(REGIONAL_GROUPINGS).forEach(regionName => {
    const districts = REGIONAL_GROUPINGS[regionName];
    
    // Aggregate all transactions from districts in this region
    const currentTransactions = monthlyRecords.filter(record => {
      const matchesPeriod = isInPeriod(record.date, currentPeriod);
      const matchesDistrict = districts.some(district => 
        matchesLocationSearch(record, DISTRICT_MAPPING[district])
      );
      return matchesPeriod && matchesDistrict;
    });
    
    const previousTransactions = previousRecords.filter(record => {
      const matchesPeriod = isInDateRange(record.date, currentPeriod.startMonth, currentPeriod.endMonth, currentPeriod.year - 1);
      const matchesDistrict = districts.some(district => 
        matchesLocationSearch(record, DISTRICT_MAPPING[district])
      );
      return matchesPeriod && matchesDistrict;
    });
    
    if (currentTransactions.length === 0) {
      console.log(`⚠️  No regional data for ${regionName}`);
      return;
    }
    
    console.log(`✓ ${regionName}: ${currentTransactions.length} current, ${previousTransactions.length} previous year`);
    
    regionalData[regionName] = createDataObject(
      regionName,
      currentTransactions,
      previousTransactions,
      typeMapping,
      'REGION',
      districts
    );
  });
  
  // Save to JSON with all three tiers
  const outputDir = 'data';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(
    `${outputDir}/market-data.json`,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      dataPeriod: `Most Recent 3-Month Period`,
      comparisonPeriod: `Year Ago 3-Month Period`,
      period: {
        current: {
          startMonth: currentPeriod.startMonth,
          endMonth: currentPeriod.endMonth,
          year: currentPeriod.year,
          label: `${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentPeriod.year}`
        },
        previous: {
          startMonth: currentPeriod.startMonth,
          endMonth: currentPeriod.endMonth,
          year: currentPeriod.year - 1,
          label: `${getMonthName(currentPeriod.startMonth)}-${getMonthName(currentPeriod.endMonth)} ${currentPeriod.year - 1}`
        }
      },
      districts: districtData,
      subRegions: subRegionalData,
      regions: regionalData
    }, null, 2)
  );
  
  console.log('\n✅ Data processed and saved to data/market-data.json');
  console.log(`📈 Districts with data: ${Object.keys(districtData).length}`);
  console.log(`🗺️  Sub-regions with data: ${Object.keys(subRegionalData).length}`);
  console.log(`🌍 Regions with data: ${Object.keys(regionalData).length}`);
}

// Helper function to create standardized data object
function createDataObject(name, currentTx, previousTx, typeMapping, tier, districts = null) {
  const currentStats = calculateStats(currentTx, typeMapping);
  const previousStats = calculateStats(previousTx, typeMapping);
  
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
  
  const dataObject = {
    name: name,
    tier: tier,
    lastUpdated: new Date().toISOString(),
    dataPeriod: `Most Recent 3-Month Period`,
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
    dataSource: `HM Land Registry Price Paid Data (${tier} - Most Recent 3-Month Period vs Year Ago)`,
    compliance: 'Insights derived from HM Land Registry Price Paid Data (Open Government Licence). Data reflects completed and registered sales.'
  };
  
  // Add districts list for aggregated tiers
  if (districts && tier !== 'DISTRICT') {
    dataObject.districts = districts;
  }
  
  return dataObject;
}

function getMostRecentQuarter(records) {
  // Count transactions by month
  const monthCounts = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);
  
  records.forEach(record => {
    if (!record.date) return;
    const date = new Date(record.date);
    
    // Look at transactions from last 12 months AND not in the future
    if (date >= twelveMonthsAgo && date <= today) {
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthCounts[key] = (monthCounts[key] || 0) + 1;
    }
  });
  
  // Find months with significant data (lowered threshold)
  const validMonths = Object.keys(monthCounts)
    .filter(key => monthCounts[key] >= 50)
    .sort()
    .reverse();
  
  console.log('📊 Recent months with data:', validMonths.slice(0, 8).map(m => `${m} (${monthCounts[m]} txns)`));
  
  if (validMonths.length < 3) {
    console.log('⚠️  Not enough recent data, using Q4 2025 as fallback');
    return {
      startMonth: 10,
      endMonth: 12,
      year: 2025
    };
  }
  
  // Get the 3 most recent consecutive months with data
  const [latestYear, latestMonth] = validMonths[0].split('-').map(Number);
  
  // Calculate 3-month period ending with latest month
  let endMonth = latestMonth;
  let startMonth = latestMonth - 2;
  let periodYear = latestYear;
  
  // Handle year boundary (e.g., if latest is Jan 2026, period is Nov 2025-Jan 2026)
  if (startMonth < 1) {
    startMonth += 12;
    // The period spans two years, but we'll use the year of the END month
  }
  
  console.log(`✓ Using most recent 3-month period: ${getMonthName(startMonth)}-${getMonthName(endMonth)} ${periodYear}`);
  
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
  
  // Handle periods that cross year boundary (e.g. Nov 2025-Jan 2026)
  if (period.startMonth > period.endMonth) {
    // Period spans two years
    return (year === period.year - 1 && month >= period.startMonth) ||
           (year === period.year && month <= period.endMonth);
  } else {
    // Period within same year
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
    // Period spans two years (e.g., Nov-Jan)
    return (dateYear === year - 1 && month >= startMonth) ||
           (dateYear === year && month <= endMonth);
  } else {
    // Period within same year
    return dateYear === year && month >= startMonth && month <= endMonth;
  }
}

function matchesLocationSearch(record, searchTerm) {
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