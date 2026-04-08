const { sendBookingConfirmation } = require('./email-service');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { bookingId } = JSON.parse(event.body);
    if (!bookingId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing bookingId' }) };

    // Fetch the booking from Airtable
    const atRes = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Bookings/${bookingId}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } }
    );

    if (!atRes.ok) throw new Error('Booking not found in Airtable');
    const record = await atRes.json();
    const f = record.fields;

    // Build the same booking object email-service expects
    const booking = {
      bookingRef:         f['Booking Reference'],
      clientName:         f['Client Name'],
      clientEmail:        f['Client Email'],
      service:            f['Service'],
      date:               f['Date'],
      time:               f['Time'],
      propertyAddress:    f['Property Address'],
      postcode:           f['Postcode'] || '',
      mediaSpecialist:    f['Media Specialist'] || '',
      totalPrice:         f['Final Price'] || 0,
      paymentStatus:      f['Payment Status'] || 'Pending',
      cardLast4:          f['Card Last 4'] || null,
      accessType:         f['Access Type'] || '',
      keyPickupLocation:  f['Key Pickup Location'] || '',
      squareFootage:      f['Square Footage'] || null,
      trackingCode:       f['Tracking Code'] || '',
      region:             f['Region'] || '',
      createdBy:          f['Created By'] || '',
      addons: (() => {
        const raw = f['Add-Ons'] || f['Add-ons'] || f['Addons'] || '';
        return raw ? raw.split(',').map(a => ({ name: a.trim() })).filter(a => a.name) : [];
      })()
    };

    await sendBookingConfirmation(booking);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, sentTo: booking.clientEmail })
    };

  } catch (err) {
    console.error('resend-confirmation error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};