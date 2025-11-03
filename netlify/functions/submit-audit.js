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
  'Access-Control-Allow-Origin': '*', // In production, use your domain
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

    // Validate required fields
    if (!name || !agency || !email || !phone || score === undefined || !answers) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    console.log(`Processing audit for ${name} from ${agency} (Score: ${score})`);

    // Determine verdict based on score
    let verdict;
    if (score <= 8) verdict = 'Poor';
    else if (score <= 14) verdict = 'Fair';
    else if (score <= 18) verdict = 'Good';
    else verdict = 'Excellent';

    // Step 1: Generate AI analysis using Claude
    console.log('Generating AI analysis...');
    const aiAnalysis = await generateAIAnalysis(name, agency, score, answers, verdict);

    // Step 2: Save to Airtable
    console.log('Saving to Airtable...');
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
    console.log('Sending email notification...');
    await sendEmailNotification({
      name,
      agency,
      email,
      phone,
      score,
      verdict,
      airtableRecordUrl: `https://airtable.com/${process.env.AIRTABLE_BASE_ID}/${airtableRecord.id}`,
    });

    // Return success response with AI analysis
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
    console.error('Error processing audit:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to process audit',
        details: error.message 
      }),
    };
  }
};

/**
 * Generate AI-powered analysis using Claude
 */
async function generateAIAnalysis(name, agency, score, answers, verdict) {
  const firstName = name.split(' ')[0];

  // Build context about their answers
  const context = buildAnswerContext(answers);

  const prompt = `You are a marketing consultant for Markeb Media, a UK property photography and videography company. You're analyzing the marketing audit results for an estate agent.

**Agent Details:**
- Name: ${firstName}
- Agency: ${agency}
- Marketing Score: ${score}/22
- Verdict: ${verdict}

**Their Audit Answers:**
${context}

**Your Task:**
Generate a personalized, actionable marketing analysis for ${firstName} at ${agency}. Use a professional yet friendly tone.

**Structure your response as follows:**

# 🎯 Your Specific Marketing Gaps

[Identify 2-4 critical gaps based on their low-scoring answers. For each gap, explain:
- What the problem is
- Why it's costing them business
- The solution]

# 📋 Your 30-Day Action Plan

[Provide a week-by-week action plan tailored to their score:
- Week 1: [Specific actions]
- Week 2: [Specific actions]
- Week 3: [Specific actions]
- Week 4: [Specific actions]

Include expected impact/results]

# 💡 How Markeb Media Can Help

[Explain specifically which Markeb Media services address their gaps:
- Professional Photography (if Q1 is low)
- Cinematic Video Tours (if Q2 is low)
- Drone/Aerial Footage (if Q3 is low)
- 48-Hour Delivery (if Q4 is low)
- Live Progress Tracking (if Q6 is low)

End with a strong, personalized call-to-action]

**Important:**
- Be specific to their actual answers, not generic
- Use UK estate agent terminology (vendors, instructions, Rightmove, Zoopla)
- Focus on business impact (lost instructions, slower sales)
- Keep it under 800 words
- Use markdown formatting
- Be encouraging but honest about their gaps`;

  try {
   const message = await anthropic.messages.create({
  model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20240620',
      max_tokens: 2000,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract the text content from Claude's response
    const analysis = message.content[0].text;
    
    console.log('AI analysis generated successfully');
    return analysis;
  } catch (error) {
    console.error('Error generating AI analysis:', error);
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
        2: 'Entry-level professional',
        3: 'Professional property photographer'
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
      title: 'Progress Tracking',
      values: {
        0: 'No visibility',
        1: 'Email updates only',
        3: 'Live tracking system'
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
    }
  };

  let context = '';
  for (const [key, value] of Object.entries(answers)) {
    const q = questions[key];
    context += `- ${q.title}: ${q.values[value]} (${value} points)\n`;
  }

  return context;
}

/**
 * Save lead data to Airtable
 */
async function saveToAirtable(data) {
  try {
    const record = await base(process.env.AIRTABLE_TABLE_NAME).create([
      {
        fields: {
          'Name': data.name,
          'Agency Name': data.agency,
          'Email': data.email,
          'Phone': data.phone,
          'Score': data.score,
          'Verdict': data.verdict,
          'Submission Date': new Date().toISOString().split('T')[0],
          'Q1 - Photography': data.answers.q1,
          'Q2 - Video': data.answers.q2,
          'Q3 - Drone': data.answers.q3,
          'Q4 - Turnaround': data.answers.q4,
          'Q5 - Social Media': data.answers.q5,
          'Q6 - Tracking': data.answers.q6,
          'Q7 - Vendor Reaction': data.answers.q7,
          'Q8 - Competitive': data.answers.q8,
          'Status': 'New Lead',
          'AI Analysis': data.aiAnalysis,
        },
      },
    ]);

    console.log('Saved to Airtable successfully:', record[0].id);
    return record[0];
  } catch (error) {
    console.error('Airtable Error Details:', {
      message: error.message,
      statusCode: error.statusCode,
      error: error.error
    });
    throw new Error(`Failed to save to Airtable: ${error.message}`);
  }
}

/**
 * Send email notification via Resend
 */
async function sendEmailNotification(data) {
  try {
    // Determine urgency emoji and priority
    let urgency = '📧';
    let priority = 'STANDARD';
    if (data.score <= 8) {
      urgency = '🔥';
      priority = 'HOT LEAD';
    } else if (data.score <= 14) {
      urgency = '⚠️';
      priority = 'WARM LEAD';
    }

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #FF6B00, #FF8A33); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .score-box { background: white; border: 3px solid #FF6B00; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: center; }
            .score { font-size: 48px; font-weight: bold; color: #FF6B00; }
            .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 5px; }
            .label { font-weight: bold; color: #666; }
            .cta { background: #FF6B00; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${urgency} ${priority}: New Marketing Audit Lead!</h1>
            </div>
            <div class="content">
              <div class="score-box">
                <div class="score">${data.score}/22</div>
                <div style="font-size: 18px; color: #666; margin-top: 10px;">${data.verdict}</div>
              </div>
              
              <h2>Lead Details:</h2>
              <div class="info-row">
                <span class="label">Name:</span> ${data.name}
              </div>
              <div class="info-row">
                <span class="label">Agency:</span> ${data.agency}
              </div>
              <div class="info-row">
                <span class="label">Email:</span> <a href="mailto:${data.email}">${data.email}</a>
              </div>
              <div class="info-row">
                <span class="label">Phone:</span> <a href="tel:${data.phone}">${data.phone}</a>
              </div>
              
              <h3>Why This is ${priority}:</h3>
              <p>${getLeadInsight(data.score)}</p>
              
              <a href="${data.airtableRecordUrl}" class="cta">View Full Details in Airtable →</a>
              
              <p style="margin-top: 30px; color: #666; font-size: 14px;">
                <strong>Next Steps:</strong><br>
                ${getNextSteps(data.score)}
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: process.env.RESEND_TO_EMAIL,
      subject: `${urgency} ${priority}: ${data.name} from ${data.agency} (${data.score}/22)`,
      html: emailHtml,
    });

    console.log('Email notification sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
    // Don't throw - we don't want to fail the whole request if email fails
  }
}

/**
 * Get insight about the lead based on score
 */
function getLeadInsight(score) {
  if (score <= 8) {
    return "This agent has CRITICAL marketing deficiencies. They're losing instructions to competitors daily and are likely frustrated with their current marketing. HIGH conversion potential - call within 5 minutes!";
  } else if (score <= 14) {
    return "This agent knows they have marketing gaps but hasn't fixed them yet. They're in pain and looking for solutions. GOOD conversion potential - call within 1 hour.";
  } else if (score <= 18) {
    return "This agent is doing okay but sees room for improvement. They're open to upgrading but not desperate. MODERATE conversion potential - follow up within 24 hours.";
  } else {
    return "This agent has strong marketing already. They're harder to convert but may be interested in consistency, time-saving, or maintaining excellence. LOW conversion potential - nurture over time.";
  }
}

/**
 * Get recommended next steps based on score
 */
function getNextSteps(score) {
  if (score <= 8) {
    return "1. Call immediately (within 5 mins)<br>2. Emphasize they're losing business daily<br>3. Offer first shoot discount<br>4. Send before/after examples";
  } else if (score <= 14) {
    return "1. Call within 1 hour<br>2. Show competitive advantage of better marketing<br>3. Share case study from similar agency<br>4. Book discovery call";
  } else if (score <= 18) {
    return "1. Email within 2 hours<br>2. Call within 24 hours<br>3. Focus on fine-tuning and optimization<br>4. Offer consultation";
  } else {
    return "1. Send personalized email within 24 hours<br>2. Focus on time-saving and consistency<br>3. Offer VIP service tier<br>4. Follow up in 3 days";
  }
}