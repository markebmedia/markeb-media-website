// netlify/functions/validate-discount-code.js

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
    const { code, totalPrice, region, serviceId } = JSON.parse(event.body);

    console.log('📥 Validating discount code:', { code, totalPrice, region, serviceId });

    if (!code || !totalPrice) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Code and total price required' })
      };
    }

    // ✅ FIXED: Use correct environment variable name (TABL not TABLE)
    const tableId = process.env.AIRTABLE_DISCOUNT_CODES_TABL;
    
    if (!tableId) {
      console.error('❌ AIRTABLE_DISCOUNT_CODES_TABL environment variable not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Discount code table not configured' 
        })
      };
    }

    // Fetch discount code from Airtable
    const filterFormula = `AND(UPPER({Code}) = "${code.toUpperCase()}", {Status} = "Active")`;
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tableId}?filterByFormula=${encodeURIComponent(filterFormula)}`;

    console.log('📤 Fetching from Airtable');

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });

    if (!response.ok) {
      console.error('❌ Airtable error:', response.status);
      throw new Error('Failed to fetch from Airtable');
    }

    const data = await response.json();
    console.log('📥 Found records:', data.records?.length || 0);

    if (!data.records || data.records.length === 0) {
      console.log('❌ No matching discount code found');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid or expired discount code' 
        })
      };
    }

    const discountRecord = data.records[0];
    const discount = discountRecord.fields;

    console.log('✅ Discount code found:', discount['Code']);

    // Check if code is still valid
    const now = new Date();
    const validFrom = discount['Valid From'] ? new Date(discount['Valid From']) : null;
    const validUntil = discount['Valid Until'] ? new Date(discount['Valid Until']) : null;

    if (validFrom && now < validFrom) {
      console.log('❌ Code not yet active');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'This code is not yet active' 
        })
      };
    }

    if (validUntil && now > validUntil) {
      console.log('❌ Code expired');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'This code has expired' 
        })
      };
    }

    // Check max uses
    const maxUses = discount['Max Uses'];
    const timesUsed = discount['Times Used'] || 0;

    if (maxUses && timesUsed >= maxUses) {
      console.log('❌ Usage limit reached');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'This code has reached its usage limit' 
        })
      };
    }

    // Check minimum purchase
    const minPurchase = discount['Min Purchase'];
    if (minPurchase && totalPrice < minPurchase) {
      console.log('❌ Minimum purchase not met');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: `Minimum purchase of £${minPurchase.toFixed(2)} required for this code` 
        })
      };
    }

    // Check region restrictions
    const applicableRegions = discount['Applicable Regions'];
    if (applicableRegions && applicableRegions.length > 0 && region) {
      if (!applicableRegions.includes(region)) {
        console.log('❌ Region not applicable:', { applicableRegions, region });
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'This code is not valid for your region' 
          })
        };
      }
    }

    // Check service restrictions
    const applicableServices = discount['Applicable Services'];
    if (applicableServices && applicableServices.length > 0 && serviceId) {
      if (!applicableServices.includes(serviceId)) {
        console.log('❌ Service not applicable:', { applicableServices, serviceId });
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ 
            success: false, 
            error: 'This code is not valid for the selected service' 
          })
        };
      }
    }

    // Calculate discount amount
    let discountAmount = 0;
    const discountType = discount['Discount Type'];
    const discountValue = discount['Discount Value'];

    if (discountType === 'Percentage') {
      discountAmount = (totalPrice * discountValue) / 100;
    } else if (discountType === 'Fixed Amount') {
      discountAmount = Math.min(discountValue, totalPrice);
    }

    const finalPrice = Math.max(0, totalPrice - discountAmount);

    console.log('✅ Discount valid:', {
      discountAmount,
      finalPrice
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        code: discount['Code'],
        discountType: discountType,
        discountValue: discountValue,
        discountAmount: discountAmount,
        originalPrice: totalPrice,
        finalPrice: finalPrice,
        recordId: discountRecord.id
      })
    };

  } catch (error) {
    console.error('❌ Error validating discount code:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to validate discount code',
        details: error.message
      })
    };
  }
};