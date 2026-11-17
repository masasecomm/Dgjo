import {
  cleanSalaryText,
  findCircularAnnexureBoundary,
  formatVacancyText
} from "../vacancy-format.js";

const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_PDF_PAGES = 500;

const FIELD_LABELS = [
  ["refNo", /\bREF\s*NO\b\s*[:.\u2013\u2014-]\s*/gi],
  ["departmentName", /\bDEPARTMENT\s+OF\s+|\bDEPARTMENT\b\s*[:.\u2013\u2014-]\s*/gi],
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
  ["requirements", /\bREQ(?:UIRE|UIR)MENTS?\b\s*[:.\u2013\u2014-]\s*/gi],
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

function normalizeDepartmentName(value) {
  const department = cleanText(value);
  const letters = department.match(/\p{L}/gu) ?? [];
  if (!letters.length || letters.some(letter => letter !== letter.toLocaleUpperCase("en-ZA"))) return department;
  const acronyms = new Set(["SAPS", "SARS", "SANDF", "SASSA", "DPSA", "HIV", "AIDS"]);
  const minorWords = new Set(["and", "for", "in", "of", "the"]);
  return department.toLocaleLowerCase("en-ZA").replace(/\b[\p{L}][\p{L}'’.-]*/gu, (word, offset) => {
    const upper = word.toLocaleUpperCase("en-ZA");
    if (acronyms.has(upper)) return upper;
    if (offset > 0 && minorWords.has(word)) return word;
    return `${word.charAt(0).toLocaleUpperCase("en-ZA")}${word.slice(1)}`;
  });
}

function fieldMatches(text) {
  const matches = [];
  for (const [key, pattern] of FIELD_LABELS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (key === "directorate" && /\bCHIEF\s+$/i.test(text.slice(Math.max(0, match.index - 16), match.index))) continue;
      if (["departmentName", "centre"].includes(key) && text.slice(text.lastIndexOf("\n", match.index - 1) + 1, match.index).trim()) continue;
      matches.push({ key, start: match.index, end: match.index + match[0].length });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const firstVacancyField = matches.find(item => item.key !== "departmentName");
  return matches.filter(item => item.key !== "departmentName" || !firstVacancyField || item.start < firstVacancyField.start);
}

function departmentHeadingBefore(text, position) {
  const prefix = text.slice(0, position);
  const headings = [...prefix.matchAll(/^\s*((?:(?:NATIONAL|PROVINCIAL)\s+)?DEPARTMENT\s+OF\s+[A-Z][A-Z0-9 &,'’()./-]{2,120})\s*$/gm)];
  const heading = headings.at(-1)?.[1];
  return heading ? normalizeDepartmentName(heading) : "";
}

function readField(text, matches, key) {
  const match = matches.find(item => item.key === key);
  if (!match) return "";
  const next = matches.find(item => item.start > match.start);
  return cleanText(text.slice(match.end, next?.start ?? text.length));
}

function parseAppointmentType(value, text) {
  const match = value.match(/\b(Permanent|Contract|Sessional|Internship|Seasonal|Temporary|Full[\s-]?Time|Part[\s-]?Time)\b/i);
  if (match) {
    const type = match[1].toLowerCase().replace(/[\s-]/g, "");
    if (type === "internship") return "Internship";
    if (type === "seasonal") return "Seasonal";
    if (type === "sessional") return "Sessional";
    if (["contract", "temporary", "parttime"].includes(type)) return "Contract";
    return "Permanent";
  }
  if (/\bsessional\b/i.test(text)) return "Sessional";
  if (/\bcontract\b/i.test(text)) return "Contract";
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

function isDemographicGroupHeading(title) {
  const group = String.raw`(?:African|Black|Colou?red|Indian|Asian|White)\s+(?:male|female)s?`;
  const heading = new RegExp(`^(?:(?:employment\\s+equity|target\\s+group|designated\\s+groups)\\s*[:\\-]?\\s*)?${group}(?:\\s*(?:,|;|\\/|&|\\band\\b)\\s*${group})*\\.?$`, "i");
  return heading.test(title.replace(/\s+/g, " ").trim());
}

function parsePost(postNumber, body, circular, sourceUrl, pdfLinks, pageNumbers, circularPage, departmentContext) {
  const text = cleanText(body);
  const links = pdfLinks.filter(link => pageNumbers.includes(link.page)).map(({ label, url }) => ({ label, url }));
  const fields = fieldMatches(text);
  const titleEnd = fields.length ? fields[0].start : Math.min(text.length, text.indexOf("\n") > 0 ? text.indexOf("\n") : 500);
  const title = cleanText(text.slice(0, titleEnd))
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .replace(/\s*[\[(]\s*$/, "");
  if (title.length < 4 || isDemographicGroupHeading(title)) return null;

  const values = Object.fromEntries(FIELD_LABELS.map(([key]) => [key, readField(text, fields, key)]));
  const departmentField = fields.find(field => field.key === "departmentName");
  const departmentValue = cleanText(values.departmentName.split(/\n/)[0] || "");
  const explicitDepartment = departmentField && /\bDEPARTMENT\s+OF\s+$/i.test(text.slice(departmentField.start, departmentField.end))
    ? `Department of ${normalizeDepartmentName(departmentValue)}`
    : normalizeDepartmentName(departmentValue);
  const department = explicitDepartment || departmentContext;
  const province = cleanText(text.match(/\b(?:EASTERN CAPE|FREE STATE|GAUTENG|KWAZULU[- ]?NATAL|LIMPOPO|MPUMALANGA|NORTHERN CAPE|NORTH WEST|WESTERN CAPE)\b/i)?.[0] ?? "");
  const location = values.centre || province || "South Africa";
  const salaryText = cleanSalaryText(values.salary || values.stipend) || "Not stated in advert";
  const closingDate = values.closingDate.split(/\n/)[0].trim();
  const refNo = values.refNo.split(/\n/)[0].trim();
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  const signature = `${circular.name}|${postNumber}|${refNo}|${normalizedTitle}`.toLowerCase();

  return {
    id: `dpsa-${signature.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 130)}`,
    sourceUrl,
    title: normalizedTitle,
    company: department || "Hiring department not identified",
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
    circularPage: circularPage ? String(circularPage) : "",
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
    requirements: formatVacancyText(values.requirements),
    duties: formatVacancyText(values.duties),
    jobPurpose: values.jobPurpose,
    skillsAndCompetencies: values.skillsAndCompetencies,
    enquiries: values.enquiries,
    applications: values.applications,
    note: formatVacancyText(values.note),
    links: [...new Map(links.map(link => [link.url, link])).values()]
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
    const links = [];
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
      const annotations = await page.getAnnotations({ intent: "display" });
      for (const annotation of annotations) {
        const url = annotation.url;
        if (annotation.subtype !== "Link" || typeof url !== "string" || !/^(?:https?:\/\/|mailto:|tel:)/i.test(url)) continue;
        const [left, bottom, right, top] = annotation.rect ?? [];
        const textLabel = Number.isFinite(left) && Number.isFinite(bottom) && Number.isFinite(right) && Number.isFinite(top)
          ? content.items
            .filter(item => "str" in item && item.str.trim() && item.transform[4] <= right && item.transform[4] + item.width >= left && item.transform[5] <= top && item.transform[5] + item.height >= bottom)
            .sort((a, b) => a.transform[5] - b.transform[5] || a.transform[4] - b.transform[4])
            .map(item => item.str.trim())
            .join(" ")
          : "";
        const label = annotation.contents || annotation.title || textLabel || url;
        links.push({ page: pageNumber, label, url });
      }
      pages.push(`__PAGE_${pageNumber}__\n${lines.join("\n")}`);
    }
    return { text: pages.join("\n"), links };
  } finally {
    await document.destroy();
  }
}

export function parseDpsaCircular(text, { fileName = "", sourceUrl = "", links = [] } = {}) {
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
    const bodyStart = match.index + match[0].length;
    const nextPostStart = matches[index + 1]?.index ?? normalized.length;
    const nextPostBody = normalized.slice(bodyStart, nextPostStart);
    const annexureBoundary = findCircularAnnexureBoundary(nextPostBody);
    const end = annexureBoundary < 0 ? nextPostStart : bodyStart + annexureBoundary;
    const previousPageMarker = [...normalized.slice(0, match.index).matchAll(/__PAGE_(\d+)__/g)].at(-1);
    const departmentContext = departmentHeadingBefore(normalized, match.index);
    const pageNumbers = [
      ...(previousPageMarker ? [Number(previousPageMarker[1])] : []),
      ...[...normalized.slice(match.index, end).matchAll(/__PAGE_(\d+)__/g)].map(page => Number(page[1]))
    ];
    const vacancy = parsePost(
      match[1].trim(),
      normalized.slice(bodyStart, end),
      circular,
      sourceUrl,
      links,
      pageNumbers,
      previousPageMarker ? Number(previousPageMarker[1]) : 0,
      departmentContext
    );
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
  const circularPages = new Map();
  for (const link of document.querySelectorAll("a[href]")) {
    const url = new URL(link.getAttribute("href"), response.url);
    const match = url.pathname.match(/^\/newsroom\/psvc\/circular-(\d+)-of-(20\d{2})\/?$/i);
    if (!match || !["www.dpsa.gov.za", "dpsa.gov.za"].includes(url.hostname)) continue;
    const number = Number(match[1]);
    const year = Number(match[2]);
    circularPages.set(`${year}-${number}`, {
      label: `Circular ${number} of ${year}`,
      number,
      year,
      url: url.href
    });
  }

  const latestPages = [...circularPages.values()]
    .sort((a, b) => b.year - a.year || b.number - a.number)
    .slice(0, 5);
  if (!latestPages.length) throw new Error("No circular archive pages were found on the DPSA website.");

  const warnings = [];
  const circulars = (await Promise.all(latestPages.map(async page => {
    try {
      const pageResponse = await fetch(page.url, { cache: "no-store", credentials: "omit" });
      if (!pageResponse.ok) throw new Error(`HTTP ${pageResponse.status}`);
      const pageHtml = await pageResponse.text();
      const pageDocument = new DOMParser().parseFromString(pageHtml, "text/html");
      const pageText = pageDocument.body?.textContent.replace(/\s+/g, " ") ?? "";
      const publishedDate = pageText.match(/\bPosting\s+Date\s*:\s*(\d{1,2}\s+[A-Z]+\s+20\d{2})\b/i)?.[1] ?? "";
      const pdfs = [...pageDocument.querySelectorAll("a[href]")].flatMap(link => {
        const pdfUrl = new URL(link.getAttribute("href"), pageResponse.url);
        if (!pdfUrl.pathname.toLowerCase().endsWith(".pdf") || !["www.dpsa.gov.za", "dpsa.gov.za"].includes(pdfUrl.hostname)) return [];
        return [{ url: pdfUrl.href, path: decodeURIComponent(pdfUrl.pathname), label: link.textContent.replace(/\s+/g, " ").trim() }];
      });
      const fullCircular = pdfs.find(pdf => /(?:^|\/)PSV\s+CIRCULAR\s+\d+\s+of\s+20\d{2}\.pdf$/i.test(pdf.path))
        ?? pdfs.find(pdf => /full document/i.test(pdf.label) && /circular/i.test(pdf.label));
      if (!fullCircular) {
        warnings.push(`${page.label}: full circular PDF was not linked.`);
        return null;
      }
      return {
        label: publishedDate ? `${page.label} — Published ${publishedDate}` : page.label,
        circularName: page.label,
        publishedDate,
        url: fullCircular.url
      };
    } catch (error) {
      warnings.push(`${page.label}: could not be checked (${error.message}).`);
      return null;
    }
  }))).filter(Boolean);

  if (!circulars.length) throw new Error("The DPSA circular pages loaded, but no full circular PDFs could be found.");
  return { circulars, warnings };
}
