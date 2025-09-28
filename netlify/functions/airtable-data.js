exports.handler = async (event, context) => {
  const { userEmail } = JSON.parse(event.body);
  
  try {
    const filterFormula = encodeURIComponent(`{Email Address} = '${userEmail}'`);
    const url = `https://api.airtable.com/v0/appVzPU0icwL8H6aP/tblRgcv7M9dUU3YuL?filterByFormula=${filterFormula}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
      }
    });
    
    const data = await response.json();
    const records = data.records || [];
    const completedProjects = records.filter(record => {
      const status = record.fields.Status;
      return status === 'Ready for Delivery' || status === 'Delivered';
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        completedProjects: completedProjects.length,
        totalProjects: records.length,
        projects: records
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};