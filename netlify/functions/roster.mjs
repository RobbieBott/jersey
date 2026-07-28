import { getStore } from '@netlify/blobs';

const KEY = 'roster';
const DEFAULTS = { min: 1, max: 99, pin: null, picks: [] };
const NAME_RE = /^[A-Za-z][A-Za-z'\u2019\-. ]{0,24}$/;

const store = () => getStore('jersey');

async function read() {
  let d = null;
  try { d = await store().get(KEY, { type: 'json' }); } catch (e) { d = null; }
  return { ...DEFAULTS, ...(d || {}), picks: Array.isArray(d?.picks) ? d.picks : [] };
}
async function write(d) { await store().setJSON(KEY, d); }

const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/* what every visitor is allowed to see: the board, never the PIN */
const board = d => ({ min: d.min, max: d.max, picks: d.picks, pinSet: !!(process.env.COACH_PIN || d.pin) });

const tidy = s => s.trim().replace(/\s+/g, ' ').split(' ')
  .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

function pinOk(d, pin) {
  const supplied = String(pin ?? '').trim();
  if (!supplied) return false;
  if (process.env.COACH_PIN) return supplied === process.env.COACH_PIN;
  return d.pin ? supplied === d.pin : false;
}

/* shared checks. skipNumber lets an edit keep its own slot without colliding with itself */
function validate(data, rawName, number, skipNumber = null) {
  if (!NAME_RE.test(String(rawName ?? '').trim()))
    return { error: 'Use letters only for the first name.' };
  if (!Number.isInteger(number) || number < data.min || number > data.max)
    return { error: `Pick a number between ${data.min} and ${data.max}.` };

  const name = tidy(rawName);
  const held = data.picks.find(p => p.number === number && p.number !== skipNumber);
  if (held) return { error: `${number} is already ${held.name}'s.` };

  const dupe = data.picks.find(p => p.name.toLowerCase() === name.toLowerCase() && p.number !== skipNumber);
  if (dupe) return { error: `${name} already has ${dupe.number}.` };

  return { name };
}

export default async (req) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return reply({ error: 'Bad request.' }, 400); }
  const action = body.action;

  try {
    const data = await read();

    if (action === 'get') return reply(board(data));

    if (action === 'claim') {
      const v = validate(data, body.name, Number(body.number));
      if (v.error) {
        const held = data.picks.find(p => p.number === Number(body.number));
        return reply({
          error: held ? `${body.number} just went to ${held.name}. Pick another one.` : v.error,
          roster: board(data)
        }, 409);
      }
      data.picks.push({ name: v.name, number: Number(body.number), ts: Date.now() });
      await write(data);
      return reply({ ok: true, name: v.name, number: Number(body.number), roster: board(data) });
    }

    /* first coach through the door sets the PIN, unless COACH_PIN is set in Netlify */
    if (action === 'coach') {
      const supplied = String(body.pin ?? '').trim();
      if (!supplied) return reply({ error: 'Enter a PIN to continue.' }, 400);
      if (!process.env.COACH_PIN && !data.pin) {
        data.pin = supplied;
        await write(data);
        return reply({ ok: true, roster: board(data) });
      }
      if (!pinOk(data, supplied)) return reply({ error: 'That PIN did not match.' }, 401);
      return reply({ ok: true, roster: board(data) });
    }

    /* everything past here is coach-only */
    if (!pinOk(data, body.pin)) return reply({ error: 'That PIN did not match.' }, 401);

    if (action === 'edit') {
      const current = Number(body.number);
      const idx = data.picks.findIndex(p => p.number === current);
      if (idx < 0) return reply({ error: 'That pick is no longer on the board.', roster: board(data) }, 409);

      const nextNumber = (body.newNumber === '' || body.newNumber == null) ? current : Number(body.newNumber);
      const nextName = body.newName == null ? data.picks[idx].name : String(body.newName);

      const v = validate(data, nextName, nextNumber, current);
      if (v.error) return reply({ error: v.error, roster: board(data) }, 409);

      data.picks[idx] = { name: v.name, number: nextNumber, ts: data.picks[idx].ts };
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    if (action === 'assign') {
      const v = validate(data, body.name, Number(body.number));
      if (v.error) return reply({ error: v.error, roster: board(data) }, 409);
      data.picks.push({ name: v.name, number: Number(body.number), ts: Date.now() });
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    if (action === 'remove') {
      data.picks = data.picks.filter(p => p.number !== Number(body.number));
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    if (action === 'range') {
      const min = Number(body.min), max = Number(body.max);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 99 || max <= min)
        return reply({ error: 'Enter a range between 0 and 99, low number first.' }, 400);
      const stranded = data.picks.filter(p => p.number < min || p.number > max);
      if (stranded.length)
        return reply({
          error: `That range drops ${stranded.map(p => p.name + ' (' + p.number + ')').join(', ')}. Move or remove them first.`,
          roster: board(data)
        }, 409);
      data.min = min; data.max = max;
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    if (action === 'reset') {
      data.picks = [];
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    return reply({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return reply({ error: 'The roster store is unreachable. Try again in a moment.' }, 500);
  }
};
