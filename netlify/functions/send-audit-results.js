const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { name, email, company, answers, score } = data;

    // Generate personalised analysis based on answers
    const analysis = generateAnalysis(answers, score);
    const recommendations = generateRecommendations(answers);

    // Create email HTML
    const emailHTML = createEmailTemplate(name, company, score, analysis, recommendations);

    // Send email using Resend
    const emailData = await resend.emails.send({
      from: 'Markeb Media <commercial@markebmedia.com>',
      to: [email],
      subject: `Your Personalised Marketing Audit Results - ${company}`,
      html: emailHTML,
      reply_to: 'commercial@markebmedia.com',
      tags: [
        { name: 'category', value: 'marketing-audit' },
        { name: 'score', value: score.toString() }
      ]
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Audit results sent successfully',
        emailId: emailData.id
      })
    };

  } catch (error) {
    console.error('Error sending audit results:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to send audit results',
        details: error.message 
      })
    };
  }
};

function generateAnalysis(answers, score) {
  let analysis = [];

  // Social Media Presence
  if (answers.socialMedia === 'no' || answers.socialMedia === 'inconsistent') {
    analysis.push({
      icon: '🚨',
      title: 'Social Media Gap',
      text: 'Your social media presence needs immediate attention. In today\'s property market, 78% of buyers start their search on social platforms.',
      severity: 'critical'
    });
  } else {
    analysis.push({
      icon: '✅',
      title: 'Social Media',
      text: 'You have an active social presence - great foundation!',
      severity: 'good'
    });
  }

  // Professional Content
  if (answers.professionalContent === 'no') {
    analysis.push({
      icon: '📸',
      title: 'Content Quality Issue',
      text: 'Professional photography and video are crucial. Properties with professional media sell 32% faster and at 5-10% higher prices.',
      severity: 'critical'
    });
  } else {
    analysis.push({
      icon: '✅',
      title: 'Professional Content',
      text: 'You\'re using quality visuals - this sets you apart.',
      severity: 'good'
    });
  }

  // Personal Branding
  if (answers.personalBranding === 'no') {
    analysis.push({
      icon: '👤',
      title: 'Personal Brand Opportunity',
      text: 'Building your personal brand creates trust. Agents with strong personal brands generate 3x more referrals.',
      severity: 'warning'
    });
  } else {
    analysis.push({
      icon: '✅',
      title: 'Personal Branding',
      text: 'You\'re building your personal brand - excellent!',
      severity: 'good'
    });
  }

  // Content Consistency
  if (answers.contentConsistency === 'no') {
    analysis.push({
      icon: '📅',
      title: 'Consistency Challenge',
      text: 'Regular posting is key. Consistent content keeps you top-of-mind with potential clients.',
      severity: 'warning'
    });
  }

  // Time Management
  if (answers.timeForMarketing === 'no') {
    analysis.push({
      icon: '⏰',
      title: 'Time Constraint Identified',
      text: 'You\'re stretched thin. This is exactly why agencies like ours exist - to handle marketing whilst you focus on selling.',
      severity: 'warning'
    });
  }

  // Tracking & Analytics
  if (answers.trackResults === 'no') {
    analysis.push({
      icon: '📊',
      title: 'Analytics Gap',
      text: 'Without tracking, you\'re marketing blind. Data-driven decisions improve ROI by 3-5x.',
      severity: 'warning'
    });
  }

  return analysis;
}

function generateRecommendations(answers) {
  let recommendations = [];

  if (answers.socialMedia === 'no' || answers.socialMedia === 'inconsistent') {
    recommendations.push({
      title: 'Establish Consistent Social Media Presence',
      description: 'Post 3-5 times per week across Instagram and Facebook with property showcases, local market insights, and personal branding content.',
      priority: 'HIGH',
      impact: 'High visibility and lead generation'
    });
  }

  if (answers.professionalContent === 'no') {
    recommendations.push({
      title: 'Invest in Professional Property Media',
      description: 'Professional photography, video tours, and drone footage for every listing. This is non-negotiable in competitive markets.',
      priority: 'CRITICAL',
      impact: 'Faster sales at higher prices'
    });
  }

  if (answers.personalBranding === 'no') {
    recommendations.push({
      title: 'Build Your Personal Brand',
      description: 'Professional headshots, lifestyle shots, and personal story content that builds trust and connection with potential clients.',
      priority: 'HIGH',
      impact: 'Increased trust and referrals'
    });
  }

  if (answers.contentManagement === 'no') {
    recommendations.push({
      title: 'Implement Content Management System',
      description: 'Use a content calendar and management system to plan, create, and schedule content in advance.',
      priority: 'MEDIUM',
      impact: 'Better organisation and consistency'
    });
  }

  if (answers.trackResults === 'no') {
    recommendations.push({
      title: 'Set Up Analytics & Tracking',
      description: 'Track engagement, reach, and conversion metrics to understand what works and optimise your marketing spend.',
      priority: 'MEDIUM',
      impact: 'Data-driven decision making'
    });
  }

  if (answers.outsourceMarketing === 'no' && answers.timeForMarketing === 'no') {
    recommendations.push({
      title: 'Consider Marketing Partnership',
      description: 'Partner with a specialised property marketing agency to handle content creation, social media, and branding whilst you focus on sales.',
      priority: 'HIGH',
      impact: 'More time for selling, professional results'
    });
  }

  return recommendations;
}

function getScoreRating(score) {
  if (score >= 9) return { label: 'Excellent', color: '#10b981', message: 'Your marketing is in great shape! Focus on optimisation and scaling.' };
  if (score >= 7) return { label: 'Good', color: '#3b82f6', message: 'Solid foundation with room for improvement in a few key areas.' };
  if (score >= 5) return { label: 'Needs Attention', color: '#f59e0b', message: 'Several opportunities to significantly improve your marketing results.' };
  return { label: 'Critical', color: '#ef4444', message: 'Your marketing needs immediate attention to stay competitive.' };
}

function createEmailTemplate(name, company, score, analysis, recommendations) {
  const firstName = name.split(' ')[0];
  const scoreRating = getScoreRating(score);
  
  return `
<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Marketing Audit Results</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
      line-height: 1.6; 
      color: #1e293b; 
      background-color: #f8fafc;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 20px;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: #ffffff; 
      border-radius: 16px; 
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header { 
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); 
      color: white; 
      padding: 40px 30px; 
      text-align: center;
    }
    .header h1 { 
      margin: 0 0 10px 0; 
      font-size: 28px; 
      font-weight: 700;
      line-height: 1.2;
    }
    .header .company { 
      margin: 0; 
      opacity: 0.9; 
      font-size: 16px;
    }
    .score-container {
      margin: 30px 0 20px;
    }
    .score-badge {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      width: 140px;
      height: 140px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
    }
    .score-number {
      font-size: 56px;
      font-weight: 700;
      line-height: 1;
    }
    .score-label {
      font-size: 14px;
      opacity: 0.9;
      margin-top: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .score-rating {
      margin-top: 15px;
      padding: 8px 20px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      display: inline-block;
    }
    .content { 
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      margin-bottom: 20px;
      color: #0f172a;
      font-weight: 600;
    }
    .intro {
      font-size: 16px;
      margin-bottom: 30px;
      color: #475569;
      line-height: 1.7;
    }
    .section { 
      margin-bottom: 40px;
    }
    .section-title { 
      font-size: 22px; 
      font-weight: 700; 
      color: #0f172a; 
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .analysis-item {
      background: #f8fafc;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 15px;
      border-left: 4px solid;
    }
    .analysis-item.critical { border-left-color: #ef4444; }
    .analysis-item.warning { border-left-color: #f59e0b; }
    .analysis-item.good { border-left-color: #10b981; }
    .analysis-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .analysis-icon {
      font-size: 24px;
      line-height: 1;
    }
    .analysis-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .analysis-text {
      color: #475569;
      font-size: 14px;
      line-height: 1.6;
      margin-left: 34px;
    }
    .recommendation-card {
      background: #ffffff;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 15px;
      transition: all 0.2s ease;
    }
    .rec-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 12px;
      gap: 15px;
    }
    .rec-title {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
      flex: 1;
    }
    .priority-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .priority-critical {
      background: #fee2e2;
      color: #991b1b;
    }
    .priority-high {
      background: #fef3c7;
      color: #92400e;
    }
    .priority-medium {
      background: #dbeafe;
      color: #1e40af;
    }
    .rec-description {
      color: #475569;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 10px;
    }
    .rec-impact {
      color: #3b82f6;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .cta-section {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      padding: 35px 30px;
      text-align: center;
      border-radius: 12px;
      margin: 40px 0;
    }
    .cta-section h3 {
      color: white;
      margin: 0 0 15px 0;
      font-size: 24px;
      font-weight: 700;
    }
    .cta-section p {
      color: rgba(255, 255, 255, 0.95);
      margin: 0 0 25px 0;
      font-size: 16px;
    }
    .cta-button {
      display: inline-block;
      background: white;
      color: #059669;
      padding: 16px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 700;
      font-size: 16px;
      transition: all 0.2s ease;
    }
    .services-grid {
      background: #f8fafc;
      border-radius: 12px;
      padding: 25px;
      margin: 30px 0;
    }
    .service-item {
      padding: 12px 0;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: start;
      gap: 12px;
    }
    .service-item:last-child {
      border-bottom: none;
    }
    .service-icon {
      font-size: 20px;
      flex-shrink: 0;
    }
    .service-content {
      flex: 1;
    }
    .service-title {
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .service-desc {
      color: #64748b;
      font-size: 14px;
    }
    .offer-box {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border: 2px solid #3b82f6;
      border-radius: 12px;
      padding: 25px;
      text-align: center;
      margin: 30px 0;
    }
    .offer-box p {
      margin: 0;
      color: #1e40af;
      font-size: 16px;
      font-weight: 600;
    }
    .offer-highlight {
      color: #3b82f6;
      font-weight: 700;
      font-size: 18px;
    }
    .footer {
      background: #f8fafc;
      padding: 35px 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
    }
    .logo {
      margin-bottom: 20px;
    }
    .footer-links {
      margin: 20px 0;
    }
    .footer-links a {
      color: #3b82f6;
      text-decoration: none;
      margin: 0 15px;
      font-weight: 600;
      font-size: 14px;
    }
    .social-icons {
      margin: 25px 0;
    }
    .social-link {
      display: inline-block;
      margin: 0 8px;
      font-size: 28px;
      text-decoration: none;
    }
    .footer-text {
      color: #64748b;
      font-size: 12px;
      margin-top: 20px;
      line-height: 1.6;
    }
    .signature {
      margin-top: 40px;
      padding-top: 25px;
      border-top: 1px solid #e2e8f0;
    }
    .signature-name {
      font-weight: 700;
      color: #0f172a;
      font-size: 16px;
      margin-bottom: 5px;
    }
    .signature-title {
      color: #64748b;
      font-size: 14px;
    }
    .contact-link {
      color: #3b82f6;
      text-decoration: none;
      font-weight: 600;
    }
    
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 20px 10px; }
      .header { padding: 30px 20px; }
      .header h1 { font-size: 24px; }
      .score-badge {
        width: 120px;
        height: 120px;
      }
      .score-number { font-size: 48px; }
      .content { padding: 30px 20px; }
      .section-title { font-size: 20px; }
      .rec-header { flex-direction: column; }
      .cta-section { padding: 25px 20px; }
      .cta-section h3 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <!-- Header -->
      <div class="header">
        <h1>Your Marketing Audit Results</h1>
        <p class="company">${company}</p>
        
        <div class="score-container">
          <div class="score-badge">
            <div class="score-number">${score}/10</div>
            <div class="score-label">Your Score</div>
          </div>
          <div class="score-rating" style="background-color: ${scoreRating.color};">
            ${scoreRating.label}
          </div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="content">
        <div class="greeting">Hi ${firstName},</div>
        
        <div class="intro">
          Thank you for completing our Marketing Audit! Based on your responses, we've prepared a personalised analysis of your current marketing approach. 
          <strong>${scoreRating.message}</strong>
        </div>

        <!-- Analysis Section -->
        <div class="section">
          <h2 class="section-title">📊 Your Marketing Analysis</h2>
          ${analysis.map(item => `
            <div class="analysis-item ${item.severity}">
              <div class="analysis-header">
                <span class="analysis-icon">${item.icon}</span>
                <span class="analysis-title">${item.title}</span>
              </div>
              <div class="analysis-text">${item.text}</div>
            </div>
          `).join('')}
        </div>

        <!-- Recommendations Section -->
        <div class="section">
          <h2 class="section-title">🎯 Your Personalised Action Plan</h2>
          ${recommendations.map(rec => `
            <div class="recommendation-card">
              <div class="rec-header">
                <h3 class="rec-title">${rec.title}</h3>
                <span class="priority-badge priority-${rec.priority.toLowerCase()}">${rec.priority}</span>
              </div>
              <p class="rec-description">${rec.description}</p>
              <div class="rec-impact">
                <span>💡</span>
                <span>Impact: ${rec.impact}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- CTA Section -->
        <div class="cta-section">
          <h3>Ready to Transform Your Marketing?</h3>
          <p>Let's discuss how Markeb Media can take your property marketing to the next level.</p>
          <a href="https://markebmediabookings.as.me/" class="cta-button">📅 Book Your Free Strategy Call</a>
        </div>

        <!-- Services Overview -->
        <div class="section">
          <h2 class="section-title">🚀 How We Can Help</h2>
          <div class="services-grid">
            <div class="service-item">
              <span class="service-icon">📸</span>
              <div class="service-content">
                <div class="service-title">Professional Property Photography & Video</div>
                <div class="service-desc">Showcase every listing at its absolute best with stunning visuals</div>
              </div>
            </div>
            <div class="service-item">
              <span class="service-icon">🎬</span>
              <div class="service-content">
                <div class="service-title">Personal Branding Sessions</div>
                <div class="service-desc">Build trust and recognition in your local market</div>
              </div>
            </div>
            <div class="service-item">
              <span class="service-icon">📱</span>
              <div class="service-content">
                <div class="service-title">Social Media Management</div>
                <div class="service-desc">Consistent, professional content that converts followers into clients</div>
              </div>
            </div>
            <div class="service-item">
              <span class="service-icon">🚁</span>
              <div class="service-content">
                <div class="service-title">Drone Footage</div>
                <div class="service-desc">Stunning aerial perspectives that make properties stand out</div>
              </div>
            </div>
            <div class="service-item">
              <span class="service-icon">📊</span>
              <div class="service-content">
                <div class="service-title">Content Strategy & Planning</div>
                <div class="service-desc">Data-driven marketing that delivers measurable results</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Special Offer -->
        <div class="offer-box">
          <p>
            💡 <span class="offer-highlight">Special Offer:</span> Mention this audit to receive 
            <span class="offer-highlight">10% off your first project</span> with us!
          </p>
        </div>

        <!-- Closing -->
        <p style="color: #475569; margin-top: 30px;">
          Questions? Simply reply to this email or give us a call. We're here to help you succeed in today's competitive property market.
        </p>

        <!-- Signature -->
        <div class="signature">
          <div class="signature-name">The Markeb Media Team</div>
          <div class="signature-title">Property Marketing Specialists</div>
          <div style="margin-top: 10px;">
            <a href="mailto:commercial@markebmedia.com" class="contact-link">commercial@markebmedia.com</a>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <div class="logo">
          <img src="https://markebmedia.com/public/images/Markeb%20Media%20Logo%20(2).PNG" alt="Markeb Media" style="height: 50px;">
        </div>
        
        <div class="footer-links">
          <a href="https://markebmedia.com">Website</a>
        </div>

        <div class="social-icons">
          <a href="https://instagram.com/markeb_mediauk" class="social-link">📸</a>
        </div>

        <p class="footer-text">
          © ${new Date().getFullYear()} Markeb Media. All rights reserved.<br>
          You're receiving this email because you completed our Marketing Audit.<br>
          Property Marketing Specialists for Estate Agents
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}