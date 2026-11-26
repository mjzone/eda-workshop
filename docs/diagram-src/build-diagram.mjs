// Builds docs/architecture.svg from the official AWS Architecture Icons (2026-07-31 package).
// Usage: node build-diagram.mjs <icons-extracted-dir> <output-svg>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [, , ICONS, OUT] = process.argv;
const SVC = join(ICONS, "Architecture-Service-Icons_07312026");
const RES = join(ICONS, "Resource-Icons_07312026");
const GRP = join(ICONS, "Architecture-Group-Icons_07312026");

const F = {
  s3: `${SVC}/Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg`,
  eventbridge: `${SVC}/Arch_Application-Integration/64/Arch_Amazon-EventBridge_64.svg`,
  sfn: `${SVC}/Arch_Application-Integration/64/Arch_AWS-Step-Functions_64.svg`,
  lambda: `${SVC}/Arch_Compute/64/Arch_AWS-Lambda_64.svg`,
  bedrock: `${SVC}/Arch_Artificial-Intelligence/64/Arch_Amazon-Bedrock_64.svg`,
  agentcore: `${SVC}/Arch_Artificial-Intelligence/64/Arch_Amazon-Bedrock-AgentCore_64.svg`,
  dynamodb: `${SVC}/Arch_Databases/64/Arch_Amazon-DynamoDB_64.svg`,
  apigw: `${SVC}/Arch_Networking-Content-Delivery/64/Arch_Amazon-API-Gateway_64.svg`,
  ddbTable: `${RES}/Res_Databases/Res_Amazon-DynamoDB_Table_48.svg`,
  lambdaFn: `${RES}/Res_Compute/Res_AWS-Lambda_Lambda-Function_48.svg`,
  s3Vectors: `${RES}/Res_Storage/Res_Amazon-Simple-Storage-Service_S3-Vectors_48.svg`,
  s3Bucket: `${RES}/Res_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.svg`,
  user: `${RES}/Res_General-Icons/Res_48_Light/Res_User_48_Light.svg`,
  cloud: `${GRP}/AWS-Cloud-logo_32.svg`,
  region: `${GRP}/Region_32.svg`,
};

const INK = "#232F3E", GREY = "#545B64", LINE = "#545B64";
const C_INTEG = "#E7157B", C_AI = "#01A88D", C_REGION = "#00A4A6", C_OPT = "#7D8998";
const FONT = "'Amazon Ember','Helvetica Neue',Helvetica,Arial,sans-serif";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const uri = (file) => `data:image/svg+xml;base64,${readFileSync(file).toString("base64")}`;
const out = [];
const add = (s) => out.push(s);

function icon(key, cx, cy, s) {
  add(`<image href="${uri(F[key])}" x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}"/>`);
}
function text(x, y, str, { size = 11.5, weight = 400, fill = GREY, anchor = "middle", halo = false, italic = false } = {}) {
  const h = halo ? ` stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round" paint-order="stroke"` : "";
  const it = italic ? ` font-style="italic"` : "";
  add(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${h}${it}>${esc(str)}</text>`);
}
// Icon with a bold first label line and grey detail lines underneath.
function node(key, cx, cy, s, lines) {
  icon(key, cx, cy, s);
  lines.forEach((l, i) =>
    text(cx, cy + s / 2 + 16 + i * 15, l, i === 0 ? { size: 13, weight: 700, fill: INK } : {}));
}
function group(x, y, w, h, { stroke, dash = "", label, labelColor = INK, iconKey, iconSize = 28, fill = "none", rx = 0 }) {
  add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
  let tx = x + 12;
  if (iconKey) { add(`<image href="${uri(F[iconKey])}" x="${x}" y="${y}" width="${iconSize}" height="${iconSize}"/>`); tx = x + iconSize + 8; }
  if (label) text(tx, y + iconSize / 2 + 5, label, { size: 13, weight: 700, fill: labelColor, anchor: "start" });
}
function lane(x, y, w, h, title) {
  add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#F7F9FA" stroke="#D5DBDB" stroke-width="1.2"/>`);
  text(x + 14, y + 22, title, { size: 13.5, weight: 700, fill: INK, anchor: "start" });
}
function arrow(points, { dashed = false, both = false } = {}) {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  add(`<path d="${d}" fill="none" stroke="${LINE}" stroke-width="1.8"${dashed ? ` stroke-dasharray="6 4"` : ""} marker-end="url(#arr)"${both ? ` marker-start="url(#arr)"` : ""}/>`);
}
function badge(cx, cy, label) {
  add(`<circle cx="${cx}" cy="${cy}" r="12" fill="${INK}" stroke="#FFFFFF" stroke-width="2"/>`);
  text(cx, cy + 4.5, label, { size: 12.5, weight: 700, fill: "#FFFFFF" });
}
function pill(cx, cy, w, label, stroke) {
  add(`<rect x="${cx - w / 2}" y="${cy - 14}" width="${w}" height="28" rx="14" fill="#FFFFFF" stroke="${stroke}" stroke-width="1.6"/>`);
  text(cx, cy + 4.5, label, { size: 12, weight: 700, fill: INK });
}
function diamond(cx, cy, label) {
  add(`<polygon points="${cx},${cy - 30} ${cx + 32},${cy} ${cx},${cy + 30} ${cx - 32},${cy}" fill="#FFFFFF" stroke="${C_INTEG}" stroke-width="1.8"/>`);
  text(cx, cy + 5, "?", { size: 18, weight: 700, fill: C_INTEG });
  text(cx, cy + 50, label, { size: 13, weight: 700, fill: INK });
}

const W = 1900, H = 1250;

// ---- Title ----
text(40, 50, "Lost Passport and NIC Finder: architecture", { size: 26, weight: 700, fill: INK, anchor: "start" });
text(40, 78, "Flow 1 registers found documents with an event-driven workflow. Flow 2 lets visitors ask a Bedrock agent whether their document is held.", { size: 14, anchor: "start" });

// ---- Groups ----
group(225, 105, 1650, 1065, { stroke: INK, label: "AWS Cloud", iconKey: "cloud", iconSize: 32 });
group(250, 150, 1600, 1000, { stroke: C_REGION, dash: "7 5", label: "Region: us-east-1", labelColor: C_REGION, iconKey: "region", iconSize: 32 });
lane(275, 195, 1365, 440, "FLOW 1 · Register a found document (steps 1–5)");
lane(275, 670, 1365, 460, "FLOW 2 · Find my document (steps A–C)");

// ---- Actors (outside AWS) ----
node("user", 115, 330, 56, ["Security desk officer", "desk CLI"]);
node("user", 115, 830, 56, ["Visitor", "chat page or chat CLI"]);

// ---- Flow 1 ----
node("s3", 360, 330, 64, ["Amazon S3", "found-items bucket", "found/{itemId}/ · reviews/"]);
node("eventbridge", 530, 330, 64, ["Amazon EventBridge", "default bus rule", "key: found/*/manifest.json"]);

group(630, 225, 990, 390, { stroke: C_INTEG, label: "AWS Step Functions · register-found-document (Standard)", iconKey: "sfn", iconSize: 30 });
node("ddbTable", 700, 330, 48, ["ClaimItem", "DynamoDB PutItem", "attribute_not_exists"]);
node("lambdaFn", 850, 330, 48, ["ExtractFields", "AWS Lambda"]);
node("lambdaFn", 1000, 330, 48, ["ValidateFields", "Lambda · pure rules"]);
diamond(1140, 330, "ChecksPassed?");
node("ddbTable", 1290, 330, 48, ["SaveRecord", "DynamoDB PutItem", "no Lambda"]);
pill(1440, 330, 70, "Done", "#1D8102");
pill(700, 492, 136, "AlreadyProcessing", "#1D8102");
node("bedrock", 850, 500, 64, ["Amazon Bedrock", "Amazon Nova Pro", "Converse with images"]);
node("lambdaFn", 1140, 500, 48, ["RequestOfficerReview", ".waitForTaskToken"]);
pill(1350, 500, 176, "Rejected · ReviewTimedOut", "#D13212");

arrow([[148, 330], [322, 330]]);
text(240, 304, "upload pages,", { size: 11, fill: INK, halo: true });
text(240, 317, "manifest.json last", { size: 11, fill: INK, halo: true });
arrow([[394, 330], [496, 330]]);
text(445, 318, "Object Created", { size: 11, fill: INK, halo: true });
arrow([[564, 330], [674, 330]]);
text(617, 318, "StartExecution", { size: 11, fill: INK, halo: true });
arrow([[726, 330], [824, 330]]);
arrow([[876, 330], [974, 330]]);
arrow([[1026, 330], [1106, 330]]);
arrow([[1174, 330], [1264, 330]]);
text(1219, 318, "pass", { size: 11, fill: INK, halo: true });
arrow([[1316, 330], [1403, 330]]);
arrow([[700, 406], [700, 476]], { dashed: true });
text(710, 446, "duplicate event", { size: 11, fill: INK, anchor: "start", halo: true });
arrow([[850, 392], [850, 466]], { both: true });
arrow([[1140, 386], [1140, 474]]);
text(1150, 436, "fail", { size: 11, fill: INK, anchor: "start", halo: true });
arrow([[1114, 500], [1000, 500], [1000, 394]]);
text(1057, 477, "APPROVE:", { size: 11, fill: INK, halo: true });
text(1057, 491, "validate again", { size: 11, fill: INK, halo: true });
arrow([[1166, 500], [1260, 500]]);
text(1213, 489, "REJECT", { size: 11, fill: INK, halo: true });
// Officer answers the review out of band (task token callback).
arrow([[115, 405], [115, 600], [1140, 600], [1140, 566]], { dashed: true });
text(470, 593, "reads reviews/{itemId}.json, sends SendTaskSuccess (APPROVE or REJECT)", { size: 11, fill: INK, halo: true });
// Save record into the shared table.
arrow([[1290, 304], [1290, 258], [1745, 258], [1745, 614]]);
text(1620, 250, "write record", { size: 11, fill: INK, halo: true });

badge(182, 330, "1");
badge(590, 330, "2");
badge(925, 300, "3");
badge(1172, 474, "4");
badge(1480, 258, "5");

// ---- Shared table ----
node("dynamodb", 1745, 650, 64, ["Amazon DynamoDB", "found-documents", "GSI by_dob · TTL"]);
text(1745, 750, "shared by both flows", { size: 11, italic: true });

// ---- Flow 2 ----
node("apigw", 380, 830, 64, ["Amazon API Gateway", "REST · POST /chat", "API key · usage plan"]);
node("lambda", 560, 830, 64, ["chat-proxy", "AWS Lambda"]);
node("bedrock", 560, 1022, 64, ["Amazon Bedrock Guardrails", "in: prompt attack (Standard tier)", "out: NIC and passport regex, PII"]);

group(680, 715, 580, 215, { stroke: C_AI, label: "Amazon Bedrock AgentCore", iconKey: "agentcore", iconSize: 30 });
node("agentcore", 800, 830, 64, ["Harness (agent)", "Amazon Nova Pro", "memory disabled"]);
node("agentcore", 1080, 830, 64, ["Gateway", "MCP · IAM inbound auth"]);
node("lambdaFn", 1420, 830, 48, ["find_document", "AWS Lambda"]);

arrow([[148, 830], [346, 830]], { both: true });
text(255, 818, "POST /chat", { size: 11, fill: INK, halo: true });
arrow([[414, 830], [526, 830]], { both: true });
arrow([[560, 904], [560, 988]], { both: true });
text(572, 940, "ApplyGuardrail", { size: 11, fill: INK, anchor: "start", halo: true });
text(572, 954, "INPUT, then OUTPUT", { size: 11, fill: INK, anchor: "start", halo: true });
arrow([[594, 830], [766, 830]], { both: true });
text(636, 818, "InvokeHarness", { size: 11, fill: INK, halo: true });
arrow([[834, 830], [1046, 830]], { both: true });
text(940, 818, "tool call (IAM)", { size: 11, fill: INK, halo: true });
arrow([[1114, 830], [1394, 830]], { both: true });
text(1330, 818, "find_document", { size: 11, fill: INK, halo: true });
arrow([[1446, 830], [1670, 830], [1670, 650], [1711, 650]]);
text(1560, 818, "Query GSI by_dob", { size: 11, fill: INK, halo: true });

badge(345, 790, "A");
badge(835, 793, "B");
badge(597, 990, "C");

// ---- Optional Knowledge Base ----
group(990, 950, 630, 168, { stroke: C_OPT, dash: "6 4", rx: 8, fill: "#FFFFFF" });
text(1005, 1110, "OPTIONAL · ENABLE_KNOWLEDGE_BASE=true", { size: 11, weight: 700, fill: C_OPT, anchor: "start" });
node("lambdaFn", 1080, 1030, 48, ["office_procedures", "AWS Lambda"]);
node("bedrock", 1240, 1030, 48, ["Knowledge Base", "Retrieve, top 4"]);
node("s3Vectors", 1400, 1030, 48, ["Amazon S3 Vectors", "cosine · 1024 dims"]);
node("s3Bucket", 1550, 1030, 48, ["procedure-docs", "Amazon S3"]);
arrow([[1080, 906], [1080, 1004]], { dashed: true });
arrow([[1106, 1030], [1214, 1030]]);
text(1160, 1020, "Retrieve", { size: 11, fill: INK, halo: true });
arrow([[1266, 1030], [1374, 1030]], { both: true });
arrow([[1550, 1004], [1550, 984], [1240, 984], [1240, 1004]], { dashed: true });
text(1470, 978, "ingest (kb-sync)", { size: 11, fill: INK, halo: true });

// ---- Legend ----
const LY = 1196;
text(40, LY, "Flow 1", { size: 13, weight: 700, fill: INK, anchor: "start" });
const f1 = [["1", "Upload pages, manifest last"], ["2", "S3 event routed by EventBridge"], ["3", "Extract with Bedrock, validate with code"], ["4", "Officer review (task token)"], ["5", "Save record (DynamoDB, no Lambda)"]];
let lx = 110;
for (const [b, t] of f1) { badge(lx, LY - 4, b); text(lx + 18, LY, t, { size: 12, fill: INK, anchor: "start" }); lx += 28 + t.length * 6.6 + 24; }
const LY2 = LY + 32;
text(40, LY2, "Flow 2", { size: 13, weight: 700, fill: INK, anchor: "start" });
const f2 = [["A", "Chat API with API key"], ["B", "Agent calls find_document through Gateway"], ["C", "Guardrails on input and output"]];
lx = 110;
for (const [b, t] of f2) { badge(lx, LY2 - 4, b); text(lx + 18, LY2, t, { size: 12, fill: INK, anchor: "start" }); lx += 28 + t.length * 6.6 + 24; }
text(W - 40, LY2, "Dashed lines: asynchronous or optional · Icons: AWS Architecture Icons, 2026-07-31 package", { size: 11, anchor: "end" });

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<title>Lost Passport and NIC Finder architecture</title>
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${LINE}"/></marker></defs>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${out.join("\n")}
</svg>
`;
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${(svg.length / 1024).toFixed(0)} KB)`);
