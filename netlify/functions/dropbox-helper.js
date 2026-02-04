// netlify/functions/dropbox-helper.js
// Dropbox API helper - handles token refresh and folder operations

let cachedAccessToken = null;
let tokenExpiryTime = null;

/**
 * Refreshes the Dropbox access token using the refresh token
 */
async function refreshAccessToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const clientId = process.env.DROPBOX_CLIENT_ID;
  const clientSecret = process.env.DROPBOX_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Missing Dropbox credentials in environment variables');
  }

  const tokenUrl = 'https://api.dropbox.com/oauth2/token';
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Dropbox token: ${error}`);
  }

  const data = await response.json();
  
  // Cache the token with expiry (typically 4 hours, but we'll refresh earlier)
  cachedAccessToken = data.access_token;
  tokenExpiryTime = Date.now() + (data.expires_in - 300) * 1000; // Refresh 5 mins early
  
  console.log('✓ Dropbox access token refreshed');
  return cachedAccessToken;
}

/**
 * Gets a valid access token (using cache or refreshing if needed)
 */
async function getAccessToken() {
  if (cachedAccessToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
    return cachedAccessToken;
  }
  
  return await refreshAccessToken();
}

/**
 * Creates a folder in Dropbox
 * @param {string} path - Full path including folder name (e.g., "/Markeb Media - QC Delivery Link/123 Main St")
 */
async function createFolder(path) {
  const accessToken = await getAccessToken();
  
  const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      path: path,
      autorename: false
    })
  });

  if (!response.ok) {
    const error = await response.json();
    
    // If folder already exists, that's fine
    if (error.error && error.error['.tag'] === 'path' && error.error.path && error.error.path['.tag'] === 'conflict') {
      console.log(`Folder already exists: ${path}`);
      return { exists: true, path };
    }
    
    throw new Error(`Failed to create folder ${path}: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  console.log(`✓ Created Dropbox folder: ${path}`);
  return data;
}

/**
 * Creates a shared link for a folder
 * @param {string} path - Full path to the folder
 */
async function createSharedLink(path) {
  const accessToken = await getAccessToken();
  
  // First, try to get existing shared link
  const listResponse = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      path: path,
      direct_only: true
    })
  });

  if (listResponse.ok) {
    const listData = await listResponse.json();
    if (listData.links && listData.links.length > 0) {
      console.log(`✓ Using existing shared link for: ${path}`);
      // Convert preview link to download link
      return listData.links[0].url.replace('dl=0', 'dl=1');
    }
  }

  // Create new shared link
  const response = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      path: path,
      settings: {
        requested_visibility: 'public',
        audience: 'public',
        access: 'viewer'
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create shared link for ${path}: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  console.log(`✓ Created shared link for: ${path}`);
  // Convert preview link to download link
  return data.url.replace('dl=0', 'dl=1');
}

/**
 * Creates the complete folder structure for a booking
 * @param {string} propertyAddress - The property address (used as folder name)
 * @param {string} companyName - The company name from Users table
 * @param {string} postcode - The property postcode
 * @returns {Object} { qcFolder, rawFolder, sharedLink }
 */
async function createBookingFolders(propertyAddress, companyName, postcode = '') {
  try {
    // ✅ Create full address with postcode
    const fullAddress = postcode ? `${propertyAddress}, ${postcode}` : propertyAddress;
    
    // ===== QC DELIVERY FOLDER (for client downloads) =====
    const qcBasePath = '/Markeb Media - QC Delivery Link';
    const qcMainFolder = `${qcBasePath}/${fullAddress}`; // ✅ Use full address
    const qcPhotoFolder = `${qcMainFolder}/Photo`;
    const qcVideoFolder = `${qcMainFolder}/Video`;

    console.log('Creating QC Delivery folders...');
    await createFolder(qcMainFolder);
    await createFolder(qcPhotoFolder);
    await createFolder(qcVideoFolder);
    
    // Create shared link for QC folder (for client access)
    const sharedLink = await createSharedLink(qcMainFolder);
    console.log(`✓ QC Delivery folder created with shared link`);

    // ===== RAW CLIENT FOLDER (for internal team) =====
    const rawBasePath = '/Markeb Media Client Folder';
    const rawCompanyFolder = `${rawBasePath}/${companyName}`;
    const rawPropertyFolder = `${rawCompanyFolder}/${fullAddress}`; // ✅ Use full address
    const rawDroneFolder = `${rawPropertyFolder}/Drone`;
    const rawOutsourcePhotoFolder = `${rawPropertyFolder}/Outsource Photo - ${fullAddress}`; // ✅ Use full address
    const rawOutsourceVideoFolder = `${rawPropertyFolder}/Outsource Video - ${fullAddress}`; // ✅ Use full address
    const rawClipsFolder = `${rawPropertyFolder}/Raw Clips`;

    console.log('Creating Raw Client folders...');
    await createFolder(rawCompanyFolder);
    await createFolder(rawPropertyFolder);
    await createFolder(rawDroneFolder);
    await createFolder(rawOutsourcePhotoFolder);
    await createFolder(rawOutsourceVideoFolder);
    await createFolder(rawClipsFolder);
    console.log(`✓ Raw Client folder structure created`);

    return {
      qcFolder: {
        main: qcMainFolder,
        photo: qcPhotoFolder,
        video: qcVideoFolder
      },
      rawFolder: {
        company: rawCompanyFolder,
        property: rawPropertyFolder,
        drone: rawDroneFolder,
        outsourcePhoto: rawOutsourcePhotoFolder,
        outsourceVideo: rawOutsourceVideoFolder,
        rawClips: rawClipsFolder
      },
      sharedLink
    };
  } catch (error) {
    console.error('Error creating Dropbox folders:', error);
    throw error;
  }
}

module.exports = {
  getAccessToken,
  createFolder,
  createSharedLink,
  createBookingFolders
};