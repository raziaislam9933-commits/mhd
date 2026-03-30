#!/usr/bin/env node
/**
 * DurbinTV & MHDTV.P Stream Key Extractor
 * Scrapes m3u8/mpd URLs + ClearKey DRM keys from both sites.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.71 Safari/537.36';
const XOR_KEY = 'SecureKey123!';

// ─── HTTP helper ─────────────────────────────────────────────
function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': UA, ...opts.headers };
    const req = mod.get(url, { headers, timeout: 15000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, opts).then(resolve, reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Shaka/XOR decrypt ──────────────────────────────────────
function decryptShaka(encryptedB64) {
  const decoded = Buffer.from(encryptedB64, 'base64').toString('binary');
  let output = '';
  for (let i = 0; i < decoded.length; i++) {
    output += String.fromCharCode(decoded.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length));
  }
  const mpd  = output.match(/mpdUrl\s*=\s*['"]([^'"]+)['"]/);
  const kid  = output.match(/kid\s*=\s*['"]([^'"]+)['"]/);
  const key  = output.match(/key\s*=\s*['"]([^'"]+)['"]/);
  const m3u8 = output.match(/file\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/);
  return {
    mpd:  mpd?.[1]  || null,
    m3u8: m3u8?.[1] || null,
    kid:  kid?.[1]  || null,
    key:  key?.[1]  || null,
  };
}

// ─── JWPlayer M3U8 fallback ─────────────────────────────────
function extractJwplayer(html) {
  const m = html.match(/file\s*[:=]\s*['"]([^'"]+\.m3u8[^'"]*)['"]/);
  return m ? { m3u8: m[1] } : null;
}

// ─── Process a single channel ────────────────────────────────
async function processChannel(name, site, watchUrl) {
  try {
    const html = await fetch(watchUrl);

    // Find bsports iframe URLs
    const iframeUrls = [...new Set(
      [...html.matchAll(/https?:\/\/bsports\.moviesflixter\.com\/[^\s"']+/g)].map(m => m[0])
    )];

    const isLogin = html.includes('Login') && html.includes('subscribe');

    if (iframeUrls.length === 0) {
      return { name, site, status: isLogin ? 'login_required' : 'no_player', url: watchUrl };
    }

    for (const iframeUrl of iframeUrls) {
      const iframeHtml = await fetch(iframeUrl, { headers: { Referer: watchUrl } });

      // 1) Shaka encrypted blob
      const encMatch = iframeHtml.match(/let encrypted\s*=\s*"([^"]+)"/);
      if (encMatch) {
        const info = decryptShaka(encMatch[1]);
        if (info.mpd || info.m3u8) {
          return { name, site, url: watchUrl, ...info };
        }
      }

      // 2) JWPlayer fallback
      const jw = extractJwplayer(iframeHtml);
      if (jw?.m3u8) {
        return { name, site, url: watchUrl, m3u8: jw.m3u8, kid: null, key: null, mpd: null };
      }

      // 3) Direct URL in iframe
      const directM3u8 = iframeHtml.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
      const directMpd  = iframeHtml.match(/https?:\/\/[^\s"']+\.mpd[^\s"']*/);
      if (directM3u8) return { name, site, url: watchUrl, m3u8: directM3u8[0], kid: null, key: null, mpd: null };
      if (directMpd)  return { name, site, url: watchUrl, mpd: directMpd[0], kid: null, key: null, m3u8: null };
    }

    return { name, site, status: 'decrypt_failed', url: watchUrl };
  } catch (e) {
    return { name, site, status: 'error', error: e.message, url: watchUrl };
  }
}

// ─── Channel definitions ─────────────────────────────────────
const CHANNELS = [
  // ── durbintv.com ──
  { name: 'Live 1',                site: 'durbintv', url: 'https://durbintv.com/livetv/watch/live-1/84' },
  { name: 'Live 2',                site: 'durbintv', url: 'https://durbintv.com/livetv/watch/live-2/85' },
  { name: 'Live 3',                site: 'durbintv', url: 'https://durbintv.com/livetv/watch/live-3/86' },
  { name: 'Live 4',                site: 'durbintv', url: 'https://durbintv.com/livetv/watch/live-4/87' },
  { name: 'PSL Match (79)',        site: 'durbintv', url: 'https://durbintv.com/livetv/watch/today-psl-match/79' },
  { name: 'PSL Match (83)',        site: 'durbintv', url: 'https://durbintv.com/livetv/watch/today-psl-match/83' },
  { name: 'IPL 2026 (80)',         site: 'durbintv', url: 'https://durbintv.com/livetv/watch/ipl-2026/80' },
  { name: 'IPL 2026 (81)',         site: 'durbintv', url: 'https://durbintv.com/livetv/watch/ipl-2026/81' },
  { name: 'Watch India',           site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-india/77' },
  { name: 'Watch India 2',         site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-india-2/76' },
  { name: 'Watch India 3',         site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-india-3/75' },
  { name: 'Watch India 4',         site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-india-4/74' },
  { name: 'Germany',               site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-germany/73' },
  { name: 'Germany 2',             site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-germany-2/72' },
  { name: 'Portugal',              site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-portugal/71' },
  { name: 'Portugal 2',            site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-portugal-2/70' },
  { name: 'LaLiga',                site: 'durbintv', url: 'https://durbintv.com/livetv/watch/live-laliga/42' },
  { name: 'Serie A (69)',          site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-serie-a/69' },
  { name: 'Serie A (68)',          site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-serie-a/68' },
  { name: 'Bundesliga',            site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-bundesliga/67' },
  { name: 'Bundesliga 2',          site: 'durbintv', url: 'https://durbintv.com/livetv/watch/watch-live-bundesliga-2/66' },
  { name: 'TSN 1',                 site: 'durbintv', url: 'https://durbintv.com/sports/watch/watch-live-tsn-1/39' },
  { name: 'TSN 2',                 site: 'durbintv', url: 'https://durbintv.com/sports/watch/tsn-2/43' },
  { name: 'TSN 3',                 site: 'durbintv', url: 'https://durbintv.com/sports/watch/watch-live-tsn-3/40' },
  { name: 'TSN 4',                 site: 'durbintv', url: 'https://durbintv.com/sports/watch/watch-live-tsn-4/41' },
  { name: 'TSN 5',                 site: 'durbintv', url: 'https://durbintv.com/sports/watch/watch-live-tsn-5/42' },

  // ── mhdtvp.com ──
  { name: 'PSL (48)',              site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/watch-live-psl/48' },
  { name: 'PSL (49)',              site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/watch-live-psl/49' },
  { name: 'Live 1 (57)',           site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/live-1/57' },
  { name: 'Live 1 (58)',           site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/live-1/58' },
  { name: 'LaLiga 1',              site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/laliga-1/31' },
  { name: 'Serie A',               site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/serie-a/53' },
  { name: 'Serie A 2',             site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/serie-a-2/54' },
  { name: 'Bundesliga',            site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/bundesliga/55' },
  { name: 'Bundesliga 2',          site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/bundesliga-2/56' },
  { name: 'TNT Sports 1',          site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tnt-sports-1-live-free/27' },
  { name: 'TNT Sports 2',          site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tnt-sports-2-live-free/28' },
  { name: 'TNT Sports 3',          site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tnt-sports-3-live-free/29' },
  { name: 'TNT Sports 4',          site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tnt-sports-4-live-free/30' },
  { name: 'TSN 1',                 site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tsn-1/33' },
  { name: 'TSN 2',                 site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tsn-2/34' },
  { name: 'TSN 3',                 site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tsn-3/35' },
  { name: 'TSN 4',                 site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tsn-4/36' },
  { name: 'TSN 5',                 site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/tsn-5/37' },
  { name: 'Nagorik TV',            site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/nagorik-tv/51' },
  { name: 'T Sports (50)',         site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/t-sports/50' },
  { name: 'T Sports (52)',         site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/t-sports/52' },
  { name: 'BeIN SPORTS 1',         site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/bein-sports-1/38' },
  { name: 'BeIN SPORTS 2',         site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/bein-sports-2/39' },
  { name: 'BeIN SPORTS 3',         site: 'mhdtvp', url: 'https://mhdtvp.com/livetv/watch/bein-sports-3/40' },
  { name: 'Fancode 1',             site: 'mhdtvp', url: 'https://mhdtvp.com/sports/watch/fancode-1/22' },
  { name: 'Fancode 2',             site: 'mhdtvp', url: 'https://mhdtvp.com/sports/watch/fancode-2/23' },
];

// ─── Main ────────────────────────────────────────────────────
async function main() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting stream key extraction...`);

  const results = [];
  for (const ch of CHANNELS) {
    const result = await processChannel(ch.name, ch.site, ch.url);
    results.push(result);
    const icon = (result.mpd || result.m3u8) ? '✓' : '✗';
    const stream = result.mpd || result.m3u8 || result.status;
    console.log(`${icon} [${ch.site}] ${ch.name}: ${stream}`);
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Build output ──
  const successful = results.filter(r => r.mpd || r.m3u8);
  const failed     = results.filter(r => !r.mpd && !r.m3u8);

  const output = {
    generated: timestamp,
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    streams: successful,
    errors: failed,
  };

  // ── Write JSON ──
  const outDir = path.resolve(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'streams.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${jsonPath}`);

  // ── Write M3U playlist (Kodi/NS Player compatible) ──
  const m3uLines = ['#EXTM3U', ''];
  for (const s of successful) {
    const url = s.m3u8 || s.mpd;
    if (!url) continue;
    const tvgName = s.name.replace(/[^a-zA-Z0-9 ]/g, '');
    m3uLines.push(`#EXTINF:-1 tvg-name="${tvgName}" group-title="${s.site}",${s.name}`);

    if (s.mpd && s.kid && s.key) {
      // ClearKey DASH — Kodi/NS Player format
      m3uLines.push(`#KODIPROP:inputstream.adaptive.manifest_type=dash`);
      m3uLines.push(`#KODIPROP:inputstream.adaptive.license_type=urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`);
      m3uLines.push(`#KODIPROP:inputstream.adaptive.license_key={"keys":[{"kid":"${s.kid}","key":"${s.key}"}]}`);
    } else if (s.mpd) {
      // MPD without keys (unencrypted)
      m3uLines.push(`#KODIPROP:inputstream.adaptive.manifest_type=dash`);
    }

    m3uLines.push(url);
    m3uLines.push('');
  }
  const m3uPath = path.join(outDir, 'playlist.m3u');
  fs.writeFileSync(m3uPath, m3uLines.join('\n'));
  console.log(`Wrote ${m3uPath}`);

  // ── Write simple M3U (just key_id:key per line, no DRM headers) ──
  const simpleLines = ['#EXTM3U x-tvg-url=""', ''];
  for (const s of successful) {
    const url = s.m3u8 || s.mpd;
    if (!url) continue;
    const tvgName = s.name.replace(/[^a-zA-Z0-9 ]/g, '');
    simpleLines.push(`#EXTINF:-1 tvg-name="${tvgName}" group-title="${s.site}",${s.name}`);
    if (s.kid && s.key) {
      simpleLines.push(`#EXTVLCOPT:http-user-agent=Mozilla/5.0`);
      simpleLines.push(`#EXTGRP:${s.site}`);
    }
    simpleLines.push(url);
    simpleLines.push('');
  }
  const simplePath = path.join(outDir, 'playlist-simple.m3u');
  fs.writeFileSync(simplePath, simpleLines.join('\n'));
  console.log(`Wrote ${simplePath}`);

  // ── Write keys-only reference (KID:KEY pairs) ──
  const keysLines = ['# Stream Keys Reference', `# Generated: ${timestamp}`, '# Format: Channel | KID | KEY', ''];
  for (const s of successful) {
    if (s.kid && s.key) {
      keysLines.push(`${s.name} | ${s.kid} | ${s.key}`);
    }
  }
  const keysPath = path.join(outDir, 'keys.txt');
  fs.writeFileSync(keysPath, keysLines.join('\n'));
  console.log(`Wrote ${keysPath}`);

  // ── Write Markdown report ──
  const mdLines = [
    `# Stream Keys Report — ${timestamp}`,
    '',
    `> Auto-generated by GitHub Actions. ${successful.length}/${results.length} channels extracted.`,
    '',
  ];

  // Group by site
  const bySite = {};
  for (const s of successful) {
    (bySite[s.site] ??= []).push(s);
  }
  for (const [site, streams] of Object.entries(bySite)) {
    mdLines.push(`## ${site}.com`, '');
    mdLines.push('| Channel | Type | MPD / M3U8 | KID | KEY |');
    mdLines.push('|---------|------|------------|-----|-----|');
    for (const s of streams) {
      const type = s.mpd ? 'DASH' : 'HLS';
      const url = (s.mpd || s.m3u8 || '').replace(/\|/g, '\\|');
      const kid = s.kid || '—';
      const key = s.key || '—';
      mdLines.push(`| ${s.name} | ${type} | \`${url}\` | \`${kid}\` | \`${key}\` |`);
    }
    mdLines.push('');
  }

  if (failed.length) {
    mdLines.push('## Failed / Login-Required', '');
    for (const f of failed) {
      mdLines.push(`- **[${f.site}]** ${f.name} — ${f.status}`);
    }
    mdLines.push('');
  }

  const mdPath = path.join(outDir, 'REPORT.md');
  fs.writeFileSync(mdPath, mdLines.join('\n'));
  console.log(`Wrote ${mdPath}`);

  // ── Summary ──
  console.log(`\n✓ ${successful.length} streams extracted, ✗ ${failed.length} failed.`);
  if (failed.length) {
    console.log('\nFailed channels:');
    for (const f of failed) console.log(`  - [${f.site}] ${f.name}: ${f.status}`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
