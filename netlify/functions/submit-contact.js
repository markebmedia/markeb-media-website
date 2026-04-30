const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { name, email, agency, phone, message } = JSON.parse(event.body);

        if (!name || !email || !message) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Name, email and message are required.' })
            };
        }

        // Notify the Markeb Media team
        await resend.emails.send({
            from: 'Markeb Media Website <noreply@markebmedia.com>',
            to: ['Jodie.Hamshaw@markebmedia.com', 'commercial@markebmedia.com'],
            replyTo: email,
            subject: `New Website Enquiry from ${name}${agency ? ` — ${agency}` : ''}`,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FDF3E2;border:1px solid #e8d9be;border-radius:8px;overflow:hidden;">
                    <div style="background:#3F4D1B;padding:28px 32px;">
                        <p style="margin:0;color:rgba(253,243,226,0.6);font-size:12px;letter-spacing:2px;text-transform:uppercase;">New Enquiry</p>
                        <h1 style="margin:8px 0 0;color:#FDF3E2;font-size:22px;font-weight:700;">Markeb Media Website</h1>
                    </div>
                    <div style="padding:32px;">
                        <table style="width:100%;border-collapse:collapse;">
                            <tr><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:13px;color:#8A7050;width:120px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Name</td><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:15px;color:#1C140A;">${name}</td></tr>
                            <tr><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:13px;color:#8A7050;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Email</td><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:15px;"><a href="mailto:${email}" style="color:#B46100;">${email}</a></td></tr>
                            ${agency ? `<tr><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:13px;color:#8A7050;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Agency</td><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:15px;color:#1C140A;">${agency}</td></tr>` : ''}
                            ${phone ? `<tr><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:13px;color:#8A7050;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #e8d9be;font-size:15px;color:#1C140A;">${phone}</td></tr>` : ''}
                        </table>
                        <div style="margin-top:24px;">
                            <p style="font-size:13px;color:#8A7050;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">Message</p>
                            <div style="background:#fff;border:1px solid #e8d9be;border-radius:6px;padding:20px;font-size:15px;color:#1C140A;line-height:1.7;">${message.replace(/\n/g, '<br>')}</div>
                        </div>
                        <div style="margin-top:28px;">
                            <a href="mailto:${email}" style="display:inline-block;background:#B46100;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Reply to ${name}</a>
                        </div>
                    </div>
                    <div style="background:#3F4D1B;padding:16px 32px;text-align:center;">
                        <p style="margin:0;color:rgba(253,243,226,0.4);font-size:11px;">Markeb Media Ltd &nbsp;·&nbsp; markebmedia.com</p>
                    </div>
                </div>
            `
        });

        // Auto-reply to the sender
        await resend.emails.send({
            from: 'Markeb Media <noreply@markebmedia.com>',
            to: [email],
            subject: 'Thanks for getting in touch with Markeb Media',
            html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FDF3E2;border:1px solid #e8d9be;border-radius:8px;overflow:hidden;">
                    <div style="background:#3F4D1B;padding:28px 32px;">
                        <p style="margin:0;color:rgba(253,243,226,0.6);font-size:12px;letter-spacing:2px;text-transform:uppercase;">Message Received</p>
                        <h1 style="margin:8px 0 0;color:#FDF3E2;font-size:22px;font-weight:700;">Thanks, ${name.split(' ')[0]}.</h1>
                    </div>
                    <div style="padding:32px;">
                        <p style="font-size:16px;color:#1C140A;line-height:1.7;margin:0 0 16px;">We have received your message and a member of our team will be in touch within 24 hours.</p>
                        <p style="font-size:15px;color:#5C4A2A;line-height:1.7;margin:0 0 28px;">In the meantime, feel free to browse our portfolio at <a href="https://markebmedia.com/portfolio" style="color:#B46100;">markebmedia.com/portfolio</a> or reach us directly at <a href="mailto:commercial@markebmedia.com" style="color:#B46100;">commercial@markebmedia.com</a>.</p>
                        <div style="background:#fff;border-left:3px solid #B46100;padding:16px 20px;font-size:14px;color:#5C4A2A;line-height:1.6;font-style:italic;">
                            Your message: "${message.length > 200 ? message.substring(0, 200) + '...' : message}"
                        </div>
                    </div>
                    <div style="background:#3F4D1B;padding:16px 32px;text-align:center;">
                        <p style="margin:0;color:rgba(253,243,226,0.4);font-size:11px;">Markeb Media Ltd &nbsp;·&nbsp; markebmedia.com</p>
                    </div>
                </div>
            `
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true })
        };

    } catch (error) {
        console.error('Contact form error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to send message.' })
        };
    }
};