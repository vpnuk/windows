'use strict';

// IPv4 destinations only. No domains, executable paths or shell fragments.
function parseCidr(value) {
    const match = String(value).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/);
    if (!match) throw new Error(`Invalid bypass address: ${value}. Use an IPv4 address or subnet.`);
    const parts = match[1].split('.').map(Number);
    const bits = match[2] === undefined ? 32 : Number(match[2]);
    if (parts.some(n => n > 255) || bits > 32) throw new Error(`Invalid bypass address: ${value}`);
    const number = parts.reduce((n, part) => n * 256 + part, 0);
    const size = 2 ** (32 - bits);
    const start = Math.floor(number / size) * size;
    return { start, end: start + size - 1, bits, prefix: `${ip(start)}/${bits}` };
}

function ip(number) {
    return [24, 16, 8, 0].map(shift => Math.floor(number / 2 ** shift) % 256).join('.');
}

function bypassPrefixes(value) {
    if (value === undefined || value === null || value === '') return [];
    const entries = Array.isArray(value) ? value : String(value).split(/[\s,;]+/).filter(Boolean);
    if (entries.length > 128) throw new Error('Use no more than 128 bypass IPs/subnets per profile.');
    return [...new Set(entries.map(entry => parseCidr(entry).prefix))];
}

function intervalCidrs(start, end) {
    const result = [];
    while (start <= end) {
        let bits = 32;
        while (bits > 0 && start % 2 ** (33 - bits) === 0 && start + 2 ** (33 - bits) - 1 <= end) bits--;
        result.push(`${ip(start)}/${bits}`);
        start += 2 ** (32 - bits);
    }
    return result;
}

function subtractBypass(allowed, bypass) {
    const excluded = bypassPrefixes(bypass).map(parseCidr);
    if (!excluded.length) return allowed;
    const result = [];
    for (const entry of String(allowed).split(',').map(s => s.trim()).filter(Boolean)) {
        // /0 activates WireGuard for Windows' restrictive firewall. Equivalent
        // /1 routes preserve IPv6 routing without blocking intentional IPv4 bypass.
        if (entry.includes(':')) {
            result.push(...(entry === '::/0' ? ['::/1', '8000::/1'] : [entry]));
            continue;
        }
        const base = parseCidr(entry);
        let ranges = [[base.start, base.end]];
        for (const cut of excluded) {
            ranges = ranges.flatMap(([start, end]) => {
                if (cut.end < start || cut.start > end) return [[start, end]];
                const pieces = [];
                if (cut.start > start) pieces.push([start, cut.start - 1]);
                if (cut.end < end) pieces.push([cut.end + 1, end]);
                return pieces;
            });
        }
        for (const [start, end] of ranges) result.push(...intervalCidrs(start, end));
    }
    if (!result.length) throw new Error('Bypass rules exclude every WireGuard route. Keep at least one VPN destination.');
    return [...new Set(result)].join(', ');
}

function applyWireGuardBypass(conf, bypass) {
    const prefixes = bypassPrefixes(bypass);
    if (!prefixes.length) return conf;
    let found = false;
    const result = conf.replace(/^AllowedIPs\s*=\s*(.+)$/gm, (_, allowed) => {
        found = true;
        return `AllowedIPs = ${subtractBypass(allowed, prefixes)}`;
    });
    if (!found) throw new Error('WireGuard configuration has no AllowedIPs to apply bypass rules to.');
    return result;
}

module.exports = { bypassPrefixes, parseCidr, subtractBypass, applyWireGuardBypass };
