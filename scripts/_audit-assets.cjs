const fs = require('fs')
const path = 'projects/crm'
const design = JSON.parse(fs.readFileSync(path + '/design.json', 'utf8'))
const routes = JSON.parse(fs.readFileSync(path + '/routes.json', 'utf8'))
const api = JSON.parse(fs.readFileSync(path + '/api.json', 'utf8'))
const db = JSON.parse(fs.readFileSync(path + '/db.json', 'utf8'))
const shell = fs.readFileSync(path + '/shell.html', 'utf8')

function keys(o) {
  return o && typeof o === 'object' ? Object.keys(o) : []
}

const eps = api.endpoints || []
const fieldLens = eps.map((e) => (e.fields || []).length)
let dup = 0
let empty = 0
const methods = {}
for (const e of eps) {
  methods[e.method] = (methods[e.method] || 0) + 1
  const f = e.fields || []
  if (!f.length) empty++
  if (new Set(f).size < f.length) dup++
}
const contentEps = eps.filter((e) => /content/i.test(e.path || '')).slice(0, 6)

const tables = db.tables || []
let enumCols = 0
let codeCols = 0
let fkCols = 0
let nullFalse = 0
let sensCodes = 0
const enumSamples = []
for (const t of tables) {
  for (const c of t.columns || []) {
    if (c.null === false) nullFalse++
    if (c.fk) fkCols++
    if (c.codes && c.codes.length) {
      codeCols++
      const vals = c.codes.map((x) => String(x.value || '')).filter(Boolean)
      const avg = vals.reduce((a, v) => a + v.length, 0) / Math.max(vals.length, 1)
      if (/password|memo|email/i.test(c.name) || vals.some((v) => /@|!/.test(v))) sensCodes++
      else if (vals.length >= 2 && vals.length <= 12 && avg <= 24) {
        enumCols++
        if (enumSamples.length < 15) enumSamples.push(t.name + '.' + c.name + '=' + vals.join('|'))
      }
    }
  }
}

const r = routes.routes || []
const uniq = [...new Set([...shell.matchAll(/\.([a-z0-9_-]+)/gi)].map((m) => m[1]))].filter((c) =>
  c.startsWith('wfs-'),
)

const out = {
  design: {
    colors: keys(design.color).length,
    colorSample: Object.entries(design.color || {}).slice(0, 6),
    components: (design.component || []).length,
    hasSemanticNames: Object.keys(design.color || {}).some((k) => !/^token-\d+$/.test(k)),
    hasComponentMeta: (design.component || []).some((c) => c.variant || c.props),
  },
  routes: {
    count: r.length,
    fields: keys(r[0] || {}),
    hasNavIA: r.some((x) => x.navGroup || x.section || x.menu),
    hasScreenPattern: r.some((x) => x.type || x.pattern || x.layout),
    folders: [...new Set(r.map((x) => ((x.file || '').match(/pages\/([^/]+)/) || [])[1] || 'other'))],
  },
  api: {
    endpoints: eps.length,
    methods,
    emptyFields: empty,
    dupFields: dup,
    fieldAvg: +(fieldLens.reduce((a, b) => a + b, 0) / Math.max(fieldLens.length, 1)).toFixed(1),
    typedFields: eps.some((e) => (e.fields || []).some((f) => typeof f === 'object')),
    reqResSplit: eps.some((e) => e.request || e.response || e.body),
    contentSample: contentEps.map((e) => ({
      m: e.method,
      p: e.path,
      fields: (e.fields || []).length,
      uniq: [...new Set(e.fields || [])].length,
      head: [...new Set(e.fields || [])].slice(0, 10),
    })),
  },
  db: {
    entities: db.entities,
    tables: tables.map((t) => ({
      name: t.name,
      rows: t.rows,
      cols: (t.columns || []).length,
      fks: (t.columns || []).filter((c) => c.fk).length,
      coded: (t.columns || []).filter((c) => c.codes && c.codes.length).length,
    })),
    nullFalse,
    fkCols,
    codeCols,
    enumLike: enumCols,
    sensitiveCodeCols: sensCodes,
    enumSamples,
  },
  shell: { bytes: shell.length, wfs: uniq.sort() },
  score: {
    design: '2/10',
    design_md: '0/10 missing',
    routes: '5/10',
    api: '4/10',
    db: '6/10',
    shell: '5/10',
  },
}
console.log(JSON.stringify(out, null, 2))
