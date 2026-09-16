// ga4.js
// Henter Google Analytics 4 (GA4) data om organiske landingssider.
// Bruges som ekstra signal ved siden af Search Console: sider/emner der
// allerede performer godt for rigtige besogende, giver et scoringsboost
// til lignende sogeord, saa auto.js prioriterer "lavt haengende frugt"
// der ogsaa passer til det der rent faktisk virker paa sitet.
//
// Kraever:
//  - Samme service-account som Search Console (GOOGLE_CREDENTIALS)
//    skal tilfojes som "Viewer" i GA4-ejendommen (Admin -> Adgangsstyring)
//  - GOOGLE_ANALYTICS_PROPERTY_ID i .env (kun tal, fx 123456789 - IKKE "properties/123456789")
//
// Er GOOGLE_ANALYTICS_PROPERTY_ID ikke sat, springes GA4 helt over,
// og auto.js falder tilbage til ren Search Console-scoring som foer.

import { google } from 'googleapis';

export async function hentGA4LandingSider({ credentialsPath, propertyId, dage = 90, minSessions = 5 }) {
  if (!propertyId) return [];
  if (!credentialsPath) throw new Error('GOOGLE_CREDENTIALS mangler (paakraevet for GA4 med)');

  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });

  const res = await analyticsdata.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: `${dage}daysAgo`, endDate: 'today' }],
      dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [
        { name: 'sessions' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionDefaultChannelGroup',
          stringFilter: { value: 'Organic Search' },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 250,
    },
  });

  const rows = res.data.rows || [];
  return rows
    .map((r) => ({
      landingPage: r.dimensionValues[0].value,
      sessions: Number(r.metricValues[0].value),
      engagementRate: Number(r.metricValues[1].value),
      avgSessionDuration: Number(r.metricValues[2].value),
    }))
    .filter((r) => r.sessions >= minSessions);
}

// Traekker "emne-ord" ud af en URL-slug, saa de kan sammenlignes med sogeord.
// Fx "/escort-koebenhavn-massage" -> ["escort", "koebenhavn", "massage"]
export function udtraekOrdFraUrl(url) {
  try {
    const path = new URL(url, 'https://example.dk').pathname;
    return path
      .toLowerCase()
      .replace(/\.\w+$/, '')
      .split(/[\/\-_?=&]+/)
      .filter((w) => w.length > 2 && !['dk', 'se', 'www', 'html', 'aspx', 'index', 'default'].includes(w));
  } catch {
    return [];
  }
}
