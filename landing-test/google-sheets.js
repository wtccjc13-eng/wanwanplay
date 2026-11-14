const { JWT } = require('google-auth-library');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const userError = message => Object.assign(new Error(message), { publicMessage: message });

module.exports = function googleSheets({ authFactory = options => new JWT(options), fetchImpl = fetch } = {}) {
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const credentialsReady = /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email) && !!key.trim();
  let client;
  return {
    email, credentialsReady,
    async read(config) {
      if (!credentialsReady) throw userError('Configure the Google service account in Hostinger, then share this sheet with it as Viewer.');
      try {
        if (!client) client = authFactory({ email, key, scopes: SCOPES,
          transporterOptions: { timeout: 15000, retryConfig: { retry: 1 } } });
        const auth = await client.getAccessToken();
        if (!auth.token) throw new Error('Authentication failed');
        const range = "'" + config.tabName.replace(/'/g, "''") + "'!A:H";
        const url = new URL('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(config.spreadsheetId) + '/values/' + encodeURIComponent(range));
        url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
        url.searchParams.set('dateTimeRenderOption', 'FORMATTED_STRING');
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), redirect: 'error',
          headers: { Authorization: 'Bearer ' + auth.token } });
        if (!response.ok) throw new Error('Google request failed');
        let size = 0;
        const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 2000000) throw new Error('Sheet too large');
          chunks.push(Buffer.from(chunk));
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(data.values)) throw new Error('No rows');
        return data.values;
      } catch {
        // Upstream errors can contain request headers or credentials: never expose/log them.
        client = undefined;
        throw userError('Unable to read the private sheet. Check the sheet link, tab name, Viewer sharing, Google Sheets API and service-account credentials. Active codes are unchanged.');
      }
    },
  };
};
