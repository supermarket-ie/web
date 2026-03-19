import { NextRequest, NextResponse } from 'next/server';
import { resend } from '@/lib/resend';

export async function POST(request: NextRequest) {
  try {
    const { name, email, subject, message } = await request.json();

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Name, email and message are required' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    await resend.emails.send({
      from: 'supermarket.ie <hello@supermarket.ie>',
      to: 'team@supermarket.ie',
      replyTo: email,
      subject: `Contact: ${subject || 'Message from ' + name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1D2324; margin-bottom: 4px;">New message from supermarket.ie</h2>
          <p style="color: #636E72; margin-top: 0; margin-bottom: 24px; font-size: 14px;">Via the contact form</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <tr>
              <td style="padding: 8px 0; color: #636E72; font-size: 14px; width: 80px;">Name</td>
              <td style="padding: 8px 0; color: #1D2324; font-weight: 600; font-size: 14px;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #636E72; font-size: 14px;">Email</td>
              <td style="padding: 8px 0; color: #1D2324; font-size: 14px;"><a href="mailto:${email}" style="color: #E17055;">${email}</a></td>
            </tr>
            ${subject ? `<tr>
              <td style="padding: 8px 0; color: #636E72; font-size: 14px;">Subject</td>
              <td style="padding: 8px 0; color: #1D2324; font-size: 14px;">${subject}</td>
            </tr>` : ''}
          </table>

          <div style="background: #F5F0EB; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
            <p style="color: #636E72; font-size: 12px; margin: 0 0 8px 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Message</p>
            <p style="color: #1D2324; font-size: 15px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${message}</p>
          </div>

          <p style="color: #B2BEC3; font-size: 12px;">Hit reply to respond directly to ${name}.</p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
