// netlify/functions/acuity-data.js (example)
exports.handler = async (event, context) => {
  const { userEmail } = JSON.parse(event.body);

  try {
    const response = await fetch(`https://acuityscheduling.com/api/v1/appointments`, {
      headers: {
        'Authorization': `Basic ${btoa(`${process.env.ACUITY_USER_ID}:${process.env.ACUITY_API_KEY}`)}`
      }
    });

    const appointments = await response.json();
    const userAppointments = appointments.filter(apt =>
      apt.email && apt.email.toLowerCase() === userEmail.toLowerCase()
    );

    // --- Accurate price calculation ---
    function pickAmount(apt) {
      // Prefer more precise fields if they exist
      const raw = apt.total ?? apt.amountPaid ?? apt.amount_paid ?? apt.price ?? 0;

      // normalize to string, strip symbols, handle commas
      const s = String(raw).trim().replace(/[^\d.,-]/g, '').replace(',', '.');

      // convert to cents as integer
      const cents = Math.round(parseFloat(s || '0') * 100);
      return Number.isFinite(cents) ? cents : 0;
    }

    const totalCents = userAppointments.reduce((sum, apt) => sum + pickAmount(apt), 0);
    const totalInvestment = totalCents / 100; // will be 286.80 not 2.87

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalBookings: userAppointments.length,
        totalInvestment, // e.g. 286.80
        appointments: userAppointments
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
