// WSS certificate verifier bridge for the dialer's force-v4 SIP probe.
//
// The dialer's ICE probe DoH-resolves the Crexendo WSS hostname to an IPv4
// literal and connects to wss://<ip>:9002/ to force the SIP signaling source
// over v4, which routes Crexendo's SBC selection to the reliable Oracle SBC
// (>99%) instead of the Azure SBC (~55% one-way RTP). Chromium's default
// cert verifier rejects that connection because the cert's CN/SAN doesn't
// match the IPv4 host. This bridge accepts the cert for any IP the renderer
// has explicitly registered, as long as the cert is one of Crexendo's
// underlying infrastructure certs (CN matches *.vipvoice.io).
//
// Renderer flow (sveltekit/src/lib/wsEndpoint.ts):
//   1. preload.js exposes wssCertBridgeVersion (capability flag) and
//      registerWssV4({ ip, hostname }) (IPC bridge).
//   2. Renderer DoH-resolves hostname's A record, calls registerWssV4.
//   3. Renderer opens wss://<ip>:9002/.
//   4. TLS handshake fires setCertificateVerifyProc here; we look up <ip>
//      in pendingV4Map and accept if the cert is a *.vipvoice.io cert.
//   5. Entry auto-expires after TTL_MS so stale registrations can't be
//      replayed by a compromised renderer minutes later.

const { session, ipcMain } = require('electron');

const TTL_MS = 60 * 1000;
const ALLOWED_HOSTNAME_PATTERN = /(^|\.)vipvoice\.io$/i;

// Chromium verifier callback codes:
//   0   accept
//  -2   reject
//  -3   defer to default Chromium verifier (use this for any connection
//       we don't recognize so app-wide TLS is unaffected)
const ACCEPT = 0;
const DEFER = -3;

// ip -> { ip, hostname, expiresAt }
const pendingV4Map = new Map();

function purgeExpired() {
    const now = Date.now();
    for (const [ip, entry] of pendingV4Map) {
        if (entry.expiresAt <= now) pendingV4Map.delete(ip);
    }
}

function certMatchesVipvoice(cert) {
    // Electron's Certificate type doesn't expose the SAN extension directly,
    // but `subjectName` carries the cert's CN, and Crexendo's infra certs
    // (core{N}-iad.vipvoice.io) use a CN that matches our allowlist. If
    // Crexendo ever ships a SAN-only cert with no CN, this will fail closed
    // (defer to default) and the probe falls back to hostname WSS — safe.
    const candidates = [];
    if (cert && cert.subjectName) candidates.push(cert.subjectName);
    if (cert && cert.subject && cert.subject.commonName) {
        candidates.push(cert.subject.commonName);
    }
    return candidates.some((name) => ALLOWED_HOSTNAME_PATTERN.test(name));
}

/**
 * Install the WSS cert verifier on Electron's default session and register
 * the IPC handler the renderer uses to declare {ip, hostname} pairs.
 * Idempotent — safe to call multiple times, but intended to run once
 * during app.whenReady() before any BrowserWindow is created.
 */
function installWssCertBridge() {
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
        purgeExpired();
        const entry = pendingV4Map.get(request.hostname);
        if (!entry) {
            // Connection isn't to a registered force-v4 IP. Let Chromium do
            // its normal hostname-vs-cert check. This keeps the bridge from
            // affecting any other TLS traffic in the app (Auth0, Datadog,
            // GitHub release server, etc.).
            return callback(DEFER);
        }
        if (certMatchesVipvoice(request.certificate)) {
            return callback(ACCEPT);
        }
        // Registered IP but unrecognized cert. Don't reject outright — a
        // benign Crexendo cert rotation we haven't seen yet shouldn't kill
        // the probe. Defer to Chromium; it'll likely reject too, which is
        // the right answer when the cert truly doesn't match anything.
        return callback(DEFER);
    });

    ipcMain.handle('register-wss-v4', (_event, entry) => {
        if (!entry || typeof entry.ip !== 'string' || typeof entry.hostname !== 'string') {
            throw new Error('register-wss-v4: invalid payload');
        }
        pendingV4Map.set(entry.ip, {
            ip: entry.ip,
            hostname: entry.hostname,
            expiresAt: Date.now() + TTL_MS,
        });
    });
}

// Version stamp the renderer reads to confirm this bridge is installed before
// attempting a force-v4 connection. Bump when the IPC payload shape or
// verifier semantics change in a renderer-visible way. See
// sveltekit/src/lib/wsEndpoint.ts REQUIRED_BRIDGE_VERSION for the matching
// minimum on the dialer side.
const WSS_CERT_BRIDGE_VERSION = 1;

module.exports = { installWssCertBridge, WSS_CERT_BRIDGE_VERSION };
