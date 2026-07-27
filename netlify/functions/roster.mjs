import { getStore } from '@netlify/blobs';

const KEY = 'roster';
const DEFAULTS = { min: 1, max: 99, pin: null, picks: [] };

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

export default async (req) => {
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return reply({ error: 'Bad request.' }, 400); }
  const action = body.action;

  try {
    const data = await read();

    if (action === 'get') return reply(board(data));

    if (action === 'claim') {
      const raw = String(body.name ?? '');
      const number = Number(body.number);
      if (!/^[A-Za-z][A-Za-z'\u2019\-. ]{0,24}$/.test(raw.trim()))
        return reply({ error: 'Use letters only for your first name.' }, 400);
      if (!Number.isInteger(number) || number < data.min || number > data.max)
        return reply({ error: `Pick a number between ${data.min} and ${data.max}.` }, 400);

      const name = tidy(raw);
      const held = data.picks.find(p => p.number === number);
      if (held) return reply({ error: `${number} just went to ${held.name}. Pick another one.`, roster: board(data) }, 409);

      const already = data.picks.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (already) return reply({ error: `${name} already has ${already.number}. Ask your coach if you need to switch.`, roster: board(data) }, 409);

      data.picks.push({ name, number, ts: Date.now() });
      await write(data);
      return reply({ ok: true, name, number, roster: board(data) });
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

    if (action === 'remove') {
      if (!pinOk(data, body.pin)) return reply({ error: 'That PIN did not match.' }, 401);
      data.picks = data.picks.filter(p => p.number !== Number(body.number));
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    if (action === 'range') {
      if (!pinOk(data, body.pin)) return reply({ error: 'That PIN did not match.' }, 401);
      const min = Number(body.min), max = Number(body.max);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 99 || max <= min)
        return reply({ error: 'Enter a range between 0 and 99, low number first.' }, 400);
      data.min = min; data.max = max;
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    if (action === 'reset') {
      if (!pinOk(data, body.pin)) return reply({ error: 'That PIN did not match.' }, 401);
      data.picks = [];
      await write(data);
      return reply({ ok: true, roster: board(data) });
    }

    return reply({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return reply({ error: 'The roster store is unreachable. Try again in a moment.' }, 500);
  }
};
