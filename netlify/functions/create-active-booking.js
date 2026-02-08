// netlify/functions/create-active-booking.js
// Creates an Active Bookings record in Airtable + Dropbox folders + SUPPORTS GUEST BOOKINGS

const { createBookingFolders } = require('./dropbox-helper');

/**
 * Creates an Active Booking record with Dropbox folder structure
 * @param {Object} bookingData - The booking data from create-booking.js
 * @returns {Object} { success, activeBookingId, dropboxLink, trackingCode }
 */
async function createActiveBooking(bookingData) {
  console.log('=== Creating Active Booking ===');
  console.log('Property Address:', bookingData.propertyAddress);
  console.log('Client Email:', bookingData.clientEmail);
  
  try {
    // Step 1: Try to fetch user's company name from Markeb Media Users table
    console.log('Fetching company name from Users table...');
    
    let companyName = 'Guest'; // ✅ Default for guest bookings
    
    try {
      const userFilterFormula = `LOWER({Email}) = "${bookingData.clientEmail.toLowerCase()}"`;
      const userUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_USER_TABLE}?filterByFormula=${encodeURIComponent(userFilterFormula)}`;
      
      const userResponse = await fetch(userUrl, {
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
        }
      });

      const userData = await userResponse.json();
      
      if (userData.records && userData.records.length > 0) {
        // ✅ User found - try to get company name
        const userCompany = userData.records[0].fields['Company'];
        
        if (userCompany) {
          companyName = userCompany;
          console.log(`✓ Found company: ${companyName}`);
        } else {
          console.log('⚠️ User found but no company name - using "Guest"');
        }
      } else {
        console.log('⚠️ User not found in Users table - proceeding as GUEST');
      }
      
    } catch (userError) {
      console.log('⚠️ Error fetching user - proceeding as GUEST:', userError.message);
      // Continue with companyName = 'Guest'
    }

    // Step 2: Create Dropbox folder structures (QC Delivery + Raw Client folders)
    console.log('Creating Dropbox folders...');

    // ✅ Sanitize property address - remove leading/trailing spaces and invalid characters
    const sanitizedAddress = bookingData.propertyAddress
      .trim()
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filesystem characters
      .replace(/\s+/g, ' '); // Replace multiple spaces with single space

    console.log('Original address:', bookingData.propertyAddress);
    console.log('Sanitized address:', sanitizedAddress);
    console.log('Company name for folders:', companyName);

    const dropboxResult = await createBookingFolders(sanitizedAddress, companyName, bookingData.postcode);
    
    console.log('✓ Dropbox folders created:', {
      qcFolder: dropboxResult.qcFolder.main,
      rawFolder: dropboxResult.rawFolder.property,
      sharedLink: dropboxResult.sharedLink
    });

    // Step 3: Create Active Bookings record in Airtable
    console.log('Creating Active Bookings record...');

    const activeBookingRecord = {
      fields: {
        'Project Address': `${sanitizedAddress}, ${bookingData.postcode}`,
        'Customer Name': bookingData.clientName,
        'Service Type': bookingData.addOns 
          ? `${bookingData.service}, ${bookingData.addOns}` 
          : bookingData.service,
        'Shoot Date': bookingData.date,
        'Status': 'Booked',
        'Delivery Link': dropboxResult.sharedLink, // This gets the QC Ready folder link
        'Email Address': bookingData.clientEmail,
        'Phone Number': bookingData.clientPhone || '',
        'Booking ID': bookingData.bookingRef,
        // Optional additional fields if they exist in Active Bookings:
        'Payment Status': bookingData.paymentStatus,
        'Region': bookingData.region,
        'Media Specialist': bookingData.mediaSpecialist,
      }
    };

    const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/tblRgcv7M9dUU3YuL`;

    const response = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(activeBookingRecord)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Airtable error creating Active Booking:', errorData);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const airtableResult = await response.json();
    console.log('✓ Active Booking created:', airtableResult.id);

    // ✅ FETCH THE TRACKING CODE from the created record
    const trackingCode = airtableResult.fields['Tracking Code'] || '';
    console.log('✓ Tracking Code:', trackingCode);

    return {
      success: true,
      activeBookingId: airtableResult.id,
      trackingCode: trackingCode,
      dropboxLink: dropboxResult.sharedLink,
      folders: {
        qc: dropboxResult.qcFolder,
        raw: dropboxResult.rawFolder
      }
    };

  } catch (error) {
    console.error('Error creating Active Booking:', error);
    // Don't throw - we don't want to fail the main booking if Active Booking creation fails
    return {
      success: false,
      error: error.message
    };
  }
}

// Export for use in create-booking.js
module.exports = { createActiveBooking };

// Also allow this to be called as a standalone function (for manual triggers/webhooks)
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const bookingData = JSON.parse(event.body);
    const result = await createActiveBooking(bookingData);

    return {
      statusCode: result.success ? 200 : 500,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Error in create-active-booking handler:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to create active booking',
        details: error.message
      })
    };
  }
};