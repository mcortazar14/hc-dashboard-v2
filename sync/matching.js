// Matching logic — reusa exactamente la lógica de matching-actual.md

const NICKNAMES = {
  'bob':'robert','robert':'bob','bill':'william','william':'bill',
  'matt':'matthew','matthew':'matt','chris':'christopher','christopher':'chris',
  'mike':'michael','michael':'mike','tom':'thomas','thomas':'tom',
  'jim':'james','james':'jim','joe':'joseph','joseph':'joe',
  'dan':'daniel','daniel':'dan','dave':'david','david':'dave',
  'nick':'nicholas','nicholas':'nick','sam':'samuel','samuel':'sam',
  'alex':'alexander','alexander':'alex','ben':'benjamin','benjamin':'ben',
  'liz':'elizabeth','elizabeth':'liz','kate':'katherine','katherine':'kate',
  'sue':'susan','susan':'sue','jen':'jennifer','jennifer':'jen',
  'vince':'vincent','vincent':'vince','steve':'steven','steven':'steve',
  'greg':'gregory','gregory':'greg','jeff':'jeffrey','jeffrey':'jeff',
  'ken':'kenneth','kenneth':'ken','brad':'bradley','bradley':'brad',
  'ron':'ronald','ronald':'ron','pat':'patrick','patrick':'pat'
};

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function wordSimilar(w1, w2) {
  if (w1 === w2) return true;
  if (NICKNAMES[w1] === w2 || NICKNAMES[w2] === w1) return true;
  const maxLen = Math.max(w1.length, w2.length);
  if (maxLen < 4) return false;
  return levenshtein(w1, w2) <= Math.floor(maxLen * 0.25);
}

function fuzzyMatch(name1, name2) {
  if (!name1 || !name2) return 0;
  const clean = s => s.toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\bjr\b|\bsr\b|\bii\b|\biii\b/g, '')
    .trim();
  const n1 = clean(name1), n2 = clean(name2);
  if (n1 === n2) return 1;
  const words1 = n1.split(' ').filter(w => w.length > 1);
  const words2 = n2.split(' ').filter(w => w.length > 1);
  if (!words1.length || !words2.length) return 0;
  let matchCount = 0;
  const used = new Set();
  for (const w1 of words1) {
    for (let j = 0; j < words2.length; j++) {
      if (used.has(j)) continue;
      if (wordSimilar(w1, words2[j])) { matchCount++; used.add(j); break; }
    }
  }
  const total = Math.max(words1.length, words2.length);
  const shorter = Math.min(words1.length, words2.length);
  let score = matchCount / total;
  if (matchCount === shorter && shorter >= 2) score = Math.max(score, 0.75);
  return score;
}

const JOB_TITLE_KEYWORDS = new Set([
  'setter','assistant','manager','coordinator','specialist','representative',
  'developer','designer','strategist','caller','recruiter','bookkeeper',
  'accountant','copywriter','architect','analyst','editor','closer',
  'consultant','officer','engineer','writer','buyer','researcher','expert',
  'advisor','director','operator','associate','creator','host','producer',
  'rep','csr','sdr','bdr','va','ea','moderator','sourcer'
]);

function extractClientName(jobName) {
  if (!jobName) return '';
  const parts = jobName.split(/ ?- /);
  if (parts.length <= 1) return jobName.trim();
  const lastPart = parts[parts.length - 1].trim();
  const lastWords = lastPart.toLowerCase().replace(/[()\/]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const lastIsJobTitle = lastWords.some(w => JOB_TITLE_KEYWORDS.has(w));
  return lastIsJobTitle ? parts[0].trim() : lastPart;
}

function normalizeEmail(email) {
  if (!email) return '';
  return email.toLowerCase().trim();
}

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

module.exports = { fuzzyMatch, extractClientName, normalizeEmail, normalizePhone };
