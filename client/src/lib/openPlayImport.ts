export type ImportedPlayer = {
  name: string;
  duprRating?: string;
  selfRating?: string;
  manualRating?: string;
  registrationStatus?: string;
  checkedIn?: boolean;
};

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV contains a quote that was not closed.");
  row.push(cell.trim());
  if (row.some(value => value.length > 0)) rows.push(row);
  return rows;
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|checked|in)$/i.test(value?.trim() ?? "");
}

export function parseParticipantText(source: string): ImportedPlayer[] {
  const rows = parseCsvRows(source);
  if (!rows.length) return [];
  const headers = rows[0].map(header =>
    header
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/^\ufeff/, "")
  );
  const nameIndex = headers.findIndex(header =>
    [
      "name",
      "player",
      "player_name",
      "participant",
      "participant_name",
    ].includes(header)
  );
  if (nameIndex < 0)
    return rows
      .map(row => ({ name: row[0]?.trim() ?? "" }))
      .filter(player => player.name.length > 0);
  const get = (row: string[], aliases: string[]) => {
    const index = headers.findIndex(header => aliases.includes(header));
    return index < 0 ? "" : (row[index] ?? "").trim();
  };
  return rows
    .slice(1)
    .map(row => {
      const checkedIn = get(row, ["checked_in", "check_in", "checkedin"]);
      return {
        name: (row[nameIndex] ?? "").trim(),
        duprRating: get(row, ["dupr", "dupr_rating"]),
        selfRating: get(row, ["self_rating", "selfrating"]),
        manualRating: get(row, ["manual_rating", "manualrating"]),
        registrationStatus: get(row, ["registration_status", "status"]),
        checkedIn: checkedIn ? truthy(checkedIn) : undefined,
      };
    })
    .filter(player => player.name.length > 0);
}

export function parsePastedNames(source: string): ImportedPlayer[] {
  return source
    .split(/[\n;,]+/)
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => ({ name }));
}

export function playerCsvTemplate(): string {
  return "name,dupr_rating,self_rating,manual_rating,registration_status,checked_in\n";
}
