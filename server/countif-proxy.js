/**
 * CountIf.net Authentication Proxy Server
 * 
 * This lightweight Express server acts as a secure intermediary between
 * the Topview Logger client app and the CountIf.net ASP.NET backend.
 * It handles the full ASP.NET WebForms login dance:
 *   1. GET the login page to harvest __VIEWSTATE and hidden fields
 *   2. POST credentials with the harvested hidden fields
 *   3. Return the authentication result and session cookies
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ============================================================
// COUNTIF.NET LOGIN ENDPOINT
// ============================================================

app.post('/api/countif/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ 
      success: false, 
      stage: 'validation',
      message: 'Username and password are required.' 
    });
  }

  const LOGIN_URL = 'https://www.countif.net/Account/Login.aspx';
  const stages = [];

  try {
    // ── Stage 1: Fetch login page to harvest ASP.NET hidden fields ──
    stages.push({ stage: 'init', message: 'Initiating secure connection...', timestamp: Date.now() });

    const pageRes = await fetch(LOGIN_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'TopviewLogger/10.0',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!pageRes.ok) {
      throw new Error(`Login page returned HTTP ${pageRes.status}`);
    }

    const pageHtml = await pageRes.text();
    stages.push({ stage: 'page_loaded', message: 'Login page loaded. Harvesting tokens...', timestamp: Date.now() });

    // Extract cookies from the initial GET
    const initialCookies = pageRes.headers.getSetCookie ? pageRes.headers.getSetCookie() : [];
    const cookieString = initialCookies.map(c => c.split(';')[0]).join('; ');

    // ── Stage 2: Parse hidden fields ──
    const viewstate = extractHiddenField(pageHtml, '__VIEWSTATE');
    const eventTarget = extractHiddenField(pageHtml, '__EVENTTARGET') || '';
    const eventArgument = extractHiddenField(pageHtml, '__EVENTARGUMENT') || '';
    const viewstateGen = extractHiddenField(pageHtml, '__VIEWSTATEGENERATOR') || '';
    const eventValidation = extractHiddenField(pageHtml, '__EVENTVALIDATION') || '';

    if (!viewstate) {
      throw new Error('Failed to harvest __VIEWSTATE token from login page.');
    }

    stages.push({ stage: 'tokens_harvested', message: 'Security tokens acquired. Authenticating...', timestamp: Date.now() });

    // ── Stage 3: Submit login form ──
    const formParams = new URLSearchParams();
    formParams.append('__EVENTTARGET', eventTarget);
    formParams.append('__EVENTARGUMENT', eventArgument);
    formParams.append('__VIEWSTATE', viewstate);
    if (viewstateGen) formParams.append('__VIEWSTATEGENERATOR', viewstateGen);
    if (eventValidation) formParams.append('__EVENTVALIDATION', eventValidation);
    formParams.append('ctl00$MainContent$LoginUser$UserName', username);
    formParams.append('ctl00$MainContent$LoginUser$Password', password);
    formParams.append('ctl00$MainContent$LoginUser$LoginButton', 'Log In');

    const loginRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TopviewLogger/10.0',
        'Cookie': cookieString,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': LOGIN_URL
      },
      body: formParams.toString(),
      redirect: 'manual'  // Don't auto-follow redirects so we can inspect them
    });

    // ── Stage 4: Evaluate result ──
    const statusCode = loginRes.status;
    const locationHeader = loginRes.headers.get('location') || '';
    const authCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
    
    // ASP.NET typically returns 302 redirect on successful login
    const hasAuthCookie = authCookies.some(c => 
      c.includes('.ASPXAUTH') || c.includes('.AspNet') || c.includes('ASPXFORMSAUTH')
    );
    const isRedirectToHome = (statusCode === 302 || statusCode === 301) && 
      !locationHeader.toLowerCase().includes('login');

    if (isRedirectToHome || hasAuthCookie) {
      stages.push({ stage: 'authenticated', message: 'Authentication successful!', timestamp: Date.now() });

      // Combine and return all cookies for persistence
      const sessionCookies = authCookies.map(c => c.split(';')[0]).join('; ');

      return res.json({
        success: true,
        stages,
        result: {
          status: statusCode,
          redirectTo: locationHeader,
          sessionCookie: sessionCookies,
          message: 'Successfully authenticated to CountIf.net'
        }
      });
    } else {
      // Login failed — check the response body for error messages
      const bodyText = await loginRes.text();
      const errorMatch = bodyText.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)/i) ||
                         bodyText.match(/validation-summary[^>]*>.*?<li>([^<]+)/is);
      const errorMsg = errorMatch ? errorMatch[1].trim() : 'Invalid username or password.';
      
      stages.push({ stage: 'auth_failed', message: errorMsg, timestamp: Date.now() });

      return res.json({
        success: false,
        stages,
        result: {
          status: statusCode,
          message: errorMsg
        }
      });
    }

  } catch (err) {
    stages.push({ stage: 'error', message: err.message, timestamp: Date.now() });
    return res.status(500).json({
      success: false,
      stages,
      result: {
        message: err.message
      }
    });
  }
});

// ============================================================
// COUNTIF.NET DISPATCH DATA SCRAPER
// ============================================================

import * as cheerio from 'cheerio';

app.get('/api/countif/dispatch', async (req, res) => {
  const sessionCookie = req.query.cookie;

  if (!sessionCookie) {
    return res.status(401).json({ success: false, message: 'No session cookie provided.' });
  }

  const REPORT_URL = 'https://www.countif.net/Administration/Reports/DispatchReport.aspx';

  try {
    // 1. Initial GET to fetch the form and ViewState tokens
    const reportRes = await fetch(REPORT_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'TopviewLogger/11.3',
        'Cookie': sessionCookie,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': REPORT_URL
      }
    });

    if (!reportRes.ok) {
        if (reportRes.status === 302 || reportRes.status === 301) {
            return res.status(401).json({ success: false, message: 'Session expired.' });
        }
        throw new Error(`Report page returned HTTP ${reportRes.status}`);
    }

    const html = await reportRes.text();
    if (html.includes('LoginUser') || html.includes('Log In')) {
        return res.status(401).json({ success: false, message: 'Session expired or invalid.' });
    }

    // 2. Extract form parameters securely using Cheerio
    const $ = cheerio.load(html);
    const params = new URLSearchParams();
    
    $('input, select, textarea').each((i, el) => {
        const name = $(el).attr('name');
        const value = $(el).val() || '';
        const type = $(el).attr('type');
        
        if (name && type !== 'submit' && type !== 'button') {
            if (name === 'ctl00$MainContent$ddlPageSize') {
                params.append(name, ''); // 'All' value
                return;
            }
            if ($(el).is('select') && $(el).attr('multiple')) {
                 if (name === 'ctl00$MainContent$lstDispatchTypes') {
                     ['1','101','2','3','4','104','7','8','9'].forEach(t => params.append(name, t));
                 } else {
                     $(el).find('option[selected]').each((j, opt) => params.append(name, $(opt).attr('value')));
                 }
                 return;
            }
            if ($(el).is('select') && !$(el).attr('multiple')) {
                const selectedVal = $(el).find('option[selected]').attr('value') || $(el).find('option').first().attr('value') || '';
                params.append(name, selectedVal);
                return;
            }
            params.append(name, value);
        }
    });
    
    // Force 'All' records (overrides any default 100 selection)
    params.set('ctl00$MainContent$ddlPageSize', ''); 
    
    params.append('ctl00$MainContent$btnSearch', 'Search');
    params.delete('__EVENTTARGET');
    params.delete('__EVENTARGUMENT');
    params.append('__EVENTTARGET', '');
    params.append('__EVENTARGUMENT', '');

    // 3. POST the constructed form to trigger the GridView generation
    const postRes = await fetch(REPORT_URL, {
      method: 'POST',
      headers: {
        'Cookie': sessionCookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TopviewLogger/11.3'
      },
      body: params.toString()
    });
    
    const postHtml = await postRes.text();
    const $post = cheerio.load(postHtml);
    
    const rows = [];
    $post('#MainContent_gvResults tr').each((i, row) => {
        if (i === 0) return; // Skip Header
        
        const cells = $post(row).find('td, th');
        if (cells.length >= 6) {
            rows.push({
                date: $post(cells[0]).text().trim(),
                user: $post(cells[1]).text().trim(),
                bus: $post(cells[2]).text().trim(),
                operator: $post(cells[3]).text().trim(),
                route: $post(cells[4]).text().trim(),
                stop: $post(cells[5]).text().trim()
            });
        }
    });

    return res.json({
        success: true,
        count: rows.length,
        data: rows
    });

  } catch (err) {
    console.error('[DispatchScraper] Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// SAMSARA SECURE TUNNEL (For Native IPA)
// ============================================================

app.get('/api/samsara/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const apiKey = req.query.key;

  if (!targetUrl || !apiKey) {
    return res.status(400).json({ success: false, message: 'URL and Key are required.' });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for cold starts

    const samsaraRes = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'TopviewLogger/10.0'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const contentType = samsaraRes.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await samsaraRes.json();
      return res.status(samsaraRes.status).json(data);
    } else {
      // If Samsara returns HTML (like a maintenance page), pass the text through
      const textData = await samsaraRes.text();
      console.warn('[SamsaraTunnel] Non-JSON response received from Samsara.');
      return res.status(samsaraRes.status).send(textData);
    }
  } catch (err) {
    console.error('[SamsaraTunnel] Proxy Crash:', err);
    return res.status(502).json({ success: false, message: 'Tunnel failed to reach Samsara: ' + err.message });
  }
});

// ── Health Check ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', service: 'countif-proxy', version: '10.0.0' });
});

// ── Utility: Extract hidden field value from HTML ──
function extractHiddenField(html, fieldName) {
  // Match both single and double quoted value attributes
  const regex = new RegExp(`name="${fieldName}"[^>]*value="([^"]*)"`, 'i');
  const match = html.match(regex);
  if (match) return match[1];
  
  // Try alternate order (value before name)
  const regex2 = new RegExp(`value="([^"]*)"[^>]*name="${fieldName}"`, 'i');
  const match2 = html.match(regex2);
  return match2 ? match2[1] : null;
}

app.listen(PORT, () => {
  console.log(`[CountIf Proxy] Online at http://localhost:${PORT}`);
  console.log(`[CountIf Proxy] POST /api/countif/login`);
  console.log(`[CountIf Proxy] GET  /api/health`);
});
