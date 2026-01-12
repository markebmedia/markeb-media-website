// netlify/functions/acuity-data.js
exports.handler = async (event, context) => {
  const { userEmail } = JSON.parse(event.body);
  
  try {
    const response = await fetch('https://acuityscheduling.com/api/v1/appointments', {
      headers: {
        'Authorization': `Basic ${btoa(`${process.env.ACUITY_USER_ID}:${process.env.ACUITY_API_KEY}`)}`
      }
    });
    
    const appointments = await response.json();
    
    const userAppointments = appointments.filter(apt =>
      apt.email && apt.email.toLowerCase() === userEmail.toLowerCase()
    );
    
    // --- Accurate price calculation (robust parsing, integer cents) ---
    function parseMoneyToNumber(raw) {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string') {
        let s = raw.trim();
        // Remove currency symbols and spaces first
        s = s.replace(/[^\d.,-]/g, '');
        // If both comma and dot exist, commas are thousands separators
        if (s.includes(',') && s.includes('.')) {
          s = s.replace(/,/g, '');
        } else if (s.includes(',') && !s.includes('.')) {
          // Only comma present => it's the decimal separator
          s = s.replace(',', '.');
        }
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : 0;
      }
      // Some APIs can return nested objects or other shapes; add more cases if needed.
      return 0;
    }
    
    function pickAmountCents(apt) {
      // Prefer the most precise fields if they exist, then fall back
      const candidates = [
        apt.total,
        apt.amountPaid,
        apt.amount_paid,
        apt.price,
        apt.amount
      ];
      
      for (const c of candidates) {
        const num = parseMoneyToNumber(c);
        if (num > 0) {
          return Math.round(num * 100); // convert to integer cents
        }
      }
      return 0;
    }
    
    const totalCents = userAppointments.reduce((sum, apt) => sum + pickAmountCents(apt), 0);
    const totalInvestment = totalCents / 100; // exact to 2dp when displayed with toFixed(2)
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        totalBookings: userAppointments.length,
        totalInvestment, // e.g., 286.80
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
