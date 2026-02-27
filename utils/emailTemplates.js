/**
 * Beautiful green/white themed welcome email for new subscribers
 */
const welcomeSubscriberEmail = (email) => {
  const siteUrl = process.env.SITE_URL || "http://localhost:3000";
  const unsubscribeUrl = `${siteUrl}/api/subscribers/unsubscribe/${encodeURIComponent(email)}`;
  const exploreUrl = `${siteUrl}/explore`;
  const currentYear = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Welcome to East Africa Explorer</title>
  <!--[if mso]>
  <style type="text/css">
    table, td { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#F0FDF4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#F0FDF4;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Main card -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(22,163,74,0.08);">

          <!-- ═══════════ TOP GREEN BANNER ═══════════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#15803D 0%,#16A34A 50%,#22C55E 100%);padding:48px 40px;text-align:center;">
              <!-- Decorative circles -->
              <div style="font-size:48px;margin-bottom:16px;">🌿</div>
              <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;line-height:1.2;">
                East Africa Explorer
              </h1>
              <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.8);letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">
                Premium Safari & Adventures
              </p>
            </td>
          </tr>

          <!-- ═══════════ WELCOME SECTION ═══════════ -->
          <tr>
            <td style="padding:48px 40px 32px;text-align:center;">
              <!-- Celebration icon -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="width:72px;height:72px;border-radius:50%;background-color:#F0FDF4;border:2px solid #BBF7D0;text-align:center;vertical-align:middle;">
                    <span style="font-size:32px;line-height:72px;">🎉</span>
                  </td>
                </tr>
              </table>

              <h2 style="margin:0 0 12px;font-size:26px;font-weight:700;color:#0F1B0F;line-height:1.3;">
                Welcome to the Family!
              </h2>
              <p style="margin:0 0 8px;font-size:16px;color:#5A7A5A;line-height:1.7;">
                Thank you so much for subscribing to our newsletter.
              </p>
              <p style="margin:0;font-size:16px;color:#5A7A5A;line-height:1.7;">
                You've joined <strong style="color:#15803D;">25,000+ adventurers</strong> who receive exclusive travel inspiration, insider tips, and members-only offers.
              </p>
            </td>
          </tr>

          <!-- ═══════════ DIVIDER ═══════════ -->
          <tr>
            <td style="padding:0 40px;">
              <div style="height:1px;background:linear-gradient(90deg,transparent,#BBF7D0,transparent);"></div>
            </td>
          </tr>

          <!-- ═══════════ WHAT YOU'LL RECEIVE ═══════════ -->
          <tr>
            <td style="padding:32px 40px;">
              <h3 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0F1B0F;text-align:center;">
                What You'll Receive
              </h3>

              <!-- Benefit 1 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">📸</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Destination Stories</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Hand-picked destinations with stunning photography and insider knowledge</p>
                  </td>
                </tr>
              </table>

              <!-- Benefit 2 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">🎁</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Exclusive Offers</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Members-only discounts and early access to new experiences</p>
                  </td>
                </tr>
              </table>

              <!-- Benefit 3 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">🦁</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Wildlife Updates</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Migration tracking, conservation news, and wildlife photography tips</p>
                  </td>
                </tr>
              </table>

              <!-- Benefit 4 -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="width:44px;height:44px;border-radius:12px;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;vertical-align:middle;">
                    <span style="font-size:20px;line-height:44px;">🗺️</span>
                  </td>
                  <td style="padding-left:16px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#166534;">Travel Planning Tips</p>
                    <p style="margin:0;font-size:13px;color:#5A7A5A;line-height:1.5;">Expert advice on best seasons, packing guides, and itinerary ideas</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ CTA BUTTON ═══════════ -->
          <tr>
            <td style="padding:16px 40px 40px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:50px;background:linear-gradient(135deg,#15803D,#22C55E);padding:0;">
                    <a href="${exploreUrl}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.3px;">
                      Start Exploring →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ QUOTE SECTION ═══════════ -->
          <tr>
            <td style="background-color:#F0FDF4;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:16px;font-style:italic;color:#166534;line-height:1.6;">
                "The world is a book, and those who do not travel read only one page."
              </p>
              <p style="margin:0;font-size:13px;color:#5A7A5A;font-weight:600;">
                — Saint Augustine
              </p>
            </td>
          </tr>

          <!-- ═══════════ SOCIAL LINKS ═══════════ -->
          <tr>
            <td style="padding:32px 40px;text-align:center;">
              <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#3F5C3F;text-transform:uppercase;letter-spacing:1.5px;">
                Follow Our Journey
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">📘</a>
                  </td>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">📷</a>
                  </td>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">🐦</a>
                  </td>
                  <td style="padding:0 8px;">
                    <a href="#" style="display:inline-block;width:40px;height:40px;border-radius:50%;background-color:#F0FDF4;border:1px solid #DCFCE7;text-align:center;line-height:40px;text-decoration:none;font-size:18px;">▶️</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════════ FOOTER ═══════════ -->
          <tr>
            <td style="background-color:#14532D;padding:32px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.6;">
                You're receiving this because <strong style="color:#86EFAC;">${email}</strong> subscribed to our newsletter.
              </p>
              <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;">
                We respect your inbox. Expect 1-2 emails per week, maximum.
              </p>
              <a href="${unsubscribeUrl}" style="display:inline-block;padding:8px 24px;border-radius:20px;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);font-size:12px;text-decoration:none;font-weight:600;">
                Unsubscribe
              </a>
              <p style="margin:20px 0 0;font-size:11px;color:rgba(255,255,255,0.3);">
                © ${currentYear} East Africa Explorer. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
        <!-- End main card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
};

module.exports = { welcomeSubscriberEmail };