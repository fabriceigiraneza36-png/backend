/**
 * Welcome subscriber email — Altuvera Travel branded
 */
const welcomeSubscriberEmail = (email, name = null) => {
  // Use BACKEND_URL for the unsubscribe API link
  const backendUrl     = process.env.BACKEND_URL    || 'http://localhost:3000';
  const frontendUrl    = process.env.FRONTEND_URL   || 'https://www.altuverasafaris.com';
  const unsubscribeUrl = `${backendUrl}/api/subscribers/unsubscribe/${encodeURIComponent(email)}`;
  const exploreUrl     = `${frontendUrl}/destinations`;
  const currentYear    = new Date().getFullYear();
  const greeting       = name ? `Hi ${name.split(' ')[0]}!` : 'Welcome!';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome to Altuvera Travel</title>
</head>
<body style="margin:0;padding:0;background-color:#F0FDF4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F0FDF4;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
               style="max-width:600px;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(22,163,74,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#15803D 0%,#16A34A 50%,#22C55E 100%);padding:48px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:16px;">🌿</div>
              <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">
                Altuvera Travel
              </h1>
              <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">
                True Adventures In High Places &amp; Deep Culture
              </p>
            </td>
          </tr>

          <!-- WELCOME -->
          <tr>
            <td style="padding:48px 40px 32px;text-align:center;">
              <div style="font-size:48px;margin-bottom:16px;">🎉</div>
              <h2 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0F1B0F;">
                ${greeting}
              </h2>
              <p style="margin:0 0 12px;font-size:16px;color:#5A7A5A;line-height:1.7;">
                Thank you for subscribing to the Altuvera Travel newsletter.
              </p>
              <p style="margin:0;font-size:16px;color:#5A7A5A;line-height:1.7;">
                You've joined <strong style="color:#15803D;">thousands of adventurers</strong>
                who receive exclusive travel inspiration, safari tips, and members-only offers every week.
              </p>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#BBF7D0,transparent);"></div>
            </td>
          </tr>

          <!-- BENEFITS -->
          <tr>
            <td style="padding:32px 40px;">
              <h3 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0F1B0F;text-align:center;">
                What's Coming Your Way
              </h3>

              ${[
                ['📸', 'Destination Stories',    'Hand-picked destinations with stunning photography and local insider tips'],
                ['🦁', 'Wildlife & Safari News', 'Migration tracking, conservation stories, and expert photography guides'],
                ['🎁', 'Exclusive Offers',        'Members-only discounts and early access to new travel experiences'],
                ['🗺️', 'Travel Planning Tips',   'Best seasons, packing guides, visa help, and curated itineraries'],
              ].map(([icon, title, desc]) => `
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;font-size:20px;">
                    ${icon}
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">${title}</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">${desc}</p>
                  </td>
                </tr>
              </table>`).join('')}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:8px 40px 40px;text-align:center;">
              <a href="${exploreUrl}" target="_blank"
                 style="display:inline-block;padding:16px 44px;background:linear-gradient(135deg,#15803D,#22C55E);color:#FFFFFF;text-decoration:none;border-radius:50px;font-size:16px;font-weight:700;letter-spacing:0.3px;">
                Explore Destinations →
              </a>
            </td>
          </tr>

          <!-- QUOTE -->
          <tr>
            <td style="background:#F0FDF4;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:16px;font-style:italic;color:#166534;line-height:1.6;">
                "The world is a book, and those who do not travel read only one page."
              </p>
              <p style="margin:0;font-size:13px;color:#5A7A5A;font-weight:600;">— Saint Augustine</p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#14532D;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6;">
                You're receiving this because
                <strong style="color:#86EFAC;">${email}</strong>
                subscribed on our website.
              </p>
              <p style="margin:0 0 16px;font-size:12px;color:rgba(255,255,255,0.4);">
                Expect 1–2 emails per week. We never spam.
              </p>
              <a href="${unsubscribeUrl}"
                 style="display:inline-block;padding:8px 24px;border-radius:20px;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);font-size:12px;text-decoration:none;font-weight:600;">
                Unsubscribe
              </a>
              <p style="margin:20px 0 0;font-size:11px;color:rgba(255,255,255,0.3);">
                © ${currentYear} Altuvera Travel. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
};

module.exports = { welcomeSubscriberEmail };