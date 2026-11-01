import { writeFileSync, mkdirSync } from 'node:fs';

const OUT_DIR = 'C:/AI banking/Maneki-Neko/docs/notes';
mkdirSync(OUT_DIR, { recursive: true });

const res = await fetch('https://awesome-dsh-plugin.com/plugins.json', {
  headers: { 'user-agent': 'dsh-wealth-curation/1.0' },
});
if (!res.ok) throw new Error('HTTP ' + res.status);
const data = await res.json();
const all = data.plugins || [];

// (name, owner) pairs chosen as 理财相关
const wanted = [
  ['dsh-fund-research', 'PerryLink'],
  ['bookkeeping', 'JohnXu22786'],
  ['MoneyPal#dsh-moneypal', 'ding112'],
  ['Portfolio-OS#dsh-portfolio-os', 'Snowball-labbot'],
  ['dsh-crypto-portfolio', '0xRabit'],
  ['dsh-stock-watch', 'Awu12277'],
  ['dsh-stock-watch', 'Bob-Bo1'],
  ['dsh-ths-holdings', 'PM25000'],
  ['dsh-stock-terminal', 'linhut'],
  ['dsh_kline', null],
  ['dsh-xueqiu', null],
  ['dsh-plugin-stock-x', 'xuexiaolei1997'],
  ['market-watch', 'JohnXu22786'],
  ['dsh-quant', 'pengpengyi92'],
  ['dsh-trading', 'maddogfinance'],
  ['dsh-finance', null],
  ['dsh-tradingagents', 'megatronyy'],
  ['dsh-plugin-finance-data', null],
  ['dsh-astock-research', 'tiantianlaolao'],
  ['dsh-trading-toolkit', 'kentleenot'],
  ['dsh-us-stocks', 'Realyujie'],
  ['bigA', 'kobenfang'],
  ['dsh-rigorquant', null],
  ['Invoice-Downloader#dsh-invoice-downloader', 'ethanyoq'],
  ['dsh-invoice-tools', '988hj7tczd-oss'],
  ['dsh-tool-invoice', null],
  ['dsh-insurance-experts#insurance-company-analyst', null],
  ['dsh-insurance-experts#insurance-ops-analyst', null],
];

const rows = [];
const missing = [];
for (const [name, owner] of wanted) {
  const hit = all.find((p) => p.name === name && (owner === null || p.owner === owner));
  if (!hit) { missing.push(`${name} / ${owner}`); continue; }
  rows.push({
    name: hit.name,
    owner: hit.owner,
    category: hit.category,
    stars: hit.stars,
    downloads: hit.downloads,
    version: hit.version,
    npm: hit.npm,
    page: hit.page,
    repo: hit.url,
    install: hit.install,
    added: hit.added,
    capabilities: hit.capabilities || [],
    redLines: hit.capabilityRedLines || [],
    zh: hit.description?.zh || '',
    en: hit.description?.en || '',
  });
}

writeFileSync(`${OUT_DIR}/dsh-wealth-plugins.json`, JSON.stringify({ registry: data.updated, count: data.count, rows }, null, 1), 'utf8');

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = [
  ['名称', '作者', '分类', '星数', '下载', '版本', 'npm 包', '安装命令', '能力声明', '红线', '收录日期', '页面', '简介'].join(','),
  ...rows.map((r) => [
    r.name, r.owner, r.category, r.stars ?? '', r.downloads ?? '', r.version ?? '', r.npm ?? '',
    r.install, r.capabilities.join(' '), r.redLines.join(' '), r.added ?? '', r.page, r.zh,
  ].map(esc).join(',')),
].join('\r\n');
writeFileSync(`${OUT_DIR}/dsh-wealth-plugins.csv`, '\uFEFF' + csv, 'utf8');

console.log('registry updated:', data.updated, 'total:', data.count);
console.log('selected:', rows.length, 'missing:', missing.length ? missing.join(' | ') : 'none');
for (const r of rows) {
  console.log(`${String(r.stars ?? 0).padStart(4)}star dl=${String(r.downloads ?? '-').padStart(5)} ${r.name} [${r.category}] ${r.owner} caps=${r.capabilities.join(',')||'-'} red=${r.redLines.length}`);
}
