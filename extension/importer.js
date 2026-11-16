const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_PDF_PAGES = 500;

const FIELD_LABELS = [
  ["refNo", /\bREF\s*NO\b\s*[:.\u2013\u2014-]\s*/gi],
  ["departmentName", /\bDEPARTMENT\b\s*[:.\u2013\u2014-]\s*/gi],
  ["branch", /\b(?:BRANCH|DIVISION)\b\s*[:.\u2013\u2014-]\s*/gi],
  ["chiefDirectorate", /\bCHIEF\s*DIRECTORATE\b\s*[:.\u2013\u2014-]\s*/gi],
  ["directorate", /\bDIRECTORATE\b\s*[:.\u2013\u2014-]\s*/gi],
  ["cluster", /\bCLUSTER\b\s*[:.\u2013\u2014-]\s*/gi],
  ["salary", /\bSALARY\b\s*[:.\u2013\u2014-]\s*/gi],
  ["stipend", /\bSTIPEND\b\s*[:.\u2013\u2014-]\s*/gi],
  ["level", /\bLEVEL\b\s*[:.\u2013\u2014-]\s*/gi],
  ["natureOfAppointment", /\bNATURE\s+OF\s+APPOINTMENT\b\s*[:.\u2013\u2014-]\s*/gi],
  ["centre", /\bCENTRE\b\s*[:.\u2013\u2014-]\s*/gi],
  ["closingDate", /\bCLOSING\s+DATE(?:\s+FOR\s+APPLICATIONS)?\b\s*[:.\u2013\u2014-]\s*/gi],
  ["requirements", /\bREQUIREMENTS\b\s*[:.\u2013\u2014-]\s*/gi],
  ["duties", /\bDUTIES\b\s*[:.\u2013\u2014-]\s*/gi],
  ["jobPurpose", /\b(?:JOB\s+PURPOSE|PURPOSE\s+OF\s+THE\s+POST)\b\s*[:.\u2013\u2014-]\s*/gi],
  ["skillsAndCompetencies", /\bSKILLS?\s+(?:AND|&)\s+COMPETENC(?:Y|IES)\b\s*[:.\u2013\u2014-]\s*/gi],
  ["enquiries", /\bENQUIRIES\b\s*[:.\u2013\u2014-]\s*/gi],
  ["applications", /\bAPPLICATIONS\b\s*[:.\u2013\u2014-]\s*/gi],
  ["note", /\bNOTES?\b\s*[:.\u2013\u2014-]\s*/gi]
];

function cleanText(value) {
  return String(value ?? "")
    .replace(/__PAGE_\d+__/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function fieldMatches(text) {
  const matches = [];
  for (const [key, pattern] of FIELD_LABELS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (key === "directorate" && /\bCHIEF\s+$/i.test(text.slice(Math.max(0, match.index - 16), match.index))) continue;
      matches.push({ key, start: match.index, end: match.index + match[0].length });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

function readField(text, matches, key) {
  const match = matches.find(item => item.key === key);
  if (!match) return "";
  const next = matches.find(item => item.start > match.start);
  return cleanText(text.slice(match.end, next?.start ?? text.length));
}

function parseAppointmentType(value, text) {
  const match = value.match(/\b(Permanent|Contract|Sessional|Internship|Temporary|Full[\s-]?Time|Part[\s-]?Time)\b/i);
  if (match) {
    const type = match[1].toLowerCase().replace(/[\s-]/g, "");
    if (type === "internship") return "Internship";
    if (["contract", "sessional", "temporary", "parttime"].includes(type)) return "Contract";
    return "Permanent";
  }
  if (/\bsessional\b|\bcontract\b/i.test(text)) return "Contract";
  if (/\bstipend\b/i.test(text)) return "Internship";
  return "Permanent";
}

function salaryAmount(value) {
  const amounts = [...String(value).matchAll(/R\s*([\d][\d,\s]*(?:\.\d+)?)/gi)]
    .map(match => Number(match[1].replace(/[,\s]/g, "")))
    .filter(amount => Number.isFinite(amount));
  return amounts.length ? Math.max(...amounts) : 0;
}

function categoryFor(text) {
  if (/\b(teacher|educat|school|lecturer|educator)\b/i.test(text)) return "Education";
  if (/\b(nurse|doctor|health|clinical|medical|hospital)\b/i.test(text)) return "Health";
  if (/\b(account|finance|auditor|treasury|revenue)\b/i.test(text)) return "Finance";
  if (/\b(police|correctional|saps|law enforcement|protection services)\b/i.test(text)) return "Law Enforcement";
  if (/\b(administrative|administration|clerk|secretary|office support)\b/i.test(text)) return "Administration";
  return "Other";
}

function parsePost(postNumber, body, circular, sourceUrl) {
  const text = cleanText(body);
  const fields = fieldMatches(text);
  const titleEnd = fields.length ? fields[0].start : Math.min(text.length, text.indexOf("\n") > 0 ? text.indexOf("\n") : 500);
  const title = cleanText(text.slice(0, titleEnd)).replace(/^[\s:–—-]+|[\s:–—-]+$/g, "");
  if (title.length < 4) return null;

  const values = Object.fromEntries(FIELD_LABELS.map(([key]) => [key, readField(text, fields, key)]));
  const department = cleanText(values.departmentName.split(/\n/)[0] ||
    text.match(/\bDEPARTMENT\s*[:.\u2013\u2014-]\s*([^\n]+)/i)?.[1] ||
    text.match(/\b(?:NATIONAL|PROVINCIAL)\s+DEPARTMENT\s+OF\s+([^\n]+)/i)?.[0] ||
    "");
  const province = cleanText(text.match(/\b(?:EASTERN CAPE|FREE STATE|GAUTENG|KWAZULU[- ]?NATAL|LIMPOPO|MPUMALANGA|NORTHERN CAPE|NORTH WEST|WESTERN CAPE)\b/i)?.[0] ?? "");
  const location = values.centre || province || "South Africa";
  const salaryText = values.salary || values.stipend || "Not stated in advert";
  const closingDate = values.closingDate.split(/\n/)[0].trim();
  const refNo = values.refNo.split(/\n/)[0].trim();
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  const signature = `${circular.name}|${postNumber}|${refNo}|${normalizedTitle}`.toLowerCase();

  return {
    id: `dpsa-${signature.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 130)}`,
    sourceUrl,
    title: normalizedTitle,
    company: department || "South African Public Service",
    location,
    category: categoryFor(`${normalizedTitle} ${department}`),
    type: parseAppointmentType(values.natureOfAppointment, text),
    salary: salaryAmount(salaryText),
    salaryText,
    posted: closingDate ? `Closing date: ${closingDate}` : "Closing date: check official advert",
    logo: (department || "D").trim().slice(0, 1).toLowerCase(),
    color: "#eaf1e2",
    logoColor: "#64803f",
    circularName: circular.name,
    circularDate: circular.date,
    postNo: postNumber,
    refNo,
    province,
    natureOfAppointment: values.natureOfAppointment,
    branch: values.branch,
    chiefDirectorate: values.chiefDirectorate,
    directorate: values.directorate,
    cluster: values.cluster,
    level: values.level,
    centre: values.centre,
    closingDate,
    requirements: values.requirements,
    duties: values.duties,
    jobPurpose: values.jobPurpose,
    skillsAndCompetencies: values.skillsAndCompetencies,
    enquiries: values.enquiries,
    applications: values.applications,
    note: values.note
  };
}

export async function extractPdfText(file) {
  if (!(file instanceof Blob) || file.size === 0) throw new Error("The selected PDF is empty.");
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF is larger than 40 MB. Please choose a smaller file.");
  const data = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-") {
    throw new Error("This file is not a readable PDF.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");
  const document = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  if (document.numPages > MAX_PDF_PAGES) {
    await document.destroy();
    throw new Error(`This PDF has ${document.numPages} pages. The limit is ${MAX_PDF_PAGES} pages.`);
  }

  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = [];
      let currentLine = "";
      let previousY;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (previousY !== undefined && Math.abs(y - previousY) > 2.5) {
          lines.push(currentLine.trim());
          currentLine = "";
        }
        currentLine += item.str + (item.str.endsWith(" ") ? "" : " ");
        previousY = y;
      }
      if (currentLine.trim()) lines.push(currentLine.trim());
      pages.push(`__PAGE_${pageNumber}__\n${lines.join("\n")}`);
    }
    return pages.join("\n");
  } finally {
    await document.destroy();
  }
}

export function parseDpsaCircular(text, { fileName = "", sourceUrl = "" } = {}) {
  const circularMatch = `${fileName}\n${text.slice(0, 12000)}`
    .match(/(?:CIRCULAR|PUBLICATION\s+NO\.?)\s*(\d{1,2})\s*(?:OF|\/)\s*(20\d{2})/i);
  const dateMatch = text.slice(0, 12000).match(/\bDATE\s+ISSUED\s*[:.]?\s*(\d{1,2}\s+[A-Z]+\s+20\d{2})\b/i);
  const circular = {
    name: circularMatch ? `DPSA Circular ${Number(circularMatch[1])} of ${circularMatch[2]}` : fileName.replace(/\.pdf$/i, "") || "DPSA vacancy circular",
    date: dateMatch?.[1] ?? ""
  };
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const postPattern = /\bPOST\s+([A-Z0-9][A-Z0-9/\-]{0,40})\s*:\s*/gi;
  const matches = [...normalized.matchAll(postPattern)];
  const vacancies = [];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const end = matches[index + 1]?.index ?? normalized.length;
    const vacancy = parsePost(match[1].trim(), normalized.slice(match.index + match[0].length, end), circular, sourceUrl);
    if (vacancy) vacancies.push(vacancy);
  }

  const unique = new Map();
  for (const vacancy of vacancies) unique.set(vacancy.id, vacancy);
  return { circular, vacancies: [...unique.values()] };
}

export async function downloadDpsaPdf(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Enter a valid PDF web address.");
  }
  if (parsedUrl.protocol !== "https:" || !["www.dpsa.gov.za", "dpsa.gov.za"].includes(parsedUrl.hostname) || !parsedUrl.pathname.toLowerCase().endsWith(".pdf")) {
    throw new Error("For safety, PDF links must be HTTPS PDFs hosted on dpsa.gov.za.");
  }

  const response = await fetch(parsedUrl.href, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`DPSA PDF request failed with HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
    throw new Error("PDF is larger than 40 MB. Please choose a smaller circular.");
  }
  const blob = await response.blob();
  if (blob.size > MAX_PDF_BYTES) throw new Error("PDF is larger than 40 MB. Please choose a smaller circular.");
  const fileName = decodeURIComponent(parsedUrl.pathname.split("/").pop() || "dpsa-circular.pdf");
  return { file: new File([blob], fileName, { type: "application/pdf" }), url: parsedUrl.href };
}

export async function discoverDpsaCirculars() {
  const response = await fetch("https://www.dpsa.gov.za/newsroom/psvc/", { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Could not load the DPSA circular page (HTTP ${response.status}).`);
  const html = await response.text();
  const document = new DOMParser().parseFromString(html, "text/html");
  const circulars = [];
  for (const link of document.querySelectorAll("a[href]")) {
    const url = new URL(link.getAttribute("href"), response.url);
    const label = link.textContent.replace(/\s+/g, " ").trim();
    const isPdf = url.pathname.toLowerCase().endsWith(".pdf");
    const isCircular = /circular|vacanc/i.test(label) || /circular/i.test(url.pathname);
    if (isPdf && isCircular && ["www.dpsa.gov.za", "dpsa.gov.za"].includes(url.hostname)) {
      circulars.push({ label: label || decodeURIComponent(url.pathname.split("/").pop()), url: url.href });
    }
  }
  return [...new Map(circulars.map(item => [item.url, item])).values()];
}
