// npm run specimens  (instructor only) redraws the mock documents in test-data/specimens.
// The PNGs are committed, so students never need to run this.
//
// Every specimen is an invented person on a plain, generic layout with a large SPECIMEN
// watermark. Nothing copies an emblem, layout or security feature of a real document.
// MRZ check digits and NIC birth dates come from the project's own rule modules.

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { mrzCheckDigit } from '../functions/validate-fields/src/rules/mrz';
import { decodeNic } from '../functions/validate-fields/src/rules/nic';

const OUT = resolve(__dirname, 'specimens');
const SANS = 'DejaVu Sans, Arial, sans-serif';
const MONO = 'DejaVu Sans Mono, Courier New, monospace';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const passportDate = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const nicDate = (iso: string) => iso.replace(/-/g, '/');

function watermark(width: number, height: number) {
  return `<text x="${width / 2}" y="${height / 2}" font-family="${SANS}" font-size="${Math.round(width / 6.5)}" font-weight="bold"
    fill="#c0392b" fill-opacity="0.16" text-anchor="middle" dominant-baseline="middle"
    transform="rotate(-24 ${width / 2} ${height / 2})">SPECIMEN</text>`;
}

function photoBox(x: number, y: number, w: number, h: number) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#d5dbe1" stroke="#9aa6b2"/>
    <circle cx="${x + w / 2}" cy="${y + h * 0.38}" r="${w * 0.22}" fill="#aab4bf"/>
    <rect x="${x + w * 0.2}" y="${y + h * 0.62}" width="${w * 0.6}" height="${h * 0.3}" rx="${w * 0.2}" fill="#aab4bf"/>`;
}

function field(x: number, y: number, label: string, value: string, size = 30) {
  return `<text x="${x}" y="${y}" font-family="${SANS}" font-size="18" fill="#5e6b7e">${esc(label)}</text>
    <text x="${x}" y="${y + size + 6}" font-family="${SANS}" font-size="${size}" font-weight="bold" fill="#14233d">${esc(value)}</text>`;
}

// ---- passports -----------------------------------------------------------------------

interface PassportPerson {
  surname: string;
  givenNames: string;
  sex: 'M' | 'F';
  dob: string; // YYYY-MM-DD
  expiry: string;
  number: string; // e.g. N1234567
}

export function passportMrz(p: PassportPerson, corruptDobCheck = false): [string, string] {
  const line1 = `P<LKA${p.surname}<<${p.givenNames.replace(/ /g, '<')}`.padEnd(44, '<');
  const number = p.number.padEnd(9, '<');
  const dob = p.dob.slice(2).replace(/-/g, '');
  const expiry = p.expiry.slice(2).replace(/-/g, '');
  const optional = '<'.repeat(14);
  let dobCheck = mrzCheckDigit(dob);
  if (corruptDobCheck) dobCheck = (dobCheck + 1) % 10;
  const body = `${number}${mrzCheckDigit(number)}LKA${dob}${dobCheck}${p.sex}${expiry}${mrzCheckDigit(expiry)}${optional}${mrzCheckDigit(optional)}`;
  const composite = mrzCheckDigit(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
  return [line1, body + composite];
}

function passportSvg(p: PassportPerson, mrz: [string, string]) {
  const W = 1250;
  const H = 880;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#f3efe4"/>
    <rect x="0" y="0" width="${W}" height="86" fill="#2c3e57"/>
    <text x="40" y="56" font-family="${SANS}" font-size="34" font-weight="bold" fill="#ffffff">PASSPORT · TRAINING SPECIMEN</text>
    <text x="${W - 40}" y="56" font-family="${SANS}" font-size="22" fill="#d8dee6" text-anchor="end">Not a real document</text>
    ${photoBox(50, 130, 300, 380)}
    ${field(400, 140, 'Type', 'P')}
    ${field(560, 140, 'Country code', 'LKA')}
    ${field(800, 140, 'Passport No.', p.number)}
    ${field(400, 230, 'Surname', p.surname)}
    ${field(400, 320, 'Given names', p.givenNames)}
    ${field(400, 410, 'Date of birth', passportDate(p.dob))}
    ${field(800, 410, 'Sex', p.sex)}
    ${field(400, 500, 'Date of expiry', passportDate(p.expiry))}
    ${watermark(W, H)}
    <rect x="0" y="${H - 190}" width="${W}" height="190" fill="#ffffff"/>
    <text x="40" y="${H - 115}" font-family="${MONO}" font-size="40" fill="#111" xml:space="preserve">${esc(mrz[0])}</text>
    <text x="40" y="${H - 50}" font-family="${MONO}" font-size="40" fill="#111" xml:space="preserve">${esc(mrz[1])}</text>
  </svg>`;
}

// ---- NICs ----------------------------------------------------------------------------

interface NicPerson {
  name: string;
  nic: string;
  printedDob: string; // what is printed on the card (may differ from the number on purpose)
  sex: 'M' | 'F';
}

function nicFrontSvg(p: NicPerson) {
  const W = 1000;
  const H = 630;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" rx="24" fill="#e6efee"/>
    <rect x="0" y="0" width="${W}" height="80" rx="24" fill="#1f5f5b"/>
    <rect x="0" y="50" width="${W}" height="30" fill="#1f5f5b"/>
    <text x="36" y="52" font-family="${SANS}" font-size="30" font-weight="bold" fill="#ffffff">IDENTITY CARD · TRAINING SPECIMEN</text>
    ${photoBox(40, 120, 240, 300)}
    ${field(320, 130, 'ID number', p.nic, 40)}
    ${field(320, 245, 'Name', p.name)}
    ${field(320, 335, 'Date of birth', nicDate(p.printedDob))}
    ${field(640, 335, 'Sex', p.sex === 'F' ? 'F' : 'M')}
    <text x="40" y="${H - 40}" font-family="${SANS}" font-size="20" fill="#5e6b7e">Invented person for a workshop. Not a real document.</text>
    ${watermark(W, H)}
  </svg>`;
}

function nicBackSvg(p: NicPerson) {
  const W = 1000;
  const H = 630;
  let bars = '';
  for (let i = 0, x = 60; x < 900; i += 1) {
    const w = 2 + ((p.nic.charCodeAt(i % p.nic.length) + i) % 5);
    bars += `<rect x="${x}" y="420" width="${w}" height="110" fill="#14233d"/>`;
    x += w + 3 + (i % 3);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" rx="24" fill="#e6efee"/>
    <text x="40" y="70" font-family="${SANS}" font-size="28" font-weight="bold" fill="#1f5f5b">BACK · TRAINING SPECIMEN</text>
    ${field(40, 130, 'ID number', p.nic, 36)}
    ${field(40, 240, 'Issued', '2016/01/04')}
    ${field(420, 240, 'Issued at', 'Training office')}
    <text x="40" y="380" font-family="${SANS}" font-size="20" fill="#5e6b7e">This card is a mock-up for teaching. It holds no real personal data.</text>
    ${bars}
    ${watermark(W, H)}
  </svg>`;
}

// ---- the set -------------------------------------------------------------------------

const specimenPerson: PassportPerson = {
  surname: 'PERSON',
  givenNames: 'SPECIMEN',
  sex: 'F',
  dob: '1990-02-12',
  expiry: '2031-02-11',
  number: 'N1234567',
};

const badMrzPerson: PassportPerson = {
  surname: 'PERERA',
  givenNames: 'SPECIMEN RUWAN',
  sex: 'M',
  dob: '1988-11-30',
  expiry: '2030-06-14',
  number: 'N7654321',
};

const nics: Record<string, { person: NicPerson; blur?: number }> = {
  nic_old_valid: { person: { name: 'SPECIMEN PERSON', nic: '905431234V', printedDob: '1990-02-12', sex: 'F' } },
  nic_new_valid: { person: { name: 'SPECIMEN NIMAL SILVA', nic: '198512405678', printedDob: '1985-05-03', sex: 'M' } },
  // The number encodes 21 July 1992; the card prints 22 July. Validate catches it.
  nic_dob_mismatch: { person: { name: 'SPECIMEN KAMALA DIAS', nic: '927031122V', printedDob: '1992-07-22', sex: 'F' } },
  nic_blurred: { person: { name: 'SPECIMEN AMAYA FONSEKA', nic: '955683344V', printedDob: '1995-03-08', sex: 'F' }, blur: 14 },
};

async function render(svg: string, file: string, blur?: number) {
  let image = sharp(Buffer.from(svg));
  if (blur) image = image.blur(blur);
  await image.png().toFile(resolve(OUT, file));
  console.log(`  ${file}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Writing specimens to ${OUT}`);

  await render(passportSvg(specimenPerson, passportMrz(specimenPerson)), 'passport_valid.png');
  await render(passportSvg(badMrzPerson, passportMrz(badMrzPerson, true)), 'passport_bad_mrz.png');

  for (const [name, { person, blur }] of Object.entries(nics)) {
    const decoded = decodeNic(person.nic);
    if (!decoded.ok) throw new Error(`${name}: ${person.nic} is not a valid NIC`);
    const shouldMatch = name !== 'nic_dob_mismatch';
    if ((decoded.birthDate === person.printedDob) !== shouldMatch || decoded.sex !== person.sex) {
      throw new Error(`${name}: number encodes ${decoded.birthDate} ${decoded.sex}, card prints ${person.printedDob} ${person.sex}`);
    }
    await render(nicFrontSvg(person), `${name}_front.png`, blur);
    await render(nicBackSvg(person), `${name}_back.png`, blur);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
