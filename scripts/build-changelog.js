'use strict';
const fs = require('fs');
const path = require('path');
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(markdown) {
    const body = [];
    let list = false;
    for (const line of markdown.split(/\r?\n/)) {
        if (!line.startsWith('- ') && list) { body.push('</ul>'); list = false; }
        if (line.startsWith('- ')) {
            if (!list) { body.push('<ul>'); list = true; }
            body.push('<li>' + escape(line.slice(2)) + '</li>');
        } else {
            const heading = /^(#{1,3}) (.+)$/.exec(line);
            if (heading) body.push(`<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>`);
            else if (line.trim()) body.push('<p>' + escape(line) + '</p>');
        }
    }
    if (list) body.push('</ul>');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>VPNUK for Windows — Changelog</title><style>' +
        'body{font:16px/1.6 system-ui,sans-serif;color:#172536;background:#f5f7fa;margin:0}' +
        'main{max-width:850px;margin:32px auto;padding:24px 32px;background:white;border-radius:8px}' +
        'h1{font-size:28px}h2{border-top:1px solid #ccd5df;padding-top:24px;color:#145da0}' +
        'h3{margin-bottom:8px}li{margin-bottom:6px}' +
        '@media(max-width:600px){main{margin:0;padding:20px}}</style></head><body><main>' +
        body.join('\n') + '</main></body></html>\n';
}

if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    const output = path.join(root, 'build/changelog.html');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, render(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')));
    console.log('Packaged offline changelog: build/changelog.html');
}
module.exports = { render };
