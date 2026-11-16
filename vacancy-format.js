function splitColonSubpoints(sentence) {
  const colon = sentence.indexOf(":");
  if (colon < 0) return [sentence.trim()];
  const prefix = sentence.slice(0, colon).trim();
  if (/^(?:Service Provision|Management|Academic\s*\/\s*Research|Outreach)$/i.test(prefix)) {
    return [sentence.trim()];
  }
  const points = [];
  let start = colon + 1;
  const brackets = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (let index = start; index < sentence.length; index++) {
    const character = sentence[index];
    if ("([{".includes(character)) brackets.push(character);
    else if (pairs[character] && brackets.at(-1) === pairs[character]) brackets.pop();
    else if (!brackets.length && (
      character === "," ||
      (character === "/" && /\s/.test(sentence[index - 1] ?? "") && /\s/.test(sentence[index + 1] ?? ""))
    )) {
      points.push(sentence.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (!points.length) return [sentence.trim()];
  points.push(sentence.slice(start).trim());
  const label = sentence.slice(0, colon + 1).trim();
  return points.filter(Boolean).map(point => `${label} ${point}`);
}

export function splitVacancyPoints(value) {
  const links = [];
  const points = [];
  const blocks = [];
  let currentBlock;
  const inputLines = String(value ?? "").replace(/\r/g, "").split("\n");
  for (const rawLine of inputLines) {
    if (/^\s*\d{1,4}\s*$/.test(rawLine)) continue;
    const bullet = rawLine.match(/^\s*(-+|–|[•●▪])\s*(.*)$/);
    if (bullet) {
      currentBlock = { depth: bullet[1].startsWith("-") && bullet[1].length > 1 ? 1 : 0, text: bullet[2].trim() };
      blocks.push(currentBlock);
    } else if (rawLine.trim()) {
      if (!currentBlock) {
        currentBlock = { depth: 0, text: rawLine.trim() };
        blocks.push(currentBlock);
      } else {
        currentBlock.text = `${currentBlock.text} ${rawLine.trim()}`.trim();
      }
    }
  }

  const appendSentences = (text, target, splitColon = true) => {
    for (const sentence of text.split(/(?<=\.)\s+/).map(item => item.trim()).filter(Boolean)) {
      const subpoints = splitColon ? splitColonSubpoints(sentence) : [sentence];
      target.push(...subpoints.map(point => ({ text: point })));
    }
  };

  for (const block of blocks) {
    const target = block.depth && points.length
      ? (points.at(-1).children ??= [])
      : points;
    const blockText = block.depth ? block.text.replace(/,\s*$/, "") : block.text;
    const line = blockText
      .replace(/^\s*(?:REQUIREMENTS?|DUTIES|NOTES?)\s*:\s*/i, "")
      .replace(/https?:\/\/\S+|www\.\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, match => {
        let link = match;
        let punctuation = "";
        while (/[.,;:!?)}\]]$/.test(link)) {
          punctuation = link.slice(-1) + punctuation;
          link = link.slice(0, -1);
        }
        const token = `\uE000${links.length}\uE001`;
        links.push(link);
        return `${token}${punctuation}`;
      }).trim();
    if (!line) continue;
    const sectionPattern = /\b(Knowledge|Skills|Must\s+be)\s*:/gi;
    const sections = [...line.matchAll(sectionPattern)];
    let contentStart = 0;
    for (const section of sections) {
      const before = line.slice(contentStart, section.index).trim();
      appendSentences(before, target);
      const nextStart = section.index + section[0].length;
      const nextSection = sections.find(item => item.index >= nextStart);
      const sectionText = line.slice(nextStart, nextSection?.index ?? line.length).trim();
      const sectionLabel = section[1].replace(/\s+/g, " ");
      const sectionPrefix = `${sectionLabel}:`;
      const children = sectionText
        .split(/(?<=\.)\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean)
        .flatMap(sentence => splitColonSubpoints(`${sectionPrefix} ${sentence}`))
        .map(point => ({ text: point.slice(sectionPrefix.length).trim() }));
      (block.depth ? points : target).push({
        text: sectionPrefix,
        ...(children.length ? { children } : {})
      });
      contentStart = nextSection?.index ?? line.length;
    }
    if (!sections.length) {
      appendSentences(line, target, !block.depth);
    } else if (contentStart < line.length) {
      appendSentences(line.slice(contentStart), block.depth ? points : target, !block.depth);
    }
  }
  const restoreLinks = point => ({
    ...point,
    text: point.text.replace(/\uE000(\d+)\uE001/g, (_, index) => links[Number(index)] ?? ""),
    ...(point.children ? { children: point.children.map(restoreLinks) } : {})
  });
  return points.map(restoreLinks);
}

export function formatVacancyText(value) {
  const formatPoints = (points, depth = 1) => points.flatMap(point => [
    `${"-".repeat(depth)} ${point.text}`,
    ...(point.children?.length ? formatPoints(point.children, depth + 1) : [])
  ]);
  return formatPoints(splitVacancyPoints(value)).join("\n");
}
