import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

export const sendWelcomeEmail = async (userEmail, userName) => {
    try {
        await transporter.sendMail({
            from: `"MALAK AI Mentor" <${process.env.EMAIL_USER}>`,
            replyTo: 'no-reply@malak.ai',   // prevents replies landing in our inbox
            to: userEmail,
            subject: `Welcome aboard, ${userName}! Your journey starts now 🚀`,
            html: `
                <div style="font-family:'Segoe UI',sans-serif;background:#050510;color:#fff;padding:48px;max-width:600px;margin:auto;border-radius:20px;border:1px solid rgba(0,243,255,0.15);">
                    <div style="text-align:center;margin-bottom:36px;">
                        <h1 style="color:#00f3ff;font-weight:300;letter-spacing:6px;margin:0;font-size:2rem;">MALAK</h1>
                        <p style="color:#555;margin:6px 0 0;letter-spacing:3px;font-size:0.75rem;text-transform:uppercase;">AI Mentor System</p>
                    </div>
                    <h2 style="font-weight:400;font-size:1.4rem;color:#fff;">Welcome, <strong style="color:#00f3ff;">${userName}</strong>.</h2>
                    <p style="color:#aaa;line-height:1.8;">Your account is ready. Tell me what you want to learn and I'll build your personalized path. Every morning at 8 AM, I'll send you a daily boost.</p>
                    <div style="background:rgba(0,243,255,0.05);border:1px solid rgba(0,243,255,0.2);border-radius:12px;padding:24px;margin:28px 0;">
                        <p style="margin:0;color:#ccc;font-size:0.95rem;line-height:1.7;">
                            <strong style="color:#00f3ff;">What happens next?</strong><br>
                            Log in → tell MALAK your goal → get your personalized learning path.
                        </p>
                    </div>
                    <div style="text-align:center;margin-top:32px;">
                        <a href="http://localhost:3005/auth.html" style="background:#00f3ff;color:#050510;padding:14px 36px;border-radius:50px;text-decoration:none;font-weight:700;letter-spacing:1px;font-size:0.9rem;display:inline-block;">
                            START YOUR FIRST SESSION →
                        </a>
                    </div>
                    <p style="margin-top:40px;color:#333;font-size:0.75rem;text-align:center;">This is an automated message — please do not reply to this email.</p>
                    <p style="margin-top:8px;color:#333;font-size:0.75rem;text-align:center;">— MALAK, engineered by Malak M. Salem</p>
                </div>
            `
        });
        console.log(`Welcome email sent to ${userEmail}`);
    } catch (error) {
        console.error('Welcome email failed:', error.message);
    }
};