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

    return {
      statusCode: 200,
      body: JSON.stringify({
        totalBookings: userAppointments.length,
        totalInvestment: userAppointments.reduce((sum, apt) => sum + (apt.price ? apt.price / 100 : 0), 0),
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