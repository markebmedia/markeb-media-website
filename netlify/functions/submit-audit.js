// netlify/functions/submit-audit.js
const Anthropic = require('@anthropic-ai/sdk');
const Airtable = require('airtable');
const { Resend } = require('resend');

// Initialize services
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const airtable = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });
const base = airtable.base(process.env.AIRTABLE_BASE_ID);

const resend = new Resend(process.env.RESEND_API_KEY);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Main handler for audit submissions
 */
exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Parse request body
    const { name, agency, email, phone, score, answers } = JSON.parse(event.body);

    // Log incoming data
    console.log('=== Incoming Audit Submission ===');
    console.log({ name, agency, email, phone, score, answers });

    // Validate required fields
    if (!name || !agency || !email || !phone || score === undefined || !answers) {
      console.error('❌ Missing required fields:', { name, agency, email, phone, score, answers });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    console.log(`Processing audit for ${name} from ${agency} (Score: ${score})`);

    // Determine verdict based on score (OUT OF 25)
    let verdict;
    if (score <= 10) verdict = 'Poor';
    else if (score <= 16) verdict = 'Fair';
    else if (score <= 21) verdict = 'Good';
    else verdict = 'Excellent';

    // Step 1: Generate AI analysis using Claude
    console.log('🧠 Generating AI analysis with Claude...');
    const aiAnalysis = await generateAIAnalysis(name, agency, score, answers, verdict);

    // Step 2: Save to Airtable
    console.log('💾 Saving to Airtable...');
    const airtableRecord = await saveToAirtable({
      name,
      agency,
      email,
      phone,
      score,
      verdict,
      answers,
      aiAnalysis,
    });

    // Step 3: Send email notification
    console.log('📨 Sending email notification...');
    await sendEmailNotification({
      name,
      agency,
      email,
      phone,
      score,
      verdict,
      airtableRecordUrl: `https://airtable.com/${process.env.AIRTABLE_BASE_ID}/${airtableRecord.id}`,
    });

    console.log('✅ Audit processed successfully');

    // Return success response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        analysis: aiAnalysis,
        recordId: airtableRecord.id,
      }),
    };
  } catch (error) {
    console.error('🚨 GLOBAL ERROR HANDLER TRIGGERED 🚨');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Stack trace:', error.stack);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process audit',
        details: error.message,
      }),
    };
  }
};

/**
 * Generate AI-powered analysis using Claude
 */
async function generateAIAnalysis(name, agency, score, answers, verdict) {
  const firstName = name.split(' ')[0];
  const context = buildAnswerContext(answers);

  const prompt = `
You are an elite property marketing consultant with 15+ years of experience working exclusively with top-performing estate agents across the UK. You specialise in property photography, videography, branding, and digital marketing strategy.

You're analysing the marketing audit results for ${firstName} at ${agency}.

**Agent Details:**
- Name: ${firstName}
- Agency: ${agency}
- Marketing Score: ${score}/25
- Verdict: ${verdict}

**Their Audit Answers:**
${context}

**Your Task:**
Generate a concise, strategic marketing analysis for ${firstName} at ${agency}.

**CRITICAL REQUIREMENTS:**
1. Write everything in UK English spelling (e.g., specialise, analyse, colour, recognise, optimise)
2. Keep response under 700 words - be concise and impactful
3. Reference real market dynamics and business impact
4. At the end, mention that Markeb Media specialises in helping estate agents through professional property photography and videography, brand development, and social media content strategy

**Structure:**
1. **Opening**: Brief acknowledgement of their score ${score}/25 and what it means
2. **Key Strengths** (if score >15): 2-3 sentences on what they're doing well
3. **Critical Improvements**: 3 specific recommendations with brief business impact for each. PUT TWO LINE BREAKS between each numbered item for better readability.
4. **Business Impact**: One paragraph on how improvements affect their bottom line. PUT TWO LINE BREAKS before this section.
5. **Closing**: Brief mention of Markeb Media services

Use clear spacing with double line breaks between major sections and between numbered items for easy scanning.

Tone: Confident, strategic, solution-focused. Use ${firstName}'s name naturally.
`;

  try {
    const message = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1200, // ⭐ REDUCED from 2500 to 1200 for faster generation
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    });

    const analysis = message.content[0].text;
    console.log('✅ AI analysis generated successfully');
    return analysis;
  } catch (error) {
    console.error('❌ Error generating AI analysis:', error);
    throw new Error('Failed to generate AI analysis');
  }
}

/**
 * Build context string from answers for AI prompt
 */
function buildAnswerContext(answers) {
  const questions = {
    q1: { 
      title: 'Photography Quality', 
      values: { 
        1: 'iPhone or basic camera', 
        2: 'General Media Specialist (does properties occasionally)', 
        3: 'Specialist property Media Specialist with HDR/editing' 
      } 
    },
    q2: { 
      title: 'Video Content', 
      values: { 
        0: 'No video content', 
        2: 'Basic walkthrough videos', 
        4: 'Professional video tours' 
      } 
    },
    q3: { 
      title: 'Drone/Aerial', 
      values: { 
        0: 'Never use drone', 
        2: 'Occasionally use drone', 
        3: 'Regular drone usage' 
      } 
    },
    q4: { 
      title: 'Turnaround Time', 
      values: { 
        1: '1 week or more', 
        2: '3-5 business days', 
        3: '48 hours or less' 
      } 
    },
    q5: { 
      title: 'Social Media Activity', 
      values: { 
        1: 'Rarely or never post', 
        2: 'Occasionally post listings', 
        3: 'Regular engaging content' 
      } 
    },
    q6: { 
      title: 'Marketing Performance Reports', 
      values: { 
        0: 'No - clients rarely receive performance updates', 
        1: 'Occasional updates when clients ask', 
        3: 'Weekly performance reports with views, engagement & enquiries' 
      } 
    },
    q7: { 
      title: 'Vendor Reaction', 
      values: { 
        1: 'Often disappointed', 
        2: 'Generally satisfied', 
        3: 'Consistently impressed' 
      } 
    },
    q8: { 
      title: 'Competitive Position', 
      values: { 
        1: 'Behind the competition', 
        2: 'About the same', 
        3: 'Market leader' 
      } 
    },
  };

  let context = '';
  for (const [key, value] of Object.entries(answers)) {
    const q = questions[key];
    if (!q) continue;
    context += `- ${q.title}: ${q.values[value] || 'Unknown'} (${value} points)\n`;
  }

  return context;
}

/**
 * Save lead data to Airtable
 */
async function saveToAirtable(data) {
  console.log('🧾 Preparing data for Airtable:', JSON.stringify(data, null, 2));

  try {
    const record = await base(process.env.AIRTABLE_TABLE_NAME).create([
      {
        fields: {
          Name: data.name,
          'Agency Name': data.agency,
          Email: data.email,
          Phone: data.phone,
          Score: data.score,
          Verdict: data.verdict,
          'Submission Date': new Date().toISOString().split('T')[0],
          'Q1 - Photography': data.answers.q1,
          'Q2 - Video': data.answers.q2,
          'Q3 - Drone': data.answers.q3,
          'Q4 - Turnaround': data.answers.q4,
          'Q5 - Social Media': data.answers.q5,
          'Q6 - Performance Reports': data.answers.q6,
          'Q7 - Vendor Reaction': data.answers.q7,
          'Q8 - Competitive': data.answers.q8,
          Status: 'New Lead',
          'AI Analysis': data.aiAnalysis,
        },
      },
    ]);

    console.log('✅ Saved to Airtable successfully:', record[0].id);
    return record[0];
  } catch (error) {
    console.error('🚨 Airtable Save Error 🚨');
    console.error('Message:', error.message);
    console.error('Status Code:', error.statusCode);
    console.error('Error Object:', JSON.stringify(error, null, 2));
    console.error('Data sent to Airtable:', JSON.stringify(data, null, 2));
    throw new Error(`Failed to save to Airtable: ${error.message}`);
  }
}

/**
 * Send email notification via Resend
 */
async function sendEmailNotification(data) {
  try {
    let urgency = '📧';
    let priority = 'STANDARD';
    if (data.score <= 10) {
      urgency = '🔥';
      priority = 'HOT LEAD';
    } else if (data.score <= 16) {
      urgency = '⚠️';
      priority = 'WARM LEAD';
    }

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head><style>body { font-family: Arial; }</style></head>
        <body>
          <h1>${urgency} ${priority}: New Marketing Audit Lead!</h1>
          <p><strong>${data.name}</strong> from <strong>${data.agency}</strong></p>
          <p>Score: ${data.score}/25 — Verdict: ${data.verdict}</p>
          <p><a href="${data.airtableRecordUrl}">View in Airtable</a></p>
        </body>
      </html>
    `;

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: process.env.RESEND_TO_EMAIL,
      subject: `${urgency} ${priority}: ${data.name} from ${data.agency} (${data.score}/25)`,
      html: emailHtml,
    });

    console.log('✅ Email notification sent successfully');
  } catch (error) {
    console.error('⚠️ Error sending email notification:', error);
  }
}