// netlify/functions/send-reminders.js
// Scheduled function — runs daily at 9am UTC
// Finds bookings for tomorrow, skips cancelled ones, sends reminder emails

const Airtable = require('airtable');
const { sendReminderEmail } = require('./email-service');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

exports.handler = async (event) => {
  console.log('=== Send Reminders Function ===');
  console.log('Triggered at:', new Date().toISOString());

  // Calculate tomorrow's date in YYYY-MM-DD format
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  console.log('Looking for bookings on:', tomorrowStr);

  try {
    // Fetch all bookings for tomorrow that are NOT cancelled
    const records = await base('Bookings')
      .select({
        filterByFormula: `AND(
          {Date} = '${tomorrowStr}',
          {Booking Status} != 'Cancelled'
        )`
      })
      .all();

    console.log(`Found ${records.length} active booking(s) for tomorrow`);

    if (records.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No bookings to remind', count: 0 })
      };
    }

    const results = [];

    for (const record of records) {
      const fields = record.fields;
      const bookingRef = fields['Booking Reference'];

      // Parse add-ons
      let addonsArray = [];
      try {
        addonsArray = JSON.parse(fields['Add-Ons'] || '[]');
      } catch (e) {
        addonsArray = [];
      }

      // Build booking object matching the shape email-service.js expects
      const booking = {
        bookingRef,
        clientName: fields['Client Name'],
        clientEmail: fields['Client Email'],
        service: fields['Service'],
        addons: addonsArray,
        date: fields['Date'],
        time: fields['Time'],
        propertyAddress: fields['Property Address'],
        postcode: fields['Postcode'] || '',
        mediaSpecialist: fields['Media Specialist'],
        accessType: fields['Access Type'] || '',
        keyPickupLocation: fields['Key Pickup Location'] || '',
        totalPrice: fields['Total Price'] || 0
      };

      // Guard: skip if no email
      if (!booking.clientEmail) {
        console.warn(`Skipping ${bookingRef} — no client email`);
        results.push({ bookingRef, status: 'skipped', reason: 'no email' });
        continue;
      }

      try {
        await sendReminderEmail(booking);
        console.log(`✅ Reminder sent for ${bookingRef} to ${booking.clientEmail}`);
        results.push({ bookingRef, status: 'sent', email: booking.clientEmail });
      } catch (emailError) {
        console.error(`❌ Failed to send reminder for ${bookingRef}:`, emailError.message);
        results.push({ bookingRef, status: 'failed', error: emailError.message });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    console.log(`Summary: ${sent} sent, ${failed} failed`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Reminders processed for ${tomorrowStr}`,
        sent,
        failed,
        results
      })
    };

  } catch (error) {
    console.error('Error in send-reminders:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to process reminders',
        details: error.message
      })
    };
  }
};