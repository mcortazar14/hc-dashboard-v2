// HC Dashboard v2 — Sincronizador principal
// REGLA DE ORO: SOLO LECTURA hacia GHL, RCRM y Google Sheets.
// Solo escribe en Supabase.

const { createClient } = require('@supabase/supabase-js');
const { getContactsForHC, getConversationsForHC, getMessages } = require('./ghl');
const { readRCRM, readUpsellTracker } = require('./sheets');
const { fuzzyMatch, extractClientName, normalizeEmail, normalizePhone } = require('./matching');

// ── Config ──────────────────────────────────────────────────
const HCS = [
  { id: 'Q0aVHyBbFhqJxWuEKLMt', name: 'Mateo Cortazar',       team: 'Team 3' },
  { id: 'uqAeFfwbHnH0lCwSvprz', name: 'Matt Chavez',           team: 'Team 1' },
  { id: 'YNlj27LBFv74CKLrh1zy', name: 'Maria Fernanda Franco', team: 'Team 2' },
];

const JOB_TEAM_HC = { 'Team 1': 'uqAeFfwbHnH0lCwSvprz', 'Team 2': 'YNlj27LBFv74CKLrh1zy', 'Team 3': 'Q0aVHyBbFhqJxWuEKLMt' };

const JUNK_PATTERNS = ['remote latinos test', 'listing admin', 'esteban', 'esteban andrade', 'omer bloch'];

function isJunk(name, junkFromDb = []) {
  const n = (name || '').toLowerCase().trim();
  if (JUNK_PATTERNS.some(p => n.includes(p))) return true;
  return junkFromDb.some(p => n.includes(p.toLowerCase()));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ────────────────────────────────────────────────────
async function main() {
  // Validate env
  const required = ['GHL_TOKEN', 'GHL_LOCATION_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON'];
  for (const k of required) {
    if (!process.env[k]) { console.error(`Missing env var: ${k}`); process.exit(1); }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Log sync start
  const { data: syncRun } = await supabase.from('sync_runs').insert({ status: 'running' }).select().single();
  const runId = syncRun?.id;
  console.log(`Sync run #${runId} started`);

  const errors = [];
  const counts = { total: 0, open: 0, perHC: {}, porRevisar: 0, sinAsignar: 0 };

  try {
    // ── 1. Load junk exclusions from DB ────────────────────
    const { data: junkRows } = await supabase.from('junk_exclusions').select('name_pattern');
    const junkFromDb = (junkRows || []).map(r => r.name_pattern);

    // ── 2. Load existing client_links (to avoid re-matching) ──
    const { data: existingLinks } = await supabase.from('client_links').select('*');
    const linksBySourceId = {};
    for (const link of (existingLinks || [])) {
      const key = `${link.source}::${link.source_id}`;
      if (!linksBySourceId[key]) linksBySourceId[key] = [];
      linksBySourceId[key].push(link);
    }

    // ── 3. Fetch GHL contacts (all HCs) ────────────────────
    console.log('Fetching GHL contacts...');
    const ghlContactMap = {}; // contactId → contact object
    const ghlByEmail = {};    // email → contactId
    const ghlByPhone = {};    // phone → contactId

    for (const hc of HCS) {
      console.log(`  GHL contacts: ${hc.name}`);
      const contacts = await getContactsForHC(hc.id);
      for (const c of contacts) {
        const contactId = c.id;
        if (!contactId) continue;
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || '';
        if (isJunk(name, junkFromDb)) continue;

        ghlContactMap[contactId] = {
          id: contactId,
          name,
          email: normalizeEmail(c.email),
          phone: normalizePhone(c.phone),
          hcId: hc.id,
          tags: c.tags || [],
        };
        if (c.email) ghlByEmail[normalizeEmail(c.email)] = contactId;
        if (c.phone) ghlByPhone[normalizePhone(c.phone)] = contactId;
      }
      await sleep(500);
    }
    console.log(`  Total GHL contacts loaded: ${Object.keys(ghlContactMap).length}`);

    // ── 4. Fetch GHL conversations (for last contact date) ─
    console.log('Fetching GHL conversations...');
    const lastContactMap = {}; // contactId → { lastContact, conversationId }

    for (const hc of HCS) {
      console.log(`  Conversations: ${hc.name}`);
      const convos = await getConversationsForHC(hc.id);
      for (const conv of convos) {
        const cid = conv.contactId;
        if (!cid) continue;
        const existing = lastContactMap[cid];
        if (!existing || new Date(conv.lastMessageDate) > new Date(existing.lastContact)) {
          lastContactMap[cid] = {
            lastContact: conv.lastMessageDate,
            conversationId: conv.id,
          };
        }
      }
      await sleep(500);
    }

    // ── 5. Upsert clients into Supabase ────────────────────
    console.log('Upserting clients...');
    const clientsToUpsert = Object.values(ghlContactMap).map(c => ({
      id:                 c.id,
      name:               c.name,
      hc_id:              c.hcId,
      last_contact:       lastContactMap[c.id]?.lastContact || null,
      updated_at:         new Date().toISOString(),
    }));

    // Batch upsert in chunks of 100
    for (let i = 0; i < clientsToUpsert.length; i += 100) {
      const chunk = clientsToUpsert.slice(i, i + 100);
      const { error } = await supabase.from('clients').upsert(chunk, { onConflict: 'id' });
      if (error) { errors.push('clients upsert: ' + error.message); console.error('clients upsert error:', error.message); }
    }
    counts.total = clientsToUpsert.length;
    console.log(`  Upserted ${clientsToUpsert.length} clients`);

    // ── 6. Read and match RCRM ─────────────────────────────
    console.log('Reading RCRM sheet...');
    const rcrmRows = await readRCRM();
    console.log(`  RCRM rows: ${rcrmRows.length}`);

    let rcrmMatched = 0, rcrmPorRevisar = 0, rcrmUnmatched = 0;
    const newLinks = [];

    for (const row of rcrmRows) {
      const clientName = extractClientName(row.jobName);
      if (!clientName || isJunk(clientName, junkFromDb)) continue;

      // Check if already linked
      const existingLinkKey = `rcrm::${row.jobName}`;
      if (linksBySourceId[existingLinkKey]) {
        rcrmMatched++;
        continue;
      }

      // Try email match first
      let matchedId = null;
      let method = null;

      if (row.emailClient && ghlByEmail[row.emailClient]) {
        matchedId = ghlByEmail[row.emailClient];
        method = 'email';
      }

      // Try name fuzzy match
      if (!matchedId) {
        let bestScore = 0, bestId = null;
        for (const [cid, contact] of Object.entries(ghlContactMap)) {
          const score = fuzzyMatch(clientName, contact.name);
          if (score > bestScore) { bestScore = score; bestId = cid; }
        }
        if (bestScore >= 0.60) {
          matchedId = bestId;
          method = 'name';
        }
      }

      if (matchedId) {
        const status = method === 'name' ? 'por_revisar' : 'confirmed';
        newLinks.push({
          client_id:  matchedId,
          source:     'rcrm',
          source_id:  row.jobName,
          method,
          status,
          confidence: method === 'name' ? null : 1.0,
          notes:      `RCRM: ${row.jobName} | Status: ${row.jobStatus} | Team: ${row.jobTeam}`,
        });

        // Update client with RCRM info
        const hcId = JOB_TEAM_HC[row.jobTeam] || null;
        const updateData = { updated_at: new Date().toISOString() };
        if (hcId) updateData.hc_id = hcId;
        if (row.jobStatus) updateData.status = mapRcrmStatus(row.jobStatus);
        if (row.jobTeam) updateData.job_team = row.jobTeam;
        if (row.activeDays) updateData.active_days = parseInt(row.activeDays) || 0;
        if (row.jobStatus) updateData.rcrm_status = row.jobStatus;

        await supabase.from('clients').update(updateData).eq('id', matchedId);

        if (status === 'por_revisar') rcrmPorRevisar++;
        else rcrmMatched++;
      } else {
        rcrmUnmatched++;
      }
    }

    // Save new links in batches
    if (newLinks.length > 0) {
      for (let i = 0; i < newLinks.length; i += 100) {
        const { error } = await supabase.from('client_links').insert(newLinks.slice(i, i + 100));
        if (error) errors.push('client_links insert: ' + error.message);
      }
    }
    console.log(`  RCRM: ${rcrmMatched} confirmados, ${rcrmPorRevisar} por revisar, ${rcrmUnmatched} sin match`);
    counts.porRevisar += rcrmPorRevisar;

    // ── 7. Read and sync Upsell Tracker ───────────────────
    console.log('Reading Upsell Tracker...');
    const upsellRows = await readUpsellTracker();
    console.log(`  Upsell rows: ${upsellRows.length}`);

    let upsellMatched = 0, upsellPorRevisar = 0;
    const upsellLinks = [];
    const upsellStagesUpsert = [];

    for (const row of upsellRows) {
      if (!row.clientName || isJunk(row.clientName, junkFromDb)) continue;

      const linkKey = `upsell_tracker::${row.trackerId}`;
      let clientId = null;

      // Check existing link
      if (linksBySourceId[linkKey]) {
        clientId = linksBySourceId[linkKey][0]?.client_id;
        upsellMatched++;
      } else {
        // Try name match
        let bestScore = 0, bestId = null;
        for (const [cid, contact] of Object.entries(ghlContactMap)) {
          const score = fuzzyMatch(row.clientName, contact.name);
          if (score > bestScore) { bestScore = score; bestId = cid; }
        }
        if (bestScore >= 0.60) {
          clientId = bestId;
          const status = bestScore >= 0.85 ? 'confirmed' : 'por_revisar';
          upsellLinks.push({
            client_id:  clientId,
            source:     'upsell_tracker',
            source_id:  row.trackerId,
            method:     'name',
            status,
            confidence: bestScore,
            notes:      `Upsell: ${row.clientName}`,
          });
          if (status === 'por_revisar') { upsellPorRevisar++; counts.porRevisar++; }
          else upsellMatched++;
        }
      }

      if (clientId) {
        upsellStagesUpsert.push({
          client_id:             clientId,
          stage:                 row.upsellStage || 'N/A',
          stage_since:           row.stageSince || null,
          last_external_contact: row.lastExternalContact || null,
          external_channel:      row.externalChannel || null,
          client_responded:      row.clientResponded,
          notes:                 row.notes || null,
          updated_at:            new Date().toISOString(),
        });

        // Update client upsell stage
        await supabase.from('clients').update({
          upsell_stage:       row.upsellStage || 'N/A',
          upsell_stage_since: row.stageSince || null,
          updated_at:         new Date().toISOString(),
        }).eq('id', clientId);
      }
    }

    if (upsellLinks.length > 0) {
      for (let i = 0; i < upsellLinks.length; i += 100) {
        const { error } = await supabase.from('client_links').insert(upsellLinks.slice(i, i + 100));
        if (error) errors.push('upsell client_links: ' + error.message);
      }
    }
    if (upsellStagesUpsert.length > 0) {
      for (let i = 0; i < upsellStagesUpsert.length; i += 100) {
        const { error } = await supabase.from('upsell_stages').upsert(upsellStagesUpsert.slice(i, i + 100), { onConflict: 'client_id' });
        if (error) errors.push('upsell_stages upsert: ' + error.message);
      }
    }
    console.log(`  Upsell: ${upsellMatched} confirmados, ${upsellPorRevisar} por revisar`);

    // ── 8. Sync GHL messages (last 90 days) ───────────────
    console.log('Syncing GHL messages (sample per HC)...');
    let msgCount = 0;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    for (const hc of HCS) {
      const convos = await getConversationsForHC(hc.id);
      // Only process convos with activity in last 90 days
      const recentConvos = convos.filter(c => c.lastMessageDate && new Date(c.lastMessageDate) >= ninetyDaysAgo);
      console.log(`  ${hc.name}: ${recentConvos.length} convos recientes`);

      for (const conv of recentConvos) {
        const contactId = conv.contactId;
        if (!contactId || !ghlContactMap[contactId]) continue;

        const msgs = await getMessages(conv.id);
        const toInsert = [];
        for (const m of msgs) {
          if (new Date(m.dateAdded) < ninetyDaysAgo) continue;
          if (m.messageType !== 'TYPE_SMS' && m.messageType !== 'TYPE_CALL') continue;
          if (m.direction !== 'outbound') continue;
          if (m.source === 'workflow' || m.source === 'campaign') continue;

          const duration = m.meta?.call?.duration || m.meta?.duration || 0;
          toInsert.push({
            id:               m.id,
            client_id:        contactId,
            hc_id:            hc.id,
            message_type:     m.messageType,
            direction:        m.direction,
            date_added:       m.dateAdded,
            duration_seconds: duration,
            is_conversation:  m.messageType === 'TYPE_CALL' && duration >= 120,
            source:           m.source || 'manual',
          });
        }
        if (toInsert.length > 0) {
          const { error } = await supabase.from('messages').upsert(toInsert, { onConflict: 'id' });
          if (error) errors.push('messages upsert: ' + error.message);
          msgCount += toInsert.length;
        }
        await sleep(100);
      }
      await sleep(500);
    }
    console.log(`  Total messages synced: ${msgCount}`);

    // ── 9. Count open/sin asignar ──────────────────────────
    const { data: openClients } = await supabase.from('clients').select('id, hc_id, status').eq('status', 'open');
    counts.open = (openClients || []).length;
    counts.sinAsignar = (openClients || []).filter(c => !c.hc_id).length;

    for (const hc of HCS) {
      counts.perHC[hc.name] = (openClients || []).filter(c => c.hc_id === hc.id).length;
    }

    // ── 10. Update sync run log ───────────────────────────
    await supabase.from('sync_runs').update({
      finished_at:   new Date().toISOString(),
      status:        errors.length > 0 ? 'error' : 'success',
      total_clients: counts.total,
      open_clients:  counts.open,
      clients_per_hc: counts.perHC,
      por_revisar:   counts.porRevisar,
      sin_asignar:   counts.sinAsignar,
      errors:        errors.length > 0 ? errors : null,
    }).eq('id', runId);

    console.log('\n=== Sync completo ===');
    console.log(`Total clientes: ${counts.total}`);
    console.log(`Open: ${counts.open}`);
    console.log(`Por revisar: ${counts.porRevisar}`);
    console.log(`Sin asignar: ${counts.sinAsignar}`);
    console.log('Por HC:', counts.perHC);
    if (errors.length > 0) { console.log('Errores:', errors); process.exit(1); }

  } catch (err) {
    console.error('Error fatal:', err.message);
    await supabase.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      errors: [err.message],
    }).eq('id', runId);
    process.exit(1);
  }
}

function mapRcrmStatus(rcrmStatus) {
  const map = {
    'Open': 'open',
    'Pending to be launched': 'pending',
    'On Hold': 'paused',
    'Client Unresponsive': 'paused',
    'Closed': 'closed',
    'Canceled': 'closed',
  };
  return map[rcrmStatus] || 'open';
}

main();
